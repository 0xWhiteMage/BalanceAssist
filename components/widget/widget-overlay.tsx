'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TypingDots } from '@/components/chat/typing-dots';
import { MessageBubble } from '@/components/chat/message-bubble';
import { CalendlyEmbed } from '@/components/chat/calendly-embed';
import {
  BotAvatarSmall,
  FileRequestBanner,
  FileRequestInputHint,
  HumanFooter,
  TeamTypingIndicator,
  UploadPolicyModal,
  WidgetOverlayHeader
} from '@/components/widget/widget-overlay-parts';
import { ReviewPanel } from '@/components/widget/review-panel';
import { AttachmentDropzone, type ReferenceFile, type ReferenceLink } from '@/components/widget/attachment-dropzone';
import { brandTokens } from '@/lib/brand-tokens';
import { applyTextToDraft, getDraftSummaryLines, getNextConversationStep } from '@/lib/conversation/extract';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';
import { conversationSteps, getQuickReplyLabel, tryMatchOption } from '@/lib/conversation/flow';
import { detectProjectIntent } from '@/lib/conversation/project-intent';
import { getFallbackResponse, getLocalResponse } from '@/lib/conversation/local-responses';
import { addReferenceLink, createSession, fetchTeamMessages, finalizeLead, logEvent, notifyScheduleCompleted, relayUserMessage, uploadRequestedFiles, verifySession, type TeamMessage } from '@/lib/api/client';
import { scoreLead } from '@/lib/qualification/score';
import { isBriefReadyForApproval } from '@/lib/conversation/review-state';
import type { ChatMessage, ConversationStepId, InlineCard } from '@/lib/conversation/types';
import { HUMAN_UPLOAD_GUIDANCE, UPLOAD_ACCEPT_ATTRIBUTE, validateUploadFile } from '@/lib/uploads/file-policy';

let messageCounter = 0;
function nextId() {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}

export const SESSION_STORAGE_KEY = 'balance-assist:sessionId';

function readStoredSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSessionId(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  } catch {
    // ignore quota / privacy mode errors
  }
}

function clearStoredSessionId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const WIDGET_WIDTH_CHAT_ONLY = 'min(380px, calc(100vw - 48px))';
export const WIDGET_WIDTH_WITH_RAIL = 'min(820px, calc(100vw - 48px))';

export function getWidgetWidth({
  isTeamConnected,
  hasProjectIntent
}: {
  isTeamConnected: boolean;
  hasProjectIntent: boolean;
}): string {
  if (isTeamConnected || !hasProjectIntent) return WIDGET_WIDTH_CHAT_ONLY;
  return WIDGET_WIDTH_WITH_RAIL;
}

function resolveBotTexts(stepId: ConversationStepId, draft: LeadDraft): string[] {
  const step = conversationSteps[stepId];
  const raw = step.botMessages;
  return typeof raw === 'function' ? raw(draft) : raw;
}

function getSectionSummary(currentStep: ConversationStepId, draft: LeadDraft): string | null {
  const lines = getDraftSummaryLines(draft);
  if (lines.length === 0) return null;

  if (currentStep === 'scope' || currentStep === 'service') {
    return `So far I have:\n\n${lines
      .filter((line) => line.startsWith('Project scope:') || line.startsWith('Service:'))
      .map((line) => `• ${line}`)
      .join('\n')}\n\nAnything to correct before we move on?`;
  }

  if (currentStep === 'timeline' || currentStep === 'budget') {
    return `So far I have:\n\n${lines
      .filter((line) => line.startsWith('Timeline:') || line.startsWith('Budget:') || line.startsWith('Service:'))
      .map((line) => `• ${line}`)
      .join('\n')}\n\nDoes that look right?`;
  }

  if (currentStep === 'contact-name' || currentStep === 'contact-email') {
    return `I now have the core brief:\n\n${lines.map((line) => `• ${line}`).join('\n')}\n\nAnything you'd like me to correct before I summarise it for the team?`;
  }

  return null;
}

function createAttachment(file: File) {
  const size =
    file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.round(file.size / 1024)} KB`;

  const mediaKind: 'image' | 'video' | undefined = file.type.startsWith('image/')
    ? 'image'
    : file.type.startsWith('video/')
      ? 'video'
      : undefined;

  return {
    name: file.name,
    size,
    mediaKind,
    previewUrl: mediaKind ? URL.createObjectURL(file) : undefined
  };
}

function cleanupAttachmentPreviews(messages: ChatMessage[]) {
  for (const message of messages) {
    const previewUrl = message.attachment?.previewUrl;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }
}

export function WidgetOverlay({
  autoOpen = false,
  calendlyUrlOverride
}: {
  autoOpen?: boolean;
  calendlyUrlOverride?: string;
}) {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [view, setView] = useState<'chat' | 'calendly'>('chat');
  const [calendlyUrl, setCalendlyUrl] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStep, setCurrentStep] = useState<ConversationStepId>('intro');
  const [draft, setDraft] = useState<LeadDraft>(createDefaultLeadDraft());
  const [hasProjectIntent, setHasProjectIntent] = useState(false);
  const [briefApproved, setBriefApproved] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [allowAttachment, setAllowAttachment] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isTeamConnected, setIsTeamConnected] = useState(false);
  const [humanStatus, setHumanStatus] = useState<'idle' | 'connected' | 'delivered' | 'awaiting' | 'replied'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [teamWaitingForReply, setTeamWaitingForReply] = useState(false);
  const [humanFileRequestOpen, setHumanFileRequestOpen] = useState(false);
  const [humanFileRequestNote, setHumanFileRequestNote] = useState<string | null>(null);
  const [humanScheduleRequestOpen, setHumanScheduleRequestOpen] = useState(false);
  const [showUploadPolicy, setShowUploadPolicy] = useState(false);
  const [railMode, setRailMode] = useState<'essentials' | 'summary'>('essentials');
  const [referenceLinks, setReferenceLinks] = useState<ReferenceLink[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const lastTeamMessageIdRef = useRef<number>(0);
  const pollIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPollingRef = useRef<boolean>(false);
  const seenTeamMessageIdsRef = useRef<Set<number>>(new Set());
  const submitInFlightRef = useRef<boolean>(false);
  const approveInFlightRef = useRef<boolean>(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollImmediateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const draftRef = useRef(draft);
  const stepRef = useRef(currentStep);
  const teamRef = useRef(isTeamConnected);
  const humanFileRequestOpenRef = useRef(humanFileRequestOpen);
  const humanFileRequestNoteRef = useRef(humanFileRequestNote);
  const humanScheduleRequestOpenRef = useRef(humanScheduleRequestOpen);

  messagesRef.current = messages;
  draftRef.current = draft;
  stepRef.current = currentStep;
  teamRef.current = isTeamConnected;
  sessionIdRef.current = sessionId;
  humanFileRequestOpenRef.current = humanFileRequestOpen;
  humanFileRequestNoteRef.current = humanFileRequestNote;
  humanScheduleRequestOpenRef.current = humanScheduleRequestOpen;

  const pollTeamMessages = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const id = sessionIdRef.current;
      if (!id) return;

      const pollState = await fetchTeamMessages(id, lastTeamMessageIdRef.current);
      if (pollState.fileRequestOpen !== humanFileRequestOpenRef.current) {
        setHumanFileRequestOpen(pollState.fileRequestOpen);
      }
      if (pollState.fileRequestNote !== humanFileRequestNoteRef.current) {
        setHumanFileRequestNote(pollState.fileRequestNote);
      }
      if (pollState.scheduleRequestOpen !== humanScheduleRequestOpenRef.current) {
        setHumanScheduleRequestOpen(pollState.scheduleRequestOpen);
      }

      const messages = pollState.messages;
      if (messages.length === 0) return;

      const existingDbIds = new Set<number>();
      for (const m of messagesRef.current) {
        if (m.isTeamMessage && m.teamDbId !== undefined) {
          existingDbIds.add(m.teamDbId);
        }
      }

      const freshMessages = messages.filter(
        (m) => !seenTeamMessageIdsRef.current.has(m.id) && !existingDbIds.has(m.id)
      );
      if (freshMessages.length === 0) {
        lastTeamMessageIdRef.current = Math.max(lastTeamMessageIdRef.current, ...messages.map((m) => m.id));
        return;
      }

      for (const msg of freshMessages) {
        seenTeamMessageIdsRef.current.add(msg.id);
      }
      lastTeamMessageIdRef.current = Math.max(lastTeamMessageIdRef.current, ...messages.map((m) => m.id));
      setTeamWaitingForReply(false);
      setHumanStatus('replied');

      const next = [...messagesRef.current];
      for (const msg of freshMessages) {
        next.push({
          id: nextId(),
          sender: 'bot',
          text: msg.text,
          timestamp: Date.now(),
          isTeamMessage: true,
          teamDbId: msg.id
        });
      }
      messagesRef.current = next;
      setMessages(next);
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  const hasInitializedTeamPollingRef = useRef(false);
  const pollRateMsRef = useRef(2000);

  useEffect(() => {
    pollRateMsRef.current = teamWaitingForReply ? 1000 : 2000;
  }, [teamWaitingForReply]);

  useEffect(() => {
    if (!isTeamConnected || !sessionId) {
      return undefined;
    }

    if (!hasInitializedTeamPollingRef.current) {
      lastTeamMessageIdRef.current = 0;
      setTeamWaitingForReply(false);
      hasInitializedTeamPollingRef.current = true;
    }

    pollTeamMessages().catch(() => undefined);

    const scheduleNextPoll = () => {
      pollIntervalRef.current = setTimeout(async () => {
        await pollTeamMessages().catch(() => undefined);
        if (!cancelRef.current && teamRef.current && sessionIdRef.current) {
          scheduleNextPoll();
        }
      }, pollRateMsRef.current);
    };

    scheduleNextPoll();

    return () => {
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current);
      }
      pollIntervalRef.current = null;
    };
  }, [isTeamConnected, sessionId, pollTeamMessages]);

  useEffect(() => {
    if (!isTeamConnected) {
      hasInitializedTeamPollingRef.current = false;
      seenTeamMessageIdsRef.current = new Set();
      lastTeamMessageIdRef.current = 0;
    }
  }, [isTeamConnected]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  useEffect(() => {
    if (isTeamConnected && humanScheduleRequestOpen && calendlyUrl && view === 'chat') {
      setView('calendly');
    }
  }, [isTeamConnected, humanScheduleRequestOpen, calendlyUrl, view]);

  useEffect(() => {
    if (isTeamConnected || briefApproved) return;
    if (isBriefReadyForApproval(draft) && railMode === 'essentials') {
      setRailMode('summary');
    }
  }, [draft, isTeamConnected, briefApproved, railMode]);

  useEffect(() => {
    if (!attachmentOpen) return undefined;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-testid="attachment-popover"]')) return;
      if (target.closest('button[aria-label="Attach references"]')) return;
      setAttachmentOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [attachmentOpen]);

  useEffect(() => {
    if (!attachmentOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAttachmentOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [attachmentOpen]);

  useEffect(() => {
    return () => {
      cleanupAttachmentPreviews(messagesRef.current);
    };
  }, []);

  const botSay = useCallback(
    async (
      text: string,
      options?: {
        quickReplies?: ChatMessage['quickReplies'];
        inlineCards?: InlineCard[];
        sharedWork?: ChatMessage['sharedWork'];
        isDisclaimer?: boolean;
        isSystem?: boolean;
        delay?: number;
      }
    ): Promise<void> => {
      if (cancelRef.current) return;

      setIsTyping(true);
      const delay = options?.delay ?? Math.min(400 + text.length * 6, 1800);
      await sleep(delay);

      if (cancelRef.current) return;

      setIsTyping(false);
      const botMessage: ChatMessage = {
        id: nextId(),
        sender: 'bot',
        text,
        timestamp: Date.now(),
        quickReplies: options?.quickReplies,
        inlineCards: options?.inlineCards,
        sharedWork: options?.sharedWork,
        isDisclaimer: options?.isDisclaimer
      };
      const nextMessages = [...messagesRef.current, botMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
    },
    []
  );

  const advanceStep = useCallback(
    async (stepId: ConversationStepId, draftForMessages: LeadDraft) => {
      if (cancelRef.current) return;

      setCurrentStep(stepId);
      const step = conversationSteps[stepId];
      const texts = resolveBotTexts(stepId, draftForMessages);

      for (let i = 0; i < texts.length; i++) {
        if (cancelRef.current) return;
        const isLast = i === texts.length - 1;
        await botSay(texts[i], {
          isDisclaimer: stepId === 'intro' && i === 1,
          quickReplies: isLast ? step.quickReplies : undefined,
          inlineCards: isLast ? step.inlineCards : undefined
        });
      }

      if (texts.length === 0 && step.inlineCards) {
        if (cancelRef.current) return;
        await botSay('', { inlineCards: step.inlineCards });
      }

      setAllowAttachment(Boolean(step.allowAttachment));
    },
    [botSay]
  );

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (typeof window === 'undefined') return null;

    const sourceUrl = window.location.href;
    const referrer = document.referrer || undefined;

    try {
      const session = await createSession({ sourceUrl, referrer });

      if (session?.sessionId) {
        if (session.persisted === false) {
          console.error(
            '[widget] Session not persisted to Supabase. Check Vercel env vars and redeploy.'
          );
        }

        setSessionId(session.sessionId);
        sessionIdRef.current = session.sessionId;
        writeStoredSessionId(session.sessionId);
        return session.sessionId;
      }
    } catch (error) {
      console.error('[widget] Failed to create session', error);
    }

    return null;
  }, []);

  const loadOrCreateSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (typeof window === 'undefined') return null;

    const stored = readStoredSessionId();
    if (stored) {
      try {
        const valid = await verifySession(stored);
        if (valid) {
          setSessionId(stored);
          sessionIdRef.current = stored;
          return stored;
        }
      } catch {
        // fall through to creation
      }
      clearStoredSessionId();
    }

    return ensureSession();
  }, [ensureSession]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionIdRef.current) return;
    loadOrCreateSession().catch(() => undefined);
  }, [loadOrCreateSession]);

const startConversation = useCallback(async () => {
    if (hasStarted) return;
    setHasStarted(true);
    cancelRef.current = false;

    await advanceStep('intro', createDefaultLeadDraft());
  }, [hasStarted, advanceStep]);

  useEffect(() => {
    if (isOpen && !hasStarted) {
      const t = setTimeout(() => startConversation(), 400);
      return () => clearTimeout(t);
    }
  }, [isOpen, hasStarted, startConversation]);

  function handleClose() {
    if (sessionIdRef.current) {
      void logEvent({ sessionId: sessionIdRef.current, eventName: 'widget_closed' });
    }
    cancelRef.current = true;
    cleanupAttachmentPreviews(messagesRef.current);
    setIsOpen(false);
    setHumanFileRequestOpen(false);
    setHumanFileRequestNote(null);
    setHumanScheduleRequestOpen(false);
    if (pollIntervalRef.current) {
      clearTimeout(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (pollImmediateTimerRef.current) {
      clearTimeout(pollImmediateTimerRef.current);
      pollImmediateTimerRef.current = null;
    }
  }

  function handleOpen() {
    cancelRef.current = false;
    setIsOpen(true);
  }

  function handleReset() {
    clearStoredSessionId();
    setSessionId(null);
    sessionIdRef.current = null;
    cancelRef.current = true;
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (pollImmediateTimerRef.current) {
      clearTimeout(pollImmediateTimerRef.current);
      pollImmediateTimerRef.current = null;
    }
    cleanupAttachmentPreviews(messagesRef.current);
    messagesRef.current = [];
    setMessages([]);
    setDraft(createDefaultLeadDraft());
    setHasProjectIntent(false);
    setBriefApproved(false);
    setCurrentStep('intro');
    setHasStarted(false);
    setIsTeamConnected(false);
    setHumanStatus('idle');
    setHumanFileRequestOpen(false);
    setHumanFileRequestNote(null);
    setHumanScheduleRequestOpen(false);
    setRailMode('essentials');
    setReferenceLinks([]);
    setReferenceFiles([]);
    setAttachmentOpen(false);
    setView('chat');
    setAllowAttachment(false);
    approveInFlightRef.current = false;
    cancelRef.current = false;
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      startConversation();
    }, 200);
  }

  async function handleLLMResponse(history: ChatMessage[]) {
    const latestUserText = [...history].reverse().find((message) => message.sender === 'user')?.text ?? '';

    try {
      const llmMessages = history
        .filter((message) => message.text.trim().length > 0)
        .slice(-6)
        .map((message) => ({
          role: message.sender === 'user' ? 'user' : 'assistant',
          content: message.text
        }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: llmMessages,
          context: {
            step: stepRef.current,
            isTeamConnected: teamRef.current,
            draft: JSON.stringify(draftRef.current),
            sessionId: sessionIdRef.current ?? undefined
          }
        })
      });

      const data = await response.json();
      if (!response.ok) {
        const localFallback = getLocalResponse(latestUserText, {
          draft: draftRef.current,
          step: stepRef.current,
          isTeamConnected: teamRef.current
        });
        await botSay(localFallback ?? getFallbackResponse());
        return;
      }

      const replyChunks: string[] = (() => {
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          return data.messages.filter((chunk: unknown) => typeof chunk === 'string' && chunk.trim().length > 0);
        }
        if (typeof data.message === 'string' && data.message.trim().length > 0) {
          return [data.message];
        }
        return [getFallbackResponse()];
      })();
      const draftUpdates: Record<string, string> = data.draftUpdates ?? {};
      const briefReady: boolean = Boolean(data.briefReady);
      const sharedWork = data.sharedWork;

      if (Object.keys(draftUpdates).length > 0) {
        const merged = applyTextToDraft(latestUserText, draftRef.current, stepRef.current);
        for (const [key, value] of Object.entries(draftUpdates)) {
          if (value && value.trim().length > 0) {
            (merged as Record<string, unknown>)[key] = value;
          }
        }
        setDraft(merged);
        setHasProjectIntent(detectProjectIntent(merged));
        setBriefApproved(false);

        const nextStep = getNextConversationStep(merged);
        if (nextStep !== stepRef.current) {
          setCurrentStep(nextStep);
        }
      }

      for (let i = 0; i < replyChunks.length; i++) {
        const isFirst = i === 0;
        const chunk = replyChunks[i];
        await botSay(chunk, isFirst && sharedWork ? { sharedWork } : undefined);
      }
    } catch {
      try {
        const localFallback = getLocalResponse(latestUserText, {
          draft: draftRef.current,
          step: stepRef.current,
          isTeamConnected: teamRef.current
        });
        await botSay(localFallback ?? getFallbackResponse());
      } catch {
        await botSay(getFallbackResponse());
      }
    }
  }

  async function handleTeamConnect() {
    if (isTeamConnected) return;
    setIsTeamConnected(true);
    setHumanStatus('connected');
    setCurrentStep('free-chat');

    await ensureSession();
    if (sessionIdRef.current) {
      void logEvent({ sessionId: sessionIdRef.current, eventName: 'human_handoff' });
    }

    const connectMsg: ChatMessage = {
      id: nextId(),
      sender: 'bot',
      text: 'Connected to Balance Studio team. Type your message below and it will be sent directly to our producers.',
      timestamp: Date.now(),
      isSystem: true
    };
    const next = [...messagesRef.current, connectMsg];
    messagesRef.current = next;
    setMessages(next);
  }

  function handleDraftEdit(key: string, value: string) {
    const editableKeys: ReadonlySet<keyof LeadDraft> = new Set([
      'projectScope',
      'projectType',
      'service',
      'timelineBand',
      'budgetBand',
      'contactName',
      'contactCompany',
      'contactEmail'
    ]);
    if (!editableKeys.has(key as keyof LeadDraft)) return;

    const nextDraft = { ...draft, [key]: value } as LeadDraft;
    setDraft(nextDraft);
    setHasProjectIntent(detectProjectIntent(nextDraft));
    setBriefApproved(false);

    const nextStep = getNextConversationStep(nextDraft);
    if (nextStep !== currentStep) {
      setCurrentStep(nextStep);
    }
  }

  async function appendReferenceLink(link: ReferenceLink) {
    setReferenceLinks((prev) => [...prev, link]);
    const id = sessionIdRef.current ?? (await loadOrCreateSession());
    if (!id) return;
    void addReferenceLink({ sessionId: id, url: link.url, kind: link.kind });
  }

  function appendReferenceFile(file: ReferenceFile) {
    setReferenceFiles((prev) => [...prev, file]);
  }

  async function handleApproveBrief() {
    if (approveInFlightRef.current || briefApproved) return;
    approveInFlightRef.current = true;
    setBriefApproved(true);

    try {
      await ensureSession();
      if (!sessionIdRef.current) return;

      const result = scoreLead(draftRef.current);
      const payload = {
        sessionId: sessionIdRef.current,
        qualificationStatus: result.status,
        score: result.score,
        recommendedNextStep: result.recommendedNextStep,
        leadDraft: {
          ...draftRef.current,
          referenceLinks,
          referenceFiles
        }
      } as const;

      await finalizeLead(payload);
      setCurrentStep('handoff');
      await botSay('Thanks — your project brief is approved and ready for the Balance team. You can continue refining it, book a call, or talk to the team directly.');
      await advanceStep('handoff', draftRef.current);
    } finally {
      // keep approveInFlightRef true once approved, so future calls remain no-ops.
    }
  }

  async function processFlowAnswer(value: string, displayLabel?: string) {
    const step = conversationSteps[currentStep];
    const userMsg: ChatMessage = {
      id: nextId(),
      sender: 'user',
      text: displayLabel ?? value,
      timestamp: Date.now()
    };
    const nextMessages = [...messagesRef.current, userMsg];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    let updatedDraft = draft;

    if (step.freeText || currentStep === 'intro') {
      updatedDraft = applyTextToDraft(value, draft, currentStep);
      setDraft(updatedDraft);
      setBriefApproved(false);
    } else if (step.field) {
      updatedDraft = { ...draft, [step.field]: value };
      setDraft(updatedDraft);
      setBriefApproved(false);
    }

    const isFreeTextIntakeStep =
      (step.freeText || currentStep === 'intro') &&
      currentStep !== 'qualification' &&
      currentStep !== 'offer-upload' &&
      currentStep !== 'upload' &&
      currentStep !== 'handoff';

    if (isFreeTextIntakeStep && value.trim().length >= 3) {
      await handleLLMResponse(nextMessages);
      return;
    }

    let nextStepId: ConversationStepId | undefined;

    if (
      currentStep === 'intro' ||
      currentStep === 'scope' ||
      currentStep === 'service' ||
      currentStep === 'timeline' ||
      currentStep === 'budget' ||
      currentStep === 'contact-name' ||
      currentStep === 'contact-email'
    ) {
      nextStepId = getNextConversationStep(updatedDraft);
    } else if (typeof step.next === 'function') {
      nextStepId = step.next(value);
    } else {
      nextStepId = step.next;
    }

    if (nextStepId) {
      await ensureSession();
    }

    if (sessionIdRef.current && nextStepId) {
      void logEvent({
        sessionId: sessionIdRef.current,
        eventName: 'step_advanced',
        properties: { from: currentStep, to: nextStepId }
      });
    }

    const summary = getSectionSummary(currentStep, updatedDraft);
    if (summary) {
      await botSay(summary, { delay: 250 });
    }

    if (nextStepId) {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        advanceStep(nextStepId!, updatedDraft).catch(() => undefined);
      }, 300);
    }
  }

  function appendUserMessage(text: string) {
    const userMsg: ChatMessage = { id: nextId(), sender: 'user', text, timestamp: Date.now() };
    const nextMessages = [...messagesRef.current, userMsg];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    return userMsg;
  }

  async function handleSubmitText() {
    if (submitInFlightRef.current) return;
    const trimmed = inputValue.trim();
    if (!trimmed || isTyping) return;
    submitInFlightRef.current = true;
    setInputValue('');

    try {
      const step = conversationSteps[currentStep];

      const memoryResetPattern = /forget.*this.*project|reset.*my.*project|clear.*my.*project|start.*over/i;
      if (!isTeamConnected && memoryResetPattern.test(trimmed)) {
        appendUserMessage(trimmed);
        await botSay("I've cleared my memory of this project. We can start fresh.");
        if (resetTimerRef.current) {
          clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = setTimeout(() => {
          resetTimerRef.current = null;
          handleReset();
        }, 200);
        return;
      }

      const memoryUpdatePattern = /\b(update that|correct that|change that|actually|correction)\b/i;
      if (!isTeamConnected && memoryUpdatePattern.test(trimmed)) {
        const updatedDraft = applyTextToDraft(trimmed, draft, currentStep);
        setDraft(updatedDraft);
        setBriefApproved(false);
        appendUserMessage(trimmed);
        const lines = getDraftSummaryLines(updatedDraft);
        await botSay(
          lines.length > 0
            ? `Updated. I now have:\n\n${lines.map((line) => `• ${line}`).join('\n')}`
            : 'Updated. What would you like me to capture next?'
        );
        return;
      }

      const humanKeywords = /talk.*to.*human|speak.*to.*human|real.*person|human.*agent|connect.*team|connect.*me/i;
      if (humanKeywords.test(trimmed) && !isTeamConnected) {
        appendUserMessage(trimmed);
        handleTeamConnect();
        return;
      }

      if (isTeamConnected) {
        await ensureSession();
        const id = sessionIdRef.current;
        appendUserMessage(trimmed);
        setTeamWaitingForReply(true);
        setHumanStatus('delivered');

        if (!id) {
          setTeamWaitingForReply(false);
          setHumanStatus('connected');
          return;
        }

        const ok = await relayUserMessage(id, trimmed);
        if (!ok) {
          setTeamWaitingForReply(false);
          setHumanStatus('connected');
          await botSay('Sorry, I could not reach the team right now. Please email hello@balancestudio.tv.');
          return;
        }

        setHumanStatus('awaiting');
        if (pollImmediateTimerRef.current) {
          clearTimeout(pollImmediateTimerRef.current);
        }
        pollImmediateTimerRef.current = setTimeout(() => {
          pollImmediateTimerRef.current = null;
          pollTeamMessages().catch(() => undefined);
        }, 500);
        return;
      }

      if (currentStep === 'free-chat') {
        await ensureSession();
        appendUserMessage(trimmed);

        const localResponse = getLocalResponse(trimmed, {
          draft,
          step: currentStep,
          isTeamConnected
        });

        if (localResponse) {
          await botSay(localResponse);
          return;
        }

        await handleLLMResponse(messagesRef.current);
        return;
      }

      const matched = step.quickReplies ? tryMatchOption(trimmed, step) : null;
      if (matched) {
        processFlowAnswer(matched, getQuickReplyLabel(currentStep, matched));
        return;
      }

      const localResponse = getLocalResponse(trimmed, {
        draft,
        step: currentStep,
        isTeamConnected
      });

      if (localResponse) {
        appendUserMessage(trimmed);
        await botSay(localResponse);
        return;
      }

      if (step.freeText) {
        processFlowAnswer(trimmed);
        return;
      }

      await ensureSession();
      appendUserMessage(trimmed);
      try {
        await handleLLMResponse(messagesRef.current);
      } catch {
        await botSay(getFallbackResponse());
      }
    } finally {
      setIsTyping(false);
      submitInFlightRef.current = false;
    }
  }

  function handleSubmitQuickReply(value: string, label: string) {
    if (isTyping) return;
    processFlowAnswer(value, label);
  }

  function handleInlineCardClick(card: InlineCard) {
    if (card.type === 'calendly') {
      setCalendlyUrl(calendlyUrlOverride ?? card.url);
      setView('calendly');
    } else if (card.type === 'telegram') {
      handleTeamConnect();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitText();
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    for (const file of files) {
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        e.target.value = '';
        await botSay(`${validation.reason}\n\n${HUMAN_UPLOAD_GUIDANCE}`);
        return;
      }
    }

    if (isTeamConnected) {
      await ensureSession();
      const id = sessionIdRef.current;
      if (!id) return;

      const nextMessages = [...messagesRef.current];
      for (const file of files) {
        nextMessages.push({
          id: nextId(),
          sender: 'user',
          text: `Shared: ${file.name}`,
          timestamp: Date.now(),
          attachment: createAttachment(file)
        });
      }
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      setTeamWaitingForReply(true);
      setHumanStatus('delivered');

      const uploadResult = await uploadRequestedFiles(id, files);
      if (!uploadResult.ok) {
        setTeamWaitingForReply(false);
        setHumanStatus('connected');
        await botSay(uploadResult.error ?? 'Sorry, the files could not be delivered to the team. Please try again or ask the team to resend the upload request.');
      } else {
        setHumanStatus('awaiting');
        setHumanFileRequestOpen(false);
        setHumanFileRequestNote(null);
      }

      e.target.value = '';
      return;
    }

    const nextMessages = [...messagesRef.current];
    for (const file of files) {
      nextMessages.push({
        id: nextId(),
        sender: 'user',
        text: `Shared: ${file.name}`,
        timestamp: Date.now(),
        attachment: createAttachment(file)
      });
    }
    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    await sleep(500);
    if (cancelRef.current) return;

    await botSay(`Got it! I\u2019ve received ${files.length === 1 ? `**${files[0].name}**` : `${files.length} files`}. Our team will review them alongside your project details.`);
    setAllowAttachment(false);

    await sleep(400);
    if (cancelRef.current) return;

    await advanceStep('handoff', draftRef.current);

    e.target.value = '';
  }

  const showAttachmentButton = isTeamConnected ? humanFileRequestOpen : allowAttachment;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 2147483647,
        fontFamily: brandTokens.typography.ui
      }}
    >
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: '72px',
            right: '0px',
            width: getWidgetWidth({ isTeamConnected, hasProjectIntent }),
            height: 'min(580px, calc(100vh - 120px))',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: '16px',
            overflow: 'hidden',
            background: brandTokens.gradients.panel,
            color: brandTokens.colors.lightText,
            boxShadow: brandTokens.shadows.panel,
            border: `1px solid ${brandTokens.colors.border}`,
            animation: 'balance-assist-fade-in 0.2s ease-out'
          }}
        >
          {/* Calendly View Overlay */}
          {view === 'calendly' && calendlyUrl && (
            <CalendlyEmbed
              url={calendlyUrl}
              onBack={() => setView('chat')}
              onScheduled={async () => {
                if (sessionIdRef.current) {
                  await notifyScheduleCompleted(sessionIdRef.current);
                }
                setHumanScheduleRequestOpen(false);
                setHumanStatus('delivered');
                setView('chat');
                await botSay('Your booking has been sent to the Balance team. They have been notified automatically.');
              }}
            />
          )}

          {showUploadPolicy && <UploadPolicyModal onClose={() => setShowUploadPolicy(false)} />}

          <WidgetOverlayHeader isTeamConnected={isTeamConnected} onClose={handleClose} />

          <div
            style={{
              flex: 1,
              display: 'flex',
              gap: '0',
              minHeight: 0,
              position: 'relative'
            }}
          >
            {!isTeamConnected && hasProjectIntent && (
              <div
                data-testid="review-rail"
                style={{
                  width: 280,
                  flexShrink: 0,
                  borderRight: `1px solid ${brandTokens.colors.subtleBorder}`,
                  overflowY: 'auto',
                  background: 'rgba(16, 16, 16, 0.35)'
                }}
              >
                <ReviewPanel
                  draft={draft}
                  approved={briefApproved}
                  mode={railMode}
                  onApprove={handleApproveBrief}
                  onContinueRefining={() => {
                    setBriefApproved(false);
                    setRailMode('essentials');
                  }}
                  onChange={handleDraftEdit}
                />
              </div>
            )}

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '16px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                minWidth: 0,
                maxWidth: '100%',
                position: 'relative'
              }}
            >
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} onQuickReply={handleSubmitQuickReply} onInlineCardClick={handleInlineCardClick} />
              ))}

              {isTyping && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  <BotAvatarSmall />
                  <TypingDots />
                </div>
              )}

              {!isTyping && isTeamConnected && teamWaitingForReply && <TeamTypingIndicator />}

              {!isTyping && isTeamConnected && humanFileRequestOpen && <FileRequestBanner note={humanFileRequestNote} />}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Bar */}
          {isTeamConnected && humanFileRequestOpen && <FileRequestInputHint />}
          {showAttachmentButton && (
            <div
              style={{
                padding: '6px 12px 0',
                background: 'rgba(16, 16, 16, 0.4)',
                textAlign: 'right',
                flexShrink: 0
              }}
            >
              <button
                type="button"
                onClick={() => setShowUploadPolicy(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: brandTokens.colors.mutedText,
                  fontSize: '11px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px'
                }}
              >
                Accepted file types
              </button>
            </div>
          )}
          <div
            style={{
              padding: '10px 12px',
              borderTop: `1px solid ${brandTokens.colors.subtleBorder}`,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(16, 16, 16, 0.4)',
              position: 'relative'
            }}
          >
            {!isTeamConnected && (
              <>
                <button
                  type="button"
                  aria-label="Attach references"
                  aria-expanded={attachmentOpen}
                  onClick={() => setAttachmentOpen((o) => !o)}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: `1px solid ${brandTokens.colors.border}`,
                    background: attachmentOpen ? 'rgba(219, 181, 128, 0.10)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke={brandTokens.colors.warmGold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {attachmentOpen && (
                  <div
                    data-testid="attachment-popover"
                    style={{
                      position: 'absolute',
                      left: 12,
                      right: 12,
                      bottom: 'calc(100% + 6px)',
                      padding: 12,
                      borderRadius: 12,
                      border: `1px solid ${brandTokens.colors.border}`,
                      background: brandTokens.gradients.panel,
                      boxShadow: '0 -10px 30px rgba(0,0,0,0.45)',
                      zIndex: 100
                    }}
                  >
                    <AttachmentDropzone
                      onAddLink={appendReferenceLink}
                      onAddFile={appendReferenceFile}
                      sessionId={sessionId}
                    />
                  </div>
                )}
              </>
            )}
            {showAttachmentButton && (
              <label
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  border: `1px solid ${brandTokens.colors.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                <input type="file" multiple accept={UPLOAD_ACCEPT_ATTRIBUTE} onChange={handleFileSelect} style={{ display: 'none' }} />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke={brandTokens.colors.warmGold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </label>
            )}
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isTeamConnected ? 'Message the team...' : 'Type your message...'}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '20px',
                border: `1px solid ${brandTokens.colors.subtleBorder}`,
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                color: brandTokens.colors.lightText,
                fontFamily: brandTokens.typography.ui,
                fontSize: '13px',
                outline: 'none'
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = brandTokens.colors.warmGold)}
              onBlur={(e) => (e.currentTarget.style.borderColor = brandTokens.colors.subtleBorder)}
            />
            <button
              onClick={handleSubmitText}
              disabled={!inputValue.trim() || isTyping}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                border: 'none',
                background:
                  inputValue.trim() && !isTyping
                    ? `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`
                    : 'rgba(255, 255, 255, 0.08)',
                cursor: inputValue.trim() && !isTyping ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke={inputValue.trim() && !isTyping ? '#101010' : brandTokens.colors.mutedText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <HumanFooter isTeamConnected={isTeamConnected} humanStatus={humanStatus} onConnect={handleTeamConnect} />
        </div>
      )}

      {/* Launcher / Close Button */}
      {isOpen ? (
        <button
          onClick={handleClose}
          aria-label="Close Balance Assist"
          style={{
            position: 'absolute',
            bottom: '0px',
            right: '0px',
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
            boxShadow: '0 8px 32px rgba(219, 181, 128, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="#101010" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <button
          onClick={handleOpen}
          aria-label="Open Balance Assist"
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
            boxShadow: '0 8px 32px rgba(219, 181, 128, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.477 2 2 5.97 2 10.5c0 2.3 1.29 4.37 3.5 5.78V20l3.5-2c.97.17 1.97.25 3 .25 5.523 0 10-3.97 10-8.75S17.523 2 12 2z" fill="#101010" />
            <circle cx="8" cy="10.5" r="1.2" fill={brandTokens.colors.warmGold} />
            <circle cx="12" cy="10.5" r="1.2" fill={brandTokens.colors.warmGold} />
            <circle cx="16" cy="10.5" r="1.2" fill={brandTokens.colors.warmGold} />
          </svg>
        </button>
      )}
    </div>
  );
}
