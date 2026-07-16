'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RelayMessageResult, TeamMessage, TeamPollState } from '@/lib/api/client';

type Dependencies = {
  sessionId: string | null;
  fetchTeamMessages: (sessionId: string, sinceId?: number) => Promise<TeamPollState>;
  relayUserMessage: (sessionId: string, text: string, requestId: string) => Promise<RelayMessageResult | boolean>;
};

type SendResult = 'persisted' | 'failed' | 'invalidated';

export function useTeamRelay({ sessionId, fetchTeamMessages, relayUserMessage }: Dependencies) {
  const [requested, setRequested] = useState(false);
  const [status, setStatus] = useState<'idle' | 'requested' | 'sending' | 'saved' | 'queued' | 'delivered' | 'unavailable' | 'replied'>('idle');
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
    setRequested(false); setStatus('idle'); setIsTeamConnected(false); setWaitingForReply(false); setPollingEnabled(true);
    setFileRequestOpen(false); setFileRequestNote(null); setScheduleRequestOpen(false); setMessages([]);
  }, [sessionId]);

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
          if (current === 'replied') return current;
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
          setWaitingForReply(false);
          setIsTeamConnected(true);
          setStatus('replied');
        }
      }
    } finally {
      if (pollingRef.current === generation) pollingRef.current = null;
    }
  }, [fetchTeamMessages, identity, sessionId]);

  useEffect(() => {
    if (!requested || !sessionId || !pollingEnabled) return;
    let cancelled = false;
    const schedule = () => {
      timerRef.current = setTimeout(async () => {
        await poll().catch(() => undefined);
        if (!cancelled) schedule();
      }, waitingForReply ? 1000 : 2000);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll, pollingEnabled, requested, sessionId, waitingForReply]);

  const requestHandoff = useCallback(() => {
    if (requested) return false;
    setRequested(true);
    setStatus((current) => current === 'replied' ? current : 'requested');
    return true;
  }, [requested]);

  const send = useCallback(async (text: string): Promise<SendResult> => {
    if (identity !== identityRef.current || sessionId !== sessionIdRef.current) return 'invalidated';
    if (!sessionId) return 'failed';
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    pollingRef.current = null;
    pendingSendGenerationRef.current = generation;
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
        if (current === 'replied' || current === 'delivered') return current;
        return typeof result === 'boolean' || result.queued ? 'queued' : 'saved';
      });
    }
    else {
      setWaitingForReply(false);
      setStatus((current) => current === 'replied' || current === 'delivered' ? current : 'requested');
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
    setRequested(false); setStatus('idle'); setIsTeamConnected(false); setWaitingForReply(false); setPollingEnabled(true);
    setFileRequestOpen(false); setFileRequestNote(null); setScheduleRequestOpen(false); setMessages([]);
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setWaitingForReply(false);
    setPollingEnabled(false);
  }, []);

  const resume = useCallback(() => setPollingEnabled(true), []);

  const clearRequests = useCallback(() => {
    setFileRequestOpen(false); setFileRequestNote(null); setScheduleRequestOpen(false);
  }, []);

  const markUploadPending = useCallback(() => {
    setWaitingForReply(false); setStatus((current) => current === 'replied' ? current : 'queued');
  }, []);

  const markUploadFailed = useCallback(() => {
    setWaitingForReply(false); setStatus((current) => current === 'replied' ? current : 'requested');
  }, []);

  const markRequested = useCallback(() => setStatus((current) => current === 'replied' ? current : 'requested'), []);

  return {
    requested, status, isTeamConnected, waitingForReply, fileRequestOpen, fileRequestNote, scheduleRequestOpen, messages,
    requestHandoff, send, poll, reset, stop, resume, clearRequests, markUploadPending, markUploadFailed, markRequested
  };
}
