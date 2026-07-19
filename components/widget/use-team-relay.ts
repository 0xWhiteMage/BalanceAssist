'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RelayMessageResult, TeamMessage, TeamPollState } from '@/lib/api/client';

type Dependencies = {
  sessionId: string | null;
  fetchTeamMessages: (sessionId: string, sinceId?: number) => Promise<TeamPollState>;
  relayUserMessage: (sessionId: string, text: string, requestId: string) => Promise<RelayMessageResult | boolean>;
};

type SendResult = 'persisted' | 'failed' | 'invalidated';
const MAX_ACTIVE_POLLING_MS = 5 * 60 * 1000;
const MAX_POLL_BACKOFF_MS = 15_000;
const PASSIVE_POLLING_MS = 15_000;

export function useTeamRelay({ sessionId, fetchTeamMessages, relayUserMessage }: Dependencies) {
  const [requested, setRequested] = useState(false);
  const [status, setStatus] = useState<'idle' | 'requested' | 'sending' | 'saved' | 'queued' | 'delivered' | 'unavailable'>('idle');
  const [isTeamConnected, setIsTeamConnected] = useState(false);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [fileRequestOpen, setFileRequestOpen] = useState(false);
  const [fileRequestNote, setFileRequestNote] = useState<string | null>(null);
  const [scheduleRequestOpen, setScheduleRequestOpen] = useState(false);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const sinceIdRef = useRef(0);
  const generationRef = useRef(0);
  const pollingRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<{ text: string; requestId: string } | null>(null);
  const pendingSendGenerationRef = useRef<number | null>(null);
  const sessionIdRef = useRef(sessionId);
  const [identity, setIdentity] = useState(0);
  const identityRef = useRef(identity);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [environmentReady, setEnvironmentReady] = useState(() =>
    typeof document === 'undefined' || (document.visibilityState !== 'hidden' && navigator.onLine !== false)
  );
  const pollFailuresRef = useRef(0);
  const activePollingMsRef = useRef(0);
  const passivePollingRef = useRef(false);

  useEffect(() => {
    if (sessionIdRef.current === sessionId) return;
    sessionIdRef.current = sessionId;
    generationRef.current += 1;
    const nextIdentity = identityRef.current + 1;
    identityRef.current = nextIdentity;
    setIdentity(nextIdentity);
    pollingRef.current = null;
    sinceIdRef.current = 0;
    retryRef.current = null;
    pendingSendGenerationRef.current = null;
    pollFailuresRef.current = 0;
    activePollingMsRef.current = 0;
    passivePollingRef.current = false;
    setRequested(false); setStatus('idle'); setIsTeamConnected(false); setWaitingForReply(false); setPollingEnabled(true);
    setFileRequestOpen(false); setFileRequestNote(null); setScheduleRequestOpen(false); setMessages([]);
  }, [sessionId]);

  useEffect(() => {
    const updateEnvironment = () => {
      setEnvironmentReady(document.visibilityState !== 'hidden' && navigator.onLine !== false);
    };
    document.addEventListener('visibilitychange', updateEnvironment);
    window.addEventListener('online', updateEnvironment);
    window.addEventListener('offline', updateEnvironment);
    return () => {
      document.removeEventListener('visibilitychange', updateEnvironment);
      window.removeEventListener('online', updateEnvironment);
      window.removeEventListener('offline', updateEnvironment);
    };
  }, []);

  const poll = useCallback(async () => {
    if (identity !== identityRef.current || sessionId !== sessionIdRef.current || !sessionId || pollingRef.current !== null) return;
    const generation = generationRef.current;
    const suppressOutgoingStatus = pendingSendGenerationRef.current === generation;
    pollingRef.current = generation;
    try {
      const next = await fetchTeamMessages(sessionId, sinceIdRef.current);
      if (generation !== generationRef.current) return;
      setFileRequestOpen(next.fileRequestOpen);
      setFileRequestNote(next.fileRequestNote);
      setScheduleRequestOpen(next.scheduleRequestOpen);
      if (!suppressOutgoingStatus) {
        setStatus((current) => {
          if (next.outgoingStatus === 'unavailable') return 'unavailable';
          if (next.outgoingStatus === 'delivered') return 'delivered';
          if (next.outgoingStatus === 'queued' && current !== 'delivered') return 'queued';
          return current;
        });
      }
      if (next.messages.length > 0) {
        sinceIdRef.current = Math.max(sinceIdRef.current, ...next.messages.map((message) => message.id));
        setMessages((existing) => {
          const known = new Set(existing.map((message) => message.id));
          return [...existing, ...next.messages.filter((message) => !known.has(message.id))];
        });
        if (next.messages.some((message) => message.sender === 'team')) {
          setIsTeamConnected(true);
          if (next.outgoingStatus === 'delivered' && pendingSendGenerationRef.current === null) {
            setWaitingForReply(false);
          }
        }
      }
    } finally {
      if (pollingRef.current === generation) pollingRef.current = null;
    }
  }, [fetchTeamMessages, identity, sessionId]);

  useEffect(() => {
    if (!requested || !sessionId || !pollingEnabled || !environmentReady) return;
    let cancelled = false;
    const schedule = () => {
      const baseDelay = waitingForReply ? 1000 : 2000;
      const activeDelay = Math.min(baseDelay * (2 ** pollFailuresRef.current), MAX_POLL_BACKOFF_MS);
      if (!passivePollingRef.current && activePollingMsRef.current + activeDelay > MAX_ACTIVE_POLLING_MS) {
        passivePollingRef.current = true;
        setWaitingForReply(false);
      }
      const delay = passivePollingRef.current ? PASSIVE_POLLING_MS : activeDelay;
      timerRef.current = setTimeout(async () => {
        if (!passivePollingRef.current) activePollingMsRef.current += delay;
        await poll().then(
          () => { pollFailuresRef.current = 0; },
          () => { pollFailuresRef.current = Math.min(pollFailuresRef.current + 1, 4); }
        );
        if (!cancelled) schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [environmentReady, poll, pollingEnabled, requested, sessionId, waitingForReply]);

  const requestHandoff = useCallback(() => {
    if (requested) return false;
    setRequested(true);
    setStatus('requested');
    return true;
  }, [requested]);

  const send = useCallback(async (text: string): Promise<SendResult> => {
    if (identity !== identityRef.current || sessionId !== sessionIdRef.current) return 'invalidated';
    if (!sessionId) return 'failed';
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    pollingRef.current = null;
    pendingSendGenerationRef.current = generation;
    activePollingMsRef.current = 0;
    passivePollingRef.current = false;
    pollFailuresRef.current = 0;
    setPollingEnabled(true);
    setWaitingForReply(true);
    setStatus('sending');
    const retry = retryRef.current?.text === text ? retryRef.current : {
      text,
      requestId: crypto.randomUUID()
    };
    retryRef.current = retry;
    const result = await relayUserMessage(sessionId, text, retry.requestId);
    const sent = typeof result === 'boolean' ? result : result.persisted;
    if (identity !== identityRef.current || sessionId !== sessionIdRef.current || generation !== generationRef.current) return 'invalidated';
    if (pendingSendGenerationRef.current === generation) pendingSendGenerationRef.current = null;
    if (sent) {
      retryRef.current = null;
      setStatus((current) => {
        if (current === 'delivered') return current;
        return typeof result === 'boolean' || result.queued ? 'queued' : 'saved';
      });
    }
    else {
      setWaitingForReply(false);
      setStatus((current) => current === 'delivered' ? current : 'requested');
    }
    return sent ? 'persisted' : 'failed';
  }, [identity, relayUserMessage, sessionId]);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    generationRef.current += 1;
    const nextIdentity = identityRef.current + 1;
    identityRef.current = nextIdentity;
    setIdentity(nextIdentity);
    pollingRef.current = null;
    sinceIdRef.current = 0;
    retryRef.current = null;
    pendingSendGenerationRef.current = null;
    pollFailuresRef.current = 0;
    activePollingMsRef.current = 0;
    passivePollingRef.current = false;
    setRequested(false); setStatus('idle'); setIsTeamConnected(false); setWaitingForReply(false); setPollingEnabled(true);
    setFileRequestOpen(false); setFileRequestNote(null); setScheduleRequestOpen(false); setMessages([]);
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setWaitingForReply(false);
    setPollingEnabled(false);
  }, []);

  const resume = useCallback(() => {
    activePollingMsRef.current = 0;
    passivePollingRef.current = false;
    pollFailuresRef.current = 0;
    setPollingEnabled(true);
  }, []);

  const clearRequests = useCallback(() => {
    setFileRequestOpen(false); setFileRequestNote(null); setScheduleRequestOpen(false);
  }, []);

  const markUploadPending = useCallback(() => {
    setWaitingForReply(false); setStatus('queued');
  }, []);

  const markUploadFailed = useCallback(() => {
    setWaitingForReply(false); setStatus('requested');
  }, []);

  const markRequested = useCallback(() => setStatus('requested'), []);

  return {
    requested, status, isTeamConnected, waitingForReply, fileRequestOpen, fileRequestNote, scheduleRequestOpen, messages,
    requestHandoff, send, poll, reset, stop, resume, clearRequests, markUploadPending, markUploadFailed, markRequested
  };
}
