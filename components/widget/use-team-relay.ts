'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RelayMessageResult, TeamMessage, TeamPollState } from '@/lib/api/client';

type Dependencies = {
  sessionId: string | null;
  fetchTeamMessages: (sessionId: string, sinceId?: number) => Promise<TeamPollState>;
  relayUserMessage: (sessionId: string, text: string, requestId: string) => Promise<RelayMessageResult | boolean>;
};

export function useTeamRelay({ sessionId, fetchTeamMessages, relayUserMessage }: Dependencies) {
  const [requested, setRequested] = useState(false);
  const [status, setStatus] = useState<'idle' | 'requested' | 'sending' | 'saved' | 'queued' | 'delivered' | 'replied'>('idle');
  const [isTeamConnected, setIsTeamConnected] = useState(false);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [fileRequestOpen, setFileRequestOpen] = useState(false);
  const [fileRequestNote, setFileRequestNote] = useState<string | null>(null);
  const [scheduleRequestOpen, setScheduleRequestOpen] = useState(false);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const sinceIdRef = useRef(0);
  const pollingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<{ text: string; requestId: string } | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(true);

  const poll = useCallback(async () => {
    if (!sessionId || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const next = await fetchTeamMessages(sessionId, sinceIdRef.current);
      setFileRequestOpen(next.fileRequestOpen);
      setFileRequestNote(next.fileRequestNote);
      setScheduleRequestOpen(next.scheduleRequestOpen);
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
      pollingRef.current = false;
    }
  }, [fetchTeamMessages, sessionId]);

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
    setStatus('requested');
    return true;
  }, [requested]);

  const send = useCallback(async (text: string) => {
    if (!sessionId) return false;
    setWaitingForReply(true);
    setStatus('sending');
    const retry = retryRef.current?.text === text ? retryRef.current : {
      text,
      requestId: crypto.randomUUID()
    };
    retryRef.current = retry;
    const result = await relayUserMessage(sessionId, text, retry.requestId);
    const sent = typeof result === 'boolean' ? result : result.persisted;
    if (sent) {
      retryRef.current = null;
      setStatus(typeof result === 'boolean' || result.queued ? (typeof result !== 'boolean' && result.delivered ? 'delivered' : 'queued') : 'saved');
    }
    else {
      setWaitingForReply(false);
      setStatus('requested');
    }
    return sent;
  }, [relayUserMessage, sessionId]);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    sinceIdRef.current = 0;
    retryRef.current = null;
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
