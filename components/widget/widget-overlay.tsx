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
import { DataUseNotice } from '@/components/widget/data-use-notice';
import { brandTokens } from '@/lib/brand-tokens';
import { applyTextToDraft, getDraftSummaryLines, getNextConversationStep } from '@/lib/conversation/extract';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';
import { conversationSteps } from '@/lib/conversation/flow';
import { detectProjectIntent } from '@/lib/conversation/project-intent';
import { getFallbackResponse, getLocalResponse, getNextMissingFieldPrompt } from '@/lib/conversation/local-responses';
import { chatRequest, createSession, fetchProjectDraft, fetchTeamMessages, finalizeLead, getCurrentSession, logEvent, recordProducerTransferConsent, relayUserMessage, requestProjectDeletion, resetProject, updateProjectDraft, uploadRequestedFiles, type TeamMessage } from '@/lib/api/client';
import { useWidgetSessionDraft } from '@/components/widget/use-widget-session-draft';
import { useTeamRelay } from '@/components/widget/use-team-relay';
import { isBriefReadyForApproval } from '@/lib/conversation/review-state';
import type { ChatMessage, ConversationStepId, InlineCard } from '@/lib/conversation/types';
import type { ConsentRecord } from '@/lib/privacy/notice';
import { HUMAN_UPLOAD_GUIDANCE, UPLOAD_ACCEPT_ATTRIBUTE, validateUploadFile } from '@/lib/uploads/file-policy';
import { useDialogFocus } from '@/components/widget/use-dialog-focus';

let messageCounter = 0;
function nextId() {
  messageCounter += 1;
  return `msg-${messageCounter}`;
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

const CAPTURED_FIELD_KEYS_FOR_LLM = [
  'projectScope',
  'projectType',
  'service',
  'timelineBand',
  'budgetBand',
  'contactName',
  'contactCompany',
  'contactEmail'
] as const;

function computeCapturedFieldsFromDraft(draft: LeadDraft): string[] {
  const captured: string[] = [];
  for (const key of CAPTURED_FIELD_KEYS_FOR_LLM) {
    const value = (draft as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      captured.push(key);
    }
  }
  return captured;
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
  const sessionDraft = useWidgetSessionDraft({ createSession, getCurrentSession, fetchProjectDraft, updateProjectDraft, resetProject, requestProjectDeletion });
  const {
    draft, setDraft, noticeConsent, setNoticeConsent, hasProjectIntent, setHasProjectIntent,
    briefApproved, setBriefApproved, sessionId, sessionUnavailable, isSessionExpired,
    draftVersion, setDraftVersion
  } = sessionDraft;
  const [isTyping, setIsTyping] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [allowAttachment, setAllowAttachment] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const teamRelay = useTeamRelay({ sessionId, fetchTeamMessages, relayUserMessage });
  const {
    isTeamConnected, requested: humanRequested, status: humanStatus, waitingForReply: teamWaitingForReply,
    fileRequestOpen: humanFileRequestOpen, fileRequestNote: humanFileRequestNote,
    scheduleRequestOpen: humanScheduleRequestOpen
  } = teamRelay;
  const [showUploadPolicy, setShowUploadPolicy] = useState(false);
  const [railMode, setRailMode] = useState<'essentials' | 'summary'>('essentials');
  const [referenceLinks, setReferenceLinks] = useState<ReferenceLink[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [telegramBroadcastStatus, setTelegramBroadcastStatus] = useState<'pending' | 'sent' | 'queued' | 'unconfigured'>('unconfigured');
  const [tabMode, setTabMode] = useState<'chat' | 'brief'>('chat');
  const [isMobile, setIsMobile] = useState(false);
  const submitInFlightRef = useRef<boolean>(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionBootstrapPromiseRef = useRef<Promise<string | null> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const draftRef = useRef(draft);
  const draftVersionRef = useRef(draftVersion);
  const stepRef = useRef(currentStep);
  const teamRef = useRef(isTeamConnected);
  const humanFileRequestOpenRef = useRef(humanFileRequestOpen);
  const humanFileRequestNoteRef = useRef(humanFileRequestNote);
  const humanScheduleRequestOpenRef = useRef(humanScheduleRequestOpen);
  const attachmentDialogRef = useRef<HTMLDivElement>(null);

  messagesRef.current = messages;
  draftRef.current = draft;
  draftVersionRef.current = draftVersion;
  stepRef.current = currentStep;
  teamRef.current = isTeamConnected;
  humanFileRequestOpenRef.current = humanFileRequestOpen;
  humanFileRequestNoteRef.current = humanFileRequestNote;
  humanScheduleRequestOpenRef.current = humanScheduleRequestOpen;

  const applyCanonicalDraftState = sessionDraft.applyCanonicalDraft;
  const hydrateCanonicalDraft = sessionDraft.hydrateDraft;
  const { messages: teamMessages, reset: resetTeamRelay } = teamRelay;


  useEffect(() => {
    const delivered = teamMessages.filter(
      (message) => !messagesRef.current.some((existing) => existing.teamDbId === message.id)
    );
    if (delivered.length === 0) return;
    const next = [...messagesRef.current, ...delivered.map((message) => ({
      id: nextId(), sender: 'bot' as const, text: message.text, timestamp: Date.now(), isTeamMessage: true, teamDbId: message.id
    }))];
    messagesRef.current = next;
    setMessages(next);
  }, [teamMessages]);

  useEffect(() => {
    resetTeamRelay();
  }, [sessionId, resetTeamRelay]);

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
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const widgetContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      cleanupAttachmentPreviews(messagesRef.current);
    };
  }, []);

  const botSay = useCallback(
    async (
      text: string,
      options?: {
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

  const ensureSession = sessionDraft.ensureSession;
  const loadOrCreateSession = sessionDraft.loadOrCreateSession;

  const startConversation = useCallback(async () => {
    if (hasStarted || isTeamConnected || !noticeConsent) return;
    cancelRef.current = false;

    const activeSessionId = await loadOrCreateSession();
    if (!activeSessionId) return;

    setHasStarted(true);
    await advanceStep('intro', createDefaultLeadDraft());
  }, [advanceStep, hasStarted, isTeamConnected, loadOrCreateSession, noticeConsent]);

  function handleClose() {
    if (sessionId) {
      void logEvent({ sessionId, eventName: 'widget_closed' });
    }
    cancelRef.current = true;
    cleanupAttachmentPreviews(messagesRef.current);
    setIsOpen(false);
    teamRelay.clearRequests();
    teamRelay.stop();
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }

  function handleOpen() {
    cancelRef.current = false;
    setIsOpen(true);
  }

  useDialogFocus({ active: isOpen, dialogRef: widgetContainerRef, onDismiss: handleClose });
  useDialogFocus({ active: attachmentOpen, dialogRef: attachmentDialogRef, onDismiss: () => setAttachmentOpen(false) });

  function handleReset() {
    sessionDraft.reset();
    teamRelay.reset();
    cancelRef.current = true;
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    cleanupAttachmentPreviews(messagesRef.current);
    messagesRef.current = [];
    setMessages([]);
    setCurrentStep('intro');
    setHasStarted(false);
    setRailMode('essentials');
    setReferenceLinks([]);
    setReferenceFiles([]);
    setAttachmentOpen(false);
    setView('chat');
    setCalendlyUrl(null);
    setAllowAttachment(false);
    cancelRef.current = false;
  }

  async function handleLLMResponse(history: ChatMessage[]) {
    const latestUserText = [...history].reverse().find((message) => message.sender === 'user')?.text ?? '';

    try {
      const llmMessages = history
        .filter((message) => message.sender === 'user' && message.text.trim().length > 0)
        .slice(-6)
        .map((message) => ({
          role: 'user' as const,
          content: message.text
        }));

      const capturedFields = computeCapturedFieldsFromDraft(draftRef.current);

      const data = await chatRequest({
        messages: llmMessages,
        context: {
          step: stepRef.current,
          isTeamConnected: teamRef.current,
          sessionId: sessionId ?? undefined,
          capturedFields
        }
      });
      if (!data) {
        const localFallback = getLocalResponse(latestUserText, {
          draft: draftRef.current,
          step: stepRef.current,
          isTeamConnected: teamRef.current
        });
        await botSay(localFallback ?? getFallbackResponse());
        return;
      }

      const replyChunks: string[] = (() => {
        if (data.replies.length > 0) return data.replies.map((reply) => reply.text);
        return [getNextMissingFieldPrompt(draftRef.current)];
      })();
      const draftUpdates: Record<string, string | boolean> = data.draftUpdates ?? {};
      const sharedWork = data.sharedWork
        ? {
            entries: data.sharedWork.entries.map((entry) => ({
              ...entry,
              description: entry.description ?? '',
              image_url: entry.image_url ?? '',
              category: entry.category ?? 'reference'
            }))
          }
        : null;

      if (Object.keys(draftUpdates).length > 0) {
        const merged = applyTextToDraft(latestUserText, draftRef.current, stepRef.current);
        for (const [key, value] of Object.entries(draftUpdates)) {
          if (typeof value === 'boolean') {
            (merged as Record<string, unknown>)[key] = value;
          } else if (value && value.trim().length > 0) {
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
        // The chat route persists authenticated updates. Replace optimistic values with its canonical version.
        if (sessionId) {
          await hydrateCanonicalDraft(sessionId);
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
    if (humanRequested || !noticeConsent) return;
    const activeSessionId = await loadOrCreateSession();
    if (!activeSessionId) return;

    if (!await recordProducerTransferConsent(activeSessionId)) {
      await botSay('Sorry — we could not confirm consent to share messages with the Balance team. Please try again.');
      return;
    }
    if (!teamRelay.requestHandoff()) return;
    setCurrentStep('free-chat');

    void logEvent({ sessionId: activeSessionId, eventName: 'human_handoff' });

    const connectMsg: ChatMessage = {
      id: nextId(),
      sender: 'bot',
      text: 'Your request to contact the Balance team is ready. Send a message and we will confirm when the team replies.',
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

    const activeSessionId = sessionId;
    if (!activeSessionId) {
      return;
    }

    const provenance = value.trim().length > 0 ? 'confirmed' : 'cleared';
    void updateProjectDraft(
      activeSessionId,
      [{ field: key, value, provenance }],
      draftVersionRef.current
    ).then(async (result) => {
      if (!result) {
        return;
      }

      if (result.ok) {
        applyCanonicalDraftState(result.draft, result.draftVersion);
        return;
      }

      if (result.conflict) {
        applyCanonicalDraftState(result.draft, result.draftVersion);
        await botSay('This brief changed elsewhere, so I reloaded the latest saved version before applying more edits.');
        return;
      }

      await botSay('Sorry — I could not save that brief edit. Please try again.');
    });
  }

  async function appendReferenceLink(link: ReferenceLink) {
    setReferenceLinks((prev) => [...prev, link]);
  }

  function appendReferenceFile(file: ReferenceFile) {
    setReferenceFiles((prev) => [...prev, file]);
  }

  async function handleFileAnalyzed(_fileName: string, extractedText: string) {
    const trimmed = extractedText.trim();
    if (!trimmed) return;
    appendUserMessage('Analyzed temporary attachment');
    await botSay('Reading the temporary attachment — pulling out the key details…', { delay: 150 });
    if (cancelRef.current) return;
    const prompt = `Server-verified attachment analysis text:\n\n${trimmed.slice(0, 3000)}\n\nPlease extract any project brief fields from this text and update the brief. Tell the user what you found.`;
    const syntheticHistory: ChatMessage[] = [
      ...messagesRef.current,
      { id: nextId(), sender: 'user', text: prompt, timestamp: Date.now() }
    ];
    await handleLLMResponse(syntheticHistory);
  }

  async function handleApproveBrief() {
    if (!sessionDraft.beginApproval()) return;
    setTelegramBroadcastStatus('pending');

    try {
      const activeSessionId = await ensureSession();
      if (!activeSessionId) {
        sessionDraft.finishApproval(false);
        setTelegramBroadcastStatus('unconfigured');
        return;
      }

      if (!await recordProducerTransferConsent(activeSessionId)) {
        sessionDraft.finishApproval(false);
        setTelegramBroadcastStatus('unconfigured');
        await botSay('Sorry — we could not confirm consent to share your brief with the Balance team. Please try again.');
        return;
      }

      const finalizeResponse = await finalizeLead({ sessionId: activeSessionId });
      if (!finalizeResponse || !finalizeResponse.ok || finalizeResponse.persisted !== true) {
        sessionDraft.finishApproval(false);
        setTelegramBroadcastStatus('unconfigured');
        await botSay('Sorry — the brief could not be saved. Please try again or contact the team directly.');
        return;
      }

      sessionDraft.finishApproval(true);
      if (finalizeResponse.delivered === true) {
        setTelegramBroadcastStatus('sent');
      } else if (finalizeResponse.queued === true) {
        setTelegramBroadcastStatus('queued');
      } else {
        setTelegramBroadcastStatus('unconfigured');
      }
      setCurrentStep('handoff');
      await botSay('Thanks — your project brief is approved and ready for the Balance team. You can continue refining it, book a call, or talk to the team directly.');
      await advanceStep('handoff', draftRef.current);
    } catch {
      sessionDraft.finishApproval(false);
      setTelegramBroadcastStatus('unconfigured');
      await botSay('Sorry — something went wrong saving your brief. Please try again.');
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

    const isLlmIntakeStep =
      currentStep === 'intro' ||
      currentStep === 'scope' ||
      currentStep === 'service' ||
      currentStep === 'timeline' ||
      currentStep === 'budget' ||
      currentStep === 'contact-name' ||
      currentStep === 'contact-email';

    if (isLlmIntakeStep && value.trim().length > 0) {
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

    if (sessionId && nextStepId) {
      void logEvent({
        sessionId,
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
      const isIntakeStep =
        currentStep === 'intro' ||
        currentStep === 'scope' ||
        currentStep === 'service' ||
        currentStep === 'timeline' ||
        currentStep === 'budget' ||
        currentStep === 'contact-name' ||
        currentStep === 'contact-email';

      const memoryResetPattern = /forget.*this.*project|reset.*my.*project|clear.*my.*project|start.*over/i;
      if (!isTeamConnected && memoryResetPattern.test(trimmed)) {
        appendUserMessage(trimmed);
        const activeSessionId = sessionId ?? await loadOrCreateSession();
        const cleared = activeSessionId ? await resetProject(activeSessionId) : false;

        if (!cleared) {
          await botSay("Sorry — I couldn't clear the saved project yet. You can keep editing it here or request deletion from the team.");
          return;
        }

        await botSay("I've cleared the saved project for this session. We can start fresh.");
        if (resetTimerRef.current) {
          clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = setTimeout(() => {
          resetTimerRef.current = null;
          handleReset();
        }, 200);
        return;
      }

      const deletionPattern = /delete.*(this )?(project|data)|erase.*(this )?(project|data)|remove.*my.*data/i;
      if (!isTeamConnected && deletionPattern.test(trimmed)) {
        appendUserMessage(trimmed);
        const activeSessionId = sessionId ?? await loadOrCreateSession();
        const deletionResult = activeSessionId ? await requestProjectDeletion(activeSessionId) : { ok: false };

        if (!deletionResult.ok) {
          await botSay("Sorry — I couldn't submit the deletion request right now. Please try again or ask the team directly.");
          return;
        }

        await botSay(deletionResult.message ?? 'We recorded your deletion request.');
        return;
      }

      const humanKeywords = /talk.*to.*human|speak.*to.*human|real.*person|human.*agent|connect.*team|connect.*me/i;
      if (humanKeywords.test(trimmed) && !isTeamConnected) {
        appendUserMessage(trimmed);
        handleTeamConnect();
        return;
      }

      if (humanRequested) {
        await ensureSession();
        const id = sessionId;
        appendUserMessage(trimmed);
        if (!id) {
          return;
        }

        const ok = await teamRelay.send(trimmed);
        if (!ok) {
          await botSay('Sorry, I could not reach the team right now. Please email hello@balancestudio.tv.');
          return;
        }

        void teamRelay.poll();
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

      const memoryRecallPattern = /what.*do.*you.*remember|what.*have.*i.*shared|what.*do.*you.*know.*about.*my.*project/i;
      const aiDisclosurePattern = /are.*you.*(?:bot|ai|robot|machine)|is.*this.*(?:bot|ai|automated)|are.*you.*real|are.*you.*human|am.*i.*talking.*to.*(?:bot|ai|human|person)/i;

      if (!isTeamConnected && isIntakeStep && trimmed.length > 0) {
        if (memoryRecallPattern.test(trimmed) || aiDisclosurePattern.test(trimmed)) {
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
        }

        appendUserMessage(trimmed);
        await handleLLMResponse(messagesRef.current);
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

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, nextTab: 'chat' | 'brief') {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const selected = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'brief' : nextTab;
    setTabMode(selected);
    document.getElementById(`widget-${selected}-tab`)?.focus();
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
      const id = sessionId;
      if (!id) return;

      const confirmed =
        typeof window === 'undefined'
          ? true
          : window.confirm('The Balance team may review these files when secure handoff is available. Continue?');
      if (!confirmed) {
        e.target.value = '';
        return;
      }

      if (!await recordProducerTransferConsent(id)) {
        await botSay('Sorry — we could not confirm consent to share files with the Balance team. Please try again.');
        e.target.value = '';
        return;
      }

      const nextMessages = [...messagesRef.current];
      for (const file of files) {
        nextMessages.push({
          id: nextId(),
          sender: 'user',
          text: `Upload quarantined: ${file.name}`,
          timestamp: Date.now(),
          attachment: createAttachment(file)
        });
      }
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      teamRelay.markUploadPending();

      const uploadResult = await uploadRequestedFiles(id, files);
      if (!uploadResult.ok) {
        teamRelay.markUploadFailed();
        await botSay(uploadResult.error ?? 'Sorry, the files could not be quarantined for review. Please try again.');
      } else {
        await botSay('Your files are quarantined pending review. They have not been shared with the Balance team yet.');
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

  const canInteract = !isSessionExpired && (hasStarted || isTeamConnected);
  const showNoticeGate = !noticeConsent;
  const showStartChoices = noticeConsent !== null && !canInteract && messages.length === 0;
  const showAttachmentButton = false;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'max(24px, env(safe-area-inset-bottom))',
        right: 'max(24px, env(safe-area-inset-right))',
        zIndex: 2147483647,
        fontFamily: brandTokens.typography.ui
      }}
    >
      {isOpen && (
        <div
          ref={widgetContainerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Balance Assist"
          aria-labelledby="balance-assist-dialog-title"
          tabIndex={-1}
          style={{
            position: 'absolute',
            bottom: '72px',
            right: '0px',
            width: isMobile ? 'min(380px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right)))' : getWidgetWidth({ isTeamConnected, hasProjectIntent }),
            height: 'min(580px, calc(100dvh - 120px - env(safe-area-inset-bottom)))',
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
                setView('chat');
                const message: ChatMessage = {
                  id: nextId(),
                  sender: 'bot',
                  text: "Calendly reported that you completed a booking. We're still verifying that the Balance team received it.",
                  timestamp: Date.now(),
                  isSystem: true
                };
                const nextMessages = [...messagesRef.current, message];
                messagesRef.current = nextMessages;
                setMessages(nextMessages);
              }}
            />
          )}

          {showUploadPolicy && <UploadPolicyModal onClose={() => setShowUploadPolicy(false)} />}

          <WidgetOverlayHeader isTeamConnected={isTeamConnected} onClose={handleClose} />

          {isMobile && !isTeamConnected && hasProjectIntent && (
            <div
              role="tablist"
              aria-label="Widget sections"
              style={{
                display: 'flex',
                borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`,
                background: 'rgba(16, 16, 16, 0.4)',
                flexShrink: 0
              }}
            >
              <button
                role="tab"
                aria-selected={tabMode === 'chat'}
                aria-controls="widget-chat-panel"
                id="widget-chat-tab"
                tabIndex={tabMode === 'chat' ? 0 : -1}
                onClick={() => setTabMode('chat')}
                onKeyDown={(event) => handleTabKeyDown(event, 'brief')}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  background: tabMode === 'chat' ? 'rgba(219, 181, 128, 0.10)' : 'transparent',
                  border: 'none',
                  borderBottom: tabMode === 'chat' ? `2px solid ${brandTokens.colors.warmGold}` : '2px solid transparent',
                  color: tabMode === 'chat' ? brandTokens.colors.warmGold : brandTokens.colors.mutedText,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.10em'
                }}
              >
                Chat
              </button>
              <button
                role="tab"
                aria-selected={tabMode === 'brief'}
                aria-controls="widget-brief-panel"
                id="widget-brief-tab"
                tabIndex={tabMode === 'brief' ? 0 : -1}
                onClick={() => setTabMode('brief')}
                onKeyDown={(event) => handleTabKeyDown(event, 'chat')}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  background: tabMode === 'brief' ? 'rgba(219, 181, 128, 0.10)' : 'transparent',
                  border: 'none',
                  borderBottom: tabMode === 'brief' ? `2px solid ${brandTokens.colors.warmGold}` : '2px solid transparent',
                  color: tabMode === 'brief' ? brandTokens.colors.warmGold : brandTokens.colors.mutedText,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.10em'
                }}
              >
                Brief
              </button>
            </div>
          )}

          <div
            style={{
              flex: 1,
              display: 'flex',
              gap: '0',
              minHeight: 0,
              position: 'relative'
            }}
          >
            {!isTeamConnected && hasProjectIntent && !(isMobile && tabMode !== 'brief') && (
              <div
                data-testid="review-rail"
                id={isMobile ? 'widget-brief-panel' : undefined}
                role={isMobile ? 'tabpanel' : undefined}
                aria-labelledby={isMobile ? 'widget-brief-tab' : undefined}
                style={{
                  width: isMobile ? '100%' : 280,
                  flexShrink: 0,
                  borderRight: isMobile ? 'none' : `1px solid ${brandTokens.colors.subtleBorder}`,
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
                  telegramBroadcastStatus={telegramBroadcastStatus}
                  onBookCatchUp={() => {
                    setCalendlyUrl('https://calendly.com/haiha-dang/catch-up');
                    setView('calendly');
                  }}
                  onTalkToHuman={handleTeamConnect}
                />
              </div>
            )}

            {!(isMobile && tabMode !== 'chat') && (
              <div
                id={isMobile ? 'widget-chat-panel' : undefined}
                role={isMobile ? 'tabpanel' : undefined}
                aria-labelledby={isMobile ? 'widget-chat-tab' : undefined}
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
                {showNoticeGate ? (
                  <DataUseNotice onConsent={setNoticeConsent} />
                ) : showStartChoices ? (
                  <div
                    data-testid="widget-start-options"
                    style={{
                      display: 'grid',
                      gap: 12,
                      padding: 12,
                      borderRadius: 12,
                      border: `1px solid ${brandTokens.colors.subtleBorder}`,
                      background: 'rgba(255, 255, 255, 0.03)'
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: brandTokens.colors.mutedText }}>
                      Choose how you want to continue. Start with Balance Assist for an AI-led brief, or go straight to the team.
                    </p>
                    {sessionUnavailable && (
                      <p role="status" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: brandTokens.colors.warmGold }}>
                        Session service is temporarily unavailable. Please try again.
                      </p>
                    )}
                    {isSessionExpired && (
                      <p role="status" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: brandTokens.colors.warmGold }}>
                        This temporary session expired. Start again to create a fresh private session.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        void startConversation();
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 999,
                        border: 'none',
                        background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
                        color: brandTokens.colors.baseBlack,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em'
                      }}
                    >
                      Start with Balance Assist
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleTeamConnect();
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 999,
                        border: `1px solid ${brandTokens.colors.border}`,
                        background: 'transparent',
                        color: brandTokens.colors.lightText,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em'
                      }}
                    >
                      Talk to a human
                    </button>
                  </div>
                ) : (
                  <div role="log" aria-live="polite" aria-relevant="additions text" style={{ display: 'contents' }}>
                    {messages.map((msg) => (
                      <MessageBubble key={msg.id} message={msg} onInlineCardClick={handleInlineCardClick} />
                    ))}

                    {isTyping && (
                      <div role="status" aria-label="Balance Assist is typing" style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                        <BotAvatarSmall />
                        <TypingDots />
                      </div>
                    )}

                    {!isTyping && isTeamConnected && teamWaitingForReply && <div role="status" aria-label="Balance team is preparing a reply"><TeamTypingIndicator /></div>}

                    {!isTyping && isTeamConnected && humanFileRequestOpen && <FileRequestBanner note={humanFileRequestNote} />}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Bar */}
          {canInteract && (
            <>
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
                  position: 'relative',
                  paddingBottom: 'max(10px, env(safe-area-inset-bottom))'
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
                        width: '44px',
                        height: '44px',
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
                        ref={attachmentDialogRef}
                        data-testid="attachment-popover"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Add private references"
                        tabIndex={-1}
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
                          zIndex: 100,
                          maxHeight: 'min(420px, calc(100dvh - 180px))',
                          overflowY: 'auto'
                        }}
                      >
                        <AttachmentDropzone
                          onAddLink={appendReferenceLink}
                          onAddFile={appendReferenceFile}
                          onFileAnalyzed={handleFileAnalyzed}
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
                    fontSize: isMobile ? '16px' : '13px',
                    outline: 'none'
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = brandTokens.colors.warmGold)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = brandTokens.colors.subtleBorder)}
                />
                <button
                  onClick={handleSubmitText}
                  disabled={!inputValue.trim() || isTyping}
                  style={{
                    width: '44px',
                    height: '44px',
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

              <HumanFooter isTeamConnected={humanRequested} humanStatus={humanStatus} onConnect={handleTeamConnect} />
            </>
          )}
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
