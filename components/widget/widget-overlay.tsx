'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TypingDots } from '@/components/chat/typing-dots';
import { MessageBubble } from '@/components/chat/message-bubble';
import { CalendlyEmbed } from '@/components/chat/calendly-embed';
import {
  BotAvatarSmall,
  ConfidentialDiversionRecovery,
  FileRequestBanner,
  HumanFallbacks,
  HumanFooter,
  SchedulingPrompt,
  UploadPolicyModal,
  WidgetOverlayHeader
} from '@/components/widget/widget-overlay-parts';
import { ReviewPanel } from '@/components/widget/review-panel';
import { TrustFeedback } from '@/components/widget/trust-feedback';
import { AttachmentDropzone } from '@/components/widget/attachment-dropzone';
import { DataUseNotice } from '@/components/widget/data-use-notice';
import { brandTokens } from '@/lib/brand-tokens';
import { getNextConversationStep } from '@/lib/conversation/extract';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';
import { conversationSteps } from '@/lib/conversation/flow';
import { addReferenceLink, chatRequest, createSession, deleteReferenceLink, fetchProjectDeletionStatus, fetchProjectDraft, fetchTeamMessages, finalizeLead, getCurrentSession, logEvent, recordHumanContactConsent, recordProducerTransferConsent, relayUserMessage, requestProjectDeletion, resetProject, updateProjectDraft, uploadRequestedFiles, withdrawProducerTransferConsent, type DeletionReceiptStatus, type TeamMessage } from '@/lib/api/client';
import { useWidgetSessionDraft } from '@/components/widget/use-widget-session-draft';
import { useTeamRelay } from '@/components/widget/use-team-relay';
import { getReviewPrompt, isBriefReadyForApproval } from '@/lib/conversation/review-state';
import type { ChatMessage, ConversationStepId, InlineCard } from '@/lib/conversation/types';
import { DATA_USE_NOTICE_COPY, type ConsentRecord } from '@/lib/privacy/notice';
import { HUMAN_UPLOAD_GUIDANCE, UPLOAD_ACCEPT_ATTRIBUTE, validateUploadFile } from '@/lib/uploads/file-policy';
import { useDialogFocus } from '@/components/widget/use-dialog-focus';
import { classifyUrl, getReferencePresenceStatus, normalizePublicReferenceUrl } from '@/lib/uploads/url-detect';
import { MAX_PROJECT_SCOPE_CHARACTERS, type TrustFeedbackResponse } from '@/lib/api/contracts';
import { getNextMissingFieldPrompt } from '@/lib/conversation/local-responses';
import { detectProjectIntent } from '@/lib/conversation/project-intent';

const CHAT_UNAVAILABLE_MESSAGE = 'AI chat is temporarily unavailable. Please use Talk to a human if you need help now.';
const DELETION_RECEIPT_STORAGE_KEY = 'balance-assist-deletion-receipt';

function isReviewNavigationOnly(text: string) {
  return /^Your (?:core )?brief is ready\.\s*(?:Tap|Review)\b.*(?:tab|panel|right).*\.?$/i.test(text.trim());
}

let messageCounter = 0;
function nextId() {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}

function resolveBotTexts(stepId: ConversationStepId, draft: LeadDraft): string[] {
  const step = conversationSteps[stepId];
  const raw = step.botMessages;
  return typeof raw === 'function' ? raw(draft) : raw;
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
  'projectObjective',
  'audience',
  'intendedOutputs',
  'referencesStatus',
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

export function formatMemoryInventory(draft: LeadDraft, referenceCount: number): string {
  const labels: Partial<Record<keyof LeadDraft, string>> = {
    projectScope: 'Project', projectObjective: 'Objective', audience: 'Audience', intendedOutputs: 'Outputs',
    service: 'Service', timelineBand: 'Timeline', budgetBand: 'Budget', contactName: 'Contact name',
    contactCompany: 'Company', contactEmail: 'Contact email', referencesStatus: 'References'
  };
  const facts = Object.entries(labels).flatMap(([key, label]) => {
    const value = draft[key as keyof LeadDraft];
    return typeof value === 'string' && value.trim() ? [`${label}: ${value.trim()}`] : [];
  });
  if (referenceCount > 0) facts.push(`Private reference links: ${referenceCount}`);
  if (facts.length === 0) return 'The editable brief is empty. This view does not inventory uploads, messages, consent history, approved transfers, provider copies, or backups.';
  return `Editable brief saved for this temporary session:\n${facts.map((fact) => `- ${fact}`).join('\n')}\nThis view does not inventory uploads, messages, consent history, approved transfers, provider copies, or backups.`;
}

export function WidgetOverlay({
  autoOpen = false,
  calendlyUrlOverride
}: {
  autoOpen?: boolean;
  calendlyUrlOverride?: string;
}) {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [isMaximized, setIsMaximized] = useState(false);
  const [view, setView] = useState<'chat' | 'calendly'>('chat');
  const [calendlyUrl, setCalendlyUrl] = useState<string | null>(null);
  const configuredCalendlyUrl = calendlyUrlOverride?.trim() || null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStep, setCurrentStep] = useState<ConversationStepId>('intro');
  const sessionDraft = useWidgetSessionDraft({ createSession, getCurrentSession, fetchProjectDraft, updateProjectDraft, resetProject, requestProjectDeletion });
  const {
    draft, noticeConsent, setNoticeConsent, hasProjectIntent,
    briefApproved, sessionId, sessionUnavailable, isSessionExpired,
    draftVersion, setDraftVersion, approval
  } = sessionDraft;
  const [isTyping, setIsTyping] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [entryPath, setEntryPath] = useState<'ai' | 'human' | null>(null);
  const [confidentialRecoveryOpen, setConfidentialRecoveryOpen] = useState(false);
  const teamRelay = useTeamRelay({ sessionId, fetchTeamMessages, relayUserMessage });
  const {
    isTeamConnected, requested: humanRequested, status: humanStatus,
    fileRequestOpen: humanFileRequestOpen, fileRequestNote: humanFileRequestNote,
    scheduleRequestOpen: humanScheduleRequestOpen
  } = teamRelay;
  const [showUploadPolicy, setShowUploadPolicy] = useState(false);
  const [railMode, setRailMode] = useState<'essentials' | 'summary'>('essentials');
  const referenceLinks = sessionDraft.referenceLinks;
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [telegramBroadcastStatus, setTelegramBroadcastStatus] = useState<'pending' | 'sent' | 'queued' | 'unconfigured'>('unconfigured');
  const [tabMode, setTabMode] = useState<'chat' | 'brief'>('chat');
  const [isMobile, setIsMobile] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [trustFeedbackResponse, setTrustFeedbackResponse] = useState<TrustFeedbackResponse | null>(null);
  const [deletionStatus, setDeletionStatus] = useState<DeletionReceiptStatus | null>(null);
  const [deletionConfirmationPending, setDeletionConfirmationPending] = useState(false);
  const submitInFlightRef = useRef<boolean>(false);
  const submitGenerationRef = useRef(0);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const aiBootstrapInFlightGenerationRef = useRef<number | null>(null);
  const aiBootstrapCompletedRef = useRef(false);
  const humanBootstrapInFlightGenerationRef = useRef<number | null>(null);
  const botSayGenerationRef = useRef(0);
  const previousSessionIdRef = useRef<string | null>(sessionId);
  const activeSessionIdRef = useRef<string | null>(sessionId);
  const confidentialDiversionRef = useRef(false);
  const aiProcessingGenerationRef = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const requestedFileInputRef = useRef<HTMLInputElement>(null);
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
  const composerInputRef = useRef<HTMLTextAreaElement>(null);

  messagesRef.current = messages;
  draftRef.current = draft;
  draftVersionRef.current = draftVersion;
  stepRef.current = currentStep;
  teamRef.current = isTeamConnected;
  humanFileRequestOpenRef.current = humanFileRequestOpen;
  humanFileRequestNoteRef.current = humanFileRequestNote;
  humanScheduleRequestOpenRef.current = humanScheduleRequestOpen;

  const applyCanonicalDraftState = sessionDraft.applyCanonicalDraft;
  const { messages: teamMessages, reset: resetTeamRelay } = teamRelay;
  const deletionFrozen = Boolean(deletionStatus?.receipt);
  const deletionFrozenRef = useRef(deletionFrozen);
  activeSessionIdRef.current = sessionId;
  deletionFrozenRef.current = deletionFrozen;


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
    if (typeof window.localStorage?.getItem !== 'function') return;
    const receipt = window.localStorage.getItem(DELETION_RECEIPT_STORAGE_KEY);
    if (!receipt) return;
    setDeletionStatus({ ok: true, receipt, status: 'requested' });
  }, []);

  useEffect(() => {
    const receipt = deletionStatus?.receipt;
    if (!receipt || deletionStatus.status === 'completed') return;
    let active = true;
    const poll = async () => {
      const status = await fetchProjectDeletionStatus(receipt);
      if (active && status.ok) setDeletionStatus(status);
      if (active && status.invalidReceipt) {
        window.localStorage?.removeItem?.(DELETION_RECEIPT_STORAGE_KEY);
        setDeletionStatus(null);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [deletionStatus?.receipt, deletionStatus?.status]);

  useEffect(() => {
    if (previousSessionIdRef.current !== sessionId) {
      setTrustFeedbackResponse(null);
    }
    if (previousSessionIdRef.current && previousSessionIdRef.current !== sessionId) {
      bootstrapGenerationRef.current += 1;
      aiProcessingGenerationRef.current += 1;
      submitGenerationRef.current += 1;
      aiBootstrapCompletedRef.current = false;
      cancelRef.current = true;
      submitInFlightRef.current = false;
      resetTeamRelay();
      cleanupAttachmentPreviews(messagesRef.current);
      messagesRef.current = [];
      setMessages([]);
      setEntryPath(null);
      setCurrentStep('intro');
      setHasStarted(false);
      setIsTyping(false);
    }
    previousSessionIdRef.current = sessionId;
  }, [sessionId, resetTeamRelay]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;
      messagesEndRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'end' });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  useEffect(() => {
    if (!noticeConsent || !entryPath) return;
    if (entryPath === 'ai') {
      void startConversation();
      return;
    }
    void handleTeamConnect();
  // Entry choice is intentionally the only trigger for either processing path.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPath, noticeConsent]);

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
  const launcherRef = useRef<HTMLButtonElement>(null);
  const restoreLauncherFocusRef = useRef(false);

  useEffect(() => {
    return () => {
      cleanupAttachmentPreviews(messagesRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      bootstrapGenerationRef.current += 1;
      aiProcessingGenerationRef.current += 1;
      cancelRef.current = true;
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
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
        isValid?: () => boolean;
        delayMs?: number;
      }
    ): Promise<void> => {
      const aiProcessingGeneration = aiProcessingGenerationRef.current;
      const isValid = options?.isValid ?? (() => true);
      const isCurrent = () =>
        aiProcessingGeneration === aiProcessingGenerationRef.current &&
        !cancelRef.current &&
        isValid();
      if (!isCurrent()) return;

      const botSayGeneration = botSayGenerationRef.current + 1;
      botSayGenerationRef.current = botSayGeneration;
      if (!isCurrent()) return;
      setIsTyping(true);
      if (options?.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (!isCurrent()) {
        if (botSayGenerationRef.current === botSayGeneration) setIsTyping(false);
        return;
      }

      if (!isCurrent()) return;
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
      if (!isCurrent()) return;
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
    },
    []
  );

  const advanceStep = useCallback(
    async (stepId: ConversationStepId, draftForMessages: LeadDraft, isValid: () => boolean = () => true) => {
      const aiProcessingGeneration = aiProcessingGenerationRef.current;
      const isCurrent = () =>
        aiProcessingGeneration === aiProcessingGenerationRef.current &&
        !cancelRef.current &&
        isValid();
      if (!isCurrent()) return;

      setCurrentStep(stepId);
      const step = conversationSteps[stepId];
      const texts = resolveBotTexts(stepId, draftForMessages);

      for (let i = 0; i < texts.length; i++) {
        if (cancelRef.current || !isValid()) return;
        const isLast = i === texts.length - 1;
        await botSay(texts[i], {
          isDisclaimer: stepId === 'intro' && i === 1,
          inlineCards: isLast ? step.inlineCards : undefined,
          delayMs: i === 0 ? 0 : 140,
          isValid
        });
        if (!isCurrent()) return;
      }

      if (texts.length === 0 && step.inlineCards) {
        if (!isCurrent()) return;
        await botSay('', { inlineCards: step.inlineCards, isValid });
        if (!isCurrent()) return;
      }

      if (!isCurrent()) return;
    },
    [botSay]
  );

  const ensureSession = sessionDraft.ensureSession;
  const loadOrCreateSession = sessionDraft.loadOrCreateSession;
  const getDraftSnapshot = sessionDraft.getDraftSnapshot;

  const startConversation = useCallback(async () => {
    if (aiBootstrapCompletedRef.current || isTeamConnected || !noticeConsent) return;
    const bootstrapGeneration = bootstrapGenerationRef.current;
    const aiProcessingGeneration = aiProcessingGenerationRef.current;
    if (aiBootstrapInFlightGenerationRef.current === bootstrapGeneration) return;
    aiBootstrapInFlightGenerationRef.current = bootstrapGeneration;
    cancelRef.current = false;
    setHasStarted(true);
    setIsTyping(true);
    const bootstrapIsCurrent = () =>
      bootstrapGeneration === bootstrapGenerationRef.current &&
      aiProcessingGeneration === aiProcessingGenerationRef.current &&
      !cancelRef.current;

    try {
      const activeSessionId = await loadOrCreateSession(bootstrapIsCurrent);
      if (!bootstrapIsCurrent()) return;
      if (!activeSessionId) {
        setHasStarted(false);
        setIsTyping(false);
        setEntryPath(null);
        return;
      }

      setIsTyping(false);
      const restoredDraft = getDraftSnapshot();
      if (detectProjectIntent(restoredDraft)) {
        const restoredStep = getNextConversationStep(restoredDraft);
        setCurrentStep(restoredStep);
        await botSay(
          `Welcome back. I restored your temporary brief. ${getNextMissingFieldPrompt(restoredDraft)}`,
          { isValid: bootstrapIsCurrent }
        );
      } else {
        await advanceStep('intro', createDefaultLeadDraft(), bootstrapIsCurrent);
      }
      if (bootstrapIsCurrent()) aiBootstrapCompletedRef.current = true;
    } finally {
      if (bootstrapIsCurrent() && !aiBootstrapCompletedRef.current) setIsTyping(false);
      if (aiBootstrapInFlightGenerationRef.current === bootstrapGeneration) {
        aiBootstrapInFlightGenerationRef.current = null;
      }
    }
  }, [advanceStep, botSay, getDraftSnapshot, isTeamConnected, loadOrCreateSession, noticeConsent]);

  function handleClose() {
    bootstrapGenerationRef.current += 1;
    aiProcessingGenerationRef.current += 1;
    sessionDraft.invalidateBootstrap();
    if (!aiBootstrapCompletedRef.current) setHasStarted(false);
    if (sessionId) {
      void logEvent({ sessionId, eventName: 'widget_closed' });
    }
    cancelRef.current = true;
    submitGenerationRef.current += 1;
    submitInFlightRef.current = false;
    setIsTyping(false);
    restoreLauncherFocusRef.current = true;
    setIsOpen(false);
    teamRelay.clearRequests();
    teamRelay.stop();
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }

  function handleOpen() {
    cancelRef.current = false;
    teamRelay.resume();
    setIsOpen(true);
    if (entryPath === 'ai' && noticeConsent && !aiBootstrapCompletedRef.current) void startConversation();
  }

  useDialogFocus({
    active: isOpen,
    dialogRef: widgetContainerRef,
    onDismiss: handleClose,
    modal: isMobile || isMaximized
  });
  useDialogFocus({ active: attachmentOpen, dialogRef: attachmentDialogRef, onDismiss: () => setAttachmentOpen(false) });

  useEffect(() => {
    if (isOpen || !restoreLauncherFocusRef.current) return;
    restoreLauncherFocusRef.current = false;
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, [isOpen]);

  function handleReset() {
    bootstrapGenerationRef.current += 1;
    aiProcessingGenerationRef.current += 1;
    aiBootstrapCompletedRef.current = false;
    sessionDraft.reset();
    teamRelay.reset();
    cancelRef.current = true;
    submitGenerationRef.current += 1;
    submitInFlightRef.current = false;
    setIsTyping(false);
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    cleanupAttachmentPreviews(messagesRef.current);
    messagesRef.current = [];
    setMessages([]);
    setCurrentStep('intro');
    setHasStarted(false);
    setEntryPath(null);
    setRailMode('essentials');
    setAttachmentOpen(false);
    setView('chat');
    setCalendlyUrl(null);
    setConfidentialRecoveryOpen(false);
    setApprovalError(null);
    confidentialDiversionRef.current = false;
    cancelRef.current = false;
  }

  async function handleLLMResponse(history: ChatMessage[]) {
    if (confidentialDiversionRef.current) return;
    const draftOperation = sessionDraft.beginDraftOperation();
    const aiProcessingGeneration = aiProcessingGenerationRef.current;
    const isCurrent = () =>
      aiProcessingGeneration === aiProcessingGenerationRef.current &&
      sessionDraft.isDraftOperationCurrent(draftOperation) &&
      !cancelRef.current &&
      !confidentialDiversionRef.current;
    try {
      const latestUser = [...history].reverse().find(
        (message) => message.sender === 'user' && message.text.trim().length > 0
      );
      if (!latestUser) return;
      const sharedWorkSlugs = history.flatMap((message) =>
        message.sharedWork?.entries.map((entry) => entry.slug) ?? []
      );
      const lastBotText = [...history].reverse().find(
        (message) => message.sender === 'bot' && message.text.trim().length > 0
      )?.text ?? '';
      const llmMessages = [{ role: 'user' as const, content: latestUser.text }];

      const capturedFields = computeCapturedFieldsFromDraft(draftRef.current);

      setIsTyping(true);
      const data = await chatRequest({
        messages: llmMessages,
        context: {
          step: stepRef.current,
          isTeamConnected: teamRef.current,
          sessionId: sessionId ?? undefined,
          capturedFields,
          workSearchPending: /format or service|what kind of work|which direction/i.test(lastBotText),
          sharedWorkSlugs: [...new Set(sharedWorkSlugs)].slice(-20)
        }
      });
      if (!isCurrent()) return;
      setIsTyping(false);
      if (!data) {
        await botSay(CHAT_UNAVAILABLE_MESSAGE);
        if (!isCurrent()) return;
        return;
      }

      if (data.outcome === 'provider_unavailable') {
        await botSay(CHAT_UNAVAILABLE_MESSAGE, { isValid: isCurrent });
        if (!isCurrent()) return;
        return;
      }

      if (data.outcome === 'confidential_diversion') {
        confidentialDiversionRef.current = true;
        aiProcessingGenerationRef.current += 1;
        const diversionGeneration = aiProcessingGenerationRef.current;
        const diversionIsCurrent = () =>
          diversionGeneration === aiProcessingGenerationRef.current &&
          sessionDraft.isDraftOperationCurrent(draftOperation) &&
          !cancelRef.current;
        if (advanceTimerRef.current) {
          clearTimeout(advanceTimerRef.current);
          advanceTimerRef.current = null;
        }
        for (const reply of data.replies) {
          await botSay(reply.text, { isValid: diversionIsCurrent });
          if (
            diversionGeneration !== aiProcessingGenerationRef.current ||
            cancelRef.current
          ) return;
        }
        if (diversionGeneration !== aiProcessingGenerationRef.current || cancelRef.current) return;
        setConfidentialRecoveryOpen(true);
        return;
      }

      if (data.outcome === 'draft_save_failed') {
        for (const reply of data.replies) await botSay(reply.text, { isValid: isCurrent });
        return;
      }

      if (data.outcome === 'draft_conflict') {
        if (!applyCanonicalDraftState(data.canonicalDraft, data.draftVersion, undefined, draftOperation, data.canonicalProvenance)) return;
        setCurrentStep(getNextConversationStep({ ...createDefaultLeadDraft(), ...data.canonicalDraft } as LeadDraft));
        for (const reply of data.replies) await botSay(reply.text, { isValid: isCurrent });
        return;
      }

      const replyChunks = (data.replies.length > 0
        ? data.replies.map((reply) => reply.text)
        : [CHAT_UNAVAILABLE_MESSAGE])
        .filter((reply) => !data.briefReady || !isReviewNavigationOnly(reply));
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

      if (data.outcome === 'draft_persisted') {
        if (!applyCanonicalDraftState(data.canonicalDraft, data.draftVersion, undefined, draftOperation, data.canonicalProvenance)) return;
        const nextStep = getNextConversationStep({ ...createDefaultLeadDraft(), ...data.canonicalDraft } as LeadDraft);
        if (nextStep !== stepRef.current) {
          if (!isCurrent()) return;
          setCurrentStep(nextStep);
        }
      }

      if (data.outcome === 'draft_persisted') {
        for (const recap of data.stageRecaps) {
          await botSay(recap, { isValid: isCurrent });
          if (!isCurrent()) return;
        }
      }
      for (let i = 0; i < replyChunks.length; i++) {
        const isFirst = i === 0;
        const chunk = replyChunks[i];
        await botSay(chunk, {
          ...(isFirst && sharedWork ? { sharedWork } : {}),
          delayMs: (data.outcome === 'draft_persisted' && data.stageRecaps.length > 0) || i > 0 ? 360 : 0,
          isValid: isCurrent
        });
        if (!isCurrent()) return;
      }
    } catch {
      if (!isCurrent()) return;
      await botSay(CHAT_UNAVAILABLE_MESSAGE, { isValid: isCurrent });
      if (!isCurrent()) return;
    }
  }

  async function handleTeamConnect() {
    if (humanRequested || !noticeConsent) return;
    const bootstrapGeneration = bootstrapGenerationRef.current;
    if (humanBootstrapInFlightGenerationRef.current === bootstrapGeneration) return;
    aiProcessingGenerationRef.current += 1;
    submitGenerationRef.current += 1;
    submitInFlightRef.current = false;
    setIsTyping(false);
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    humanBootstrapInFlightGenerationRef.current = bootstrapGeneration;
    const bootstrapIsCurrent = () =>
      bootstrapGeneration === bootstrapGenerationRef.current && !cancelRef.current;
    try {
      const activeSessionId = await loadOrCreateSession(bootstrapIsCurrent);
      if (!bootstrapIsCurrent() || !activeSessionId) return;
      const consentRecorded = await recordHumanContactConsent(activeSessionId);
      if (!bootstrapIsCurrent()) return;
      if (!consentRecorded) {
        await botSay('We could not save your permission to send a message to the Balance team. Please try again or use the contact options below.', {
          isValid: bootstrapIsCurrent
        });
        return;
      }

      if (!bootstrapIsCurrent()) return;
      if (!teamRelay.requestHandoff()) return;
      setCurrentStep('free-chat');

      if (!bootstrapIsCurrent()) return;
      void logEvent({ sessionId: activeSessionId, eventName: 'human_handoff' });

      const connectMsg: ChatMessage = {
        id: nextId(),
        sender: 'bot',
        text: `Your human-only relay is ready. ${DATA_USE_NOTICE_COPY.humanDisclosure}`,
        timestamp: Date.now(),
        isSystem: true
      };
      const next = [...messagesRef.current, connectMsg];
      messagesRef.current = next;
      setMessages(next);
    } finally {
      if (humanBootstrapInFlightGenerationRef.current === bootstrapGeneration) {
        humanBootstrapInFlightGenerationRef.current = null;
      }
    }
  }

  async function handleDraftEdit(key: string, value: string) {
    const editableKeys: ReadonlySet<keyof LeadDraft> = new Set([
      'projectScope', 'projectObjective', 'audience', 'intendedOutputs', 'scopePolished', 'projectType',
      'service', 'timelineBand', 'budgetBand', 'contactName', 'contactCompany', 'contactEmail'
    ]);
    if (!editableKeys.has(key as keyof LeadDraft)) return { status: 'failed', message: 'This field cannot be edited.' } as const;
    if (!sessionId) return { status: 'failed', message: 'This edit cannot be saved without an active session.' } as const;

    const operation = sessionDraft.beginDraftOperation();
    const result = await sessionDraft.updateDraft(key, value, operation);
    if (!result) return { status: 'failed', message: 'This edit was interrupted. Please retry.' } as const;
    if (result.status === 'saved') setCurrentStep(getNextConversationStep(sessionDraft.draft));
    return result;
  }

  async function addPrivateReference(url: string) {
    const normalizedUrl = normalizePublicReferenceUrl(url);
    const kind = normalizedUrl ? classifyUrl(normalizedUrl) : null;
    if (!normalizedUrl || !kind) return { status: 'failed', message: 'Enter a valid public HTTPS reference URL.' } as const;
    const activeSessionId = sessionId ?? await ensureSession();
    if (!activeSessionId) return { status: 'failed', message: 'The reference link could not be saved without an active session.' } as const;
    const existing = referenceLinks.find((link) => link.url === normalizedUrl);
    const link = existing ?? await addReferenceLink({ sessionId: activeSessionId, url: normalizedUrl, kind });
    if (!link) return { status: 'failed', message: 'The HTTPS reference link could not be saved. Please retry.' } as const;
    if (!existing) sessionDraft.appendReferenceLink(link);
    const statusResult = await sessionDraft.updateDraft('referencesStatus', 'added');
    if (statusResult?.status !== 'saved') {
      return { status: 'failed', message: 'The reference link was saved, but its brief status was not. Retry to finish saving it.' } as const;
    }
    await sessionDraft.hydrateDraft(activeSessionId);
    return { status: 'saved' } as const;
  }

  async function removePrivateReference(id: string) {
    if (!await deleteReferenceLink(id)) return { status: 'failed', message: 'The reference link could not be removed. Please retry.' } as const;
    sessionDraft.removeReferenceLink(id);
    const remaining = referenceLinks.filter((link) => link.id !== id);
    const statusResult = await sessionDraft.updateDraft('referencesStatus', getReferencePresenceStatus(remaining));
    if (statusResult?.status !== 'saved') {
      return { status: 'failed', message: 'The link was removed, but the brief status was not updated. Please retry.' } as const;
    }
    if (sessionId) await sessionDraft.hydrateDraft(sessionId);
    return { status: 'saved' } as const;
  }

  async function handleFileAnalyzed(_fileName: string, extractedText: string) {
    const trimmed = extractedText.trim();
    if (!trimmed) return;
    appendUserMessage('Analyzed temporary attachment');
    await botSay('Reading the temporary attachment and pulling out the key details.');
    if (cancelRef.current) return;
    const prompt = `Server-verified attachment analysis text:\n\n${trimmed.slice(0, 3000)}\n\nPlease extract any project brief fields from this text and update the brief. Tell the user what you found.`;
    const syntheticHistory: ChatMessage[] = [
      ...messagesRef.current,
      { id: nextId(), sender: 'user', text: prompt, timestamp: Date.now() }
    ];
    await handleLLMResponse(syntheticHistory);
  }

  async function handleApproveBrief() {
    const approvalToken = sessionDraft.beginApproval();
    if (approvalToken === null) return;
    setApprovalError(null);
    setTelegramBroadcastStatus('pending');

    try {
      const activeSessionId = await ensureSession();
      if (cancelRef.current) {
        sessionDraft.finishApproval(approvalToken, 'error');
        return;
      }
      if (!activeSessionId) {
        sessionDraft.finishApproval(approvalToken, 'error');
        setTelegramBroadcastStatus('unconfigured');
        setApprovalError('The brief was not sent. Please retry or talk to the team without AI.');
        return;
      }

      if (!await recordProducerTransferConsent(activeSessionId)) {
        if (cancelRef.current) {
          sessionDraft.finishApproval(approvalToken, 'error');
          return;
        }
        sessionDraft.finishApproval(approvalToken, 'error');
        setTelegramBroadcastStatus('unconfigured');
        setApprovalError('The brief was not sent. Please retry or talk to the team without AI.');
        await botSay('Sorry — we could not confirm consent to share your brief with the Balance team. Please try again.');
        return;
      }

      const finalizeResponse = await finalizeLead({ sessionId: activeSessionId });
      if (cancelRef.current) {
        sessionDraft.finishApproval(approvalToken, 'error');
        return;
      }
      if (!finalizeResponse || !finalizeResponse.ok || finalizeResponse.persisted !== true) {
        sessionDraft.finishApproval(approvalToken, 'error');
        setTelegramBroadcastStatus('unconfigured');
        setApprovalError('The brief was not sent. Please retry or talk to the team without AI.');
        await botSay('Sorry — the brief could not be saved. Please try again or contact the team directly.');
        return;
      }

      const approvalOutcome = sessionDraft.finishApprovalSuccess(approvalToken, finalizeResponse);
      if (approvalOutcome !== 'approved') {
        setTelegramBroadcastStatus('unconfigured');
        setApprovalError('The brief changed while it was being approved. I reloaded the latest saved version; review it and retry.');
        await sessionDraft.hydrateDraft(activeSessionId);
        await botSay('The saved brief changed during approval, so I reloaded the latest version. Please review it and retry.');
        return;
      }
      setApprovalError(null);
      if (finalizeResponse.delivered === true) {
        setTelegramBroadcastStatus('sent');
      } else if (finalizeResponse.queued === true) {
        setTelegramBroadcastStatus('queued');
      } else {
        setTelegramBroadcastStatus('unconfigured');
      }
      setCurrentStep('handoff');
      await botSay(
        finalizeResponse.delivered === true
          ? 'Your brief was delivered to the Balance team.'
          : finalizeResponse.queued === true
            ? 'Your brief is queued for the Balance team.'
            : 'Your brief was saved. Delivery to the Balance team is not yet confirmed.'
      );
      await advanceStep('handoff', draftRef.current);
    } catch {
      sessionDraft.finishApproval(approvalToken, 'error');
      if (cancelRef.current) return;
      setTelegramBroadcastStatus('unconfigured');
      setApprovalError('The brief was not sent. Please retry or talk to the team without AI.');
      await botSay('Sorry — something went wrong saving your brief. Please try again.');
    }
  }

  async function handleTrustFeedback(response: TrustFeedbackResponse): Promise<boolean> {
    if (!sessionId || deletionFrozen || !briefApproved || trustFeedbackResponse) return false;
    const feedbackSessionId = sessionId;
    const result = await logEvent({
      sessionId: feedbackSessionId,
      eventName: 'trust_feedback',
      properties: { dimension: 'clarity_helpfulness', response }
    });
    if (!result?.ok || activeSessionIdRef.current !== feedbackSessionId || deletionFrozenRef.current) return false;
    setTrustFeedbackResponse(response);
    return true;
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

    if (currentStep === 'references') {
      const referencesStatus = value === 'Skip' ? 'skipped' : 'added';
      if (value !== 'Skip') {
        const outcome = await addPrivateReference(value);
        if (outcome.status !== 'saved') {
          await botSay(`${outcome.message} Please try again, or choose Skip.`);
          return;
        }
      } else {
        const statusResult = await sessionDraft.updateDraft('referencesStatus', referencesStatus);
        if (statusResult?.status !== 'saved') {
          await botSay('I could not save Skip. Please try again.');
          return;
        }
      }
      if (referencesStatus === 'added') await botSay('Your reference link was saved.');
      setCurrentStep('contact-name');
      await advanceStep('contact-name', draftRef.current);
      return;
    }

    const updatedDraft = draft;

    const isLlmIntakeStep =
      currentStep === 'intro' ||
      currentStep === 'scope' ||
      currentStep === 'objective' ||
      currentStep === 'service' ||
      currentStep === 'audience' ||
      currentStep === 'outputs' ||
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
      currentStep === 'objective' ||
      currentStep === 'service' ||
      currentStep === 'audience' ||
      currentStep === 'outputs' ||
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

    if (nextStepId) {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      const aiProcessingGeneration = aiProcessingGenerationRef.current;
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        if (
          aiProcessingGeneration !== aiProcessingGenerationRef.current ||
          confidentialDiversionRef.current ||
          cancelRef.current
        ) return;
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

  async function showMemoryInventory() {
    await botSay(formatMemoryInventory(draftRef.current, referenceLinks.length));
    if (sessionId) void logEvent({ sessionId, eventName: 'memory_inspected' });
  }

  async function clearEditableDraft() {
    const activeSessionId = sessionId ?? await loadOrCreateSession();
    if (activeSessionId) void logEvent({ sessionId: activeSessionId, eventName: 'memory_reset_requested' });
    const result = activeSessionId ? await resetProject(activeSessionId) : { ok: false };
    if (!result.ok || typeof result.draftVersion !== 'number') {
      await botSay("Sorry - I couldn't clear the editable brief yet. No deletion was claimed.");
      return;
    }
    sessionDraft.invalidateBootstrap();
    sessionDraft.setDraft(createDefaultLeadDraft());
    sessionDraft.setDraftVersion(result.draftVersion);
    sessionDraft.setHasProjectIntent(false);
    await botSay('Editable brief cleared. Uploads, links, consent history, approved transfers, provider copies, and backups were not deleted.');
  }

  async function withdrawTransferConsent() {
    if (!sessionId || !await withdrawProducerTransferConsent(sessionId)) {
      await botSay("Sorry - I couldn't confirm transfer-consent withdrawal. Please retry before sending the brief.");
      return;
    }
    await botSay('Transfer consent is withdrawn. No new producer transfer is authorized. Previously delivered provider copies may require separate deletion processing.');
  }

  async function submitDeletionRequest() {
    const activeSessionId = sessionId ?? await loadOrCreateSession();
    const result = activeSessionId ? await requestProjectDeletion(activeSessionId) : { ok: false };
    if (!result.ok || !result.receipt) {
      await botSay("Sorry - I couldn't submit the deletion request right now. Please try again or ask the team directly.");
      return;
    }

    aiProcessingGenerationRef.current += 1;
    sessionDraft.reset();
    teamRelay.reset();
    setAttachmentOpen(false);
    setDeletionConfirmationPending(false);
    setDeletionStatus(result);
    if (typeof window.localStorage?.setItem === 'function') {
      window.localStorage.setItem(DELETION_RECEIPT_STORAGE_KEY, result.receipt);
    }
    await botSay(result.message ?? 'Deletion requested. Processing is now frozen for this session.');
  }

  async function handleSubmitText() {
    if (submitInFlightRef.current) return;
    if (deletionFrozen) return;
    const trimmed = inputValue.trim();
    if (!trimmed || isTyping) return;
    submitInFlightRef.current = true;
    const submitGeneration = ++submitGenerationRef.current;
    setInputValue('');
    if (composerInputRef.current) composerInputRef.current.style.height = 'auto';

    try {
      const step = conversationSteps[currentStep];
      const isIntakeStep =
        currentStep === 'intro' ||
        currentStep === 'scope' ||
        currentStep === 'objective' ||
        currentStep === 'service' ||
        currentStep === 'audience' ||
        currentStep === 'outputs' ||
        currentStep === 'timeline' ||
        currentStep === 'budget' ||
        currentStep === 'references' ||
        currentStep === 'contact-name' ||
        currentStep === 'contact-email';

      if (deletionConfirmationPending) {
        appendUserMessage(trimmed);
        if (trimmed === 'DELETE') {
          await submitDeletionRequest();
        } else {
          setDeletionConfirmationPending(false);
          await botSay('Deletion was not requested. Your temporary project remains active.');
        }
        return;
      }

      const memoryInspectPattern = /what do you remember|show.*(project )?memory|view.*(project )?memory/i;
      if (!isTeamConnected && memoryInspectPattern.test(trimmed)) {
        appendUserMessage(trimmed);
        await showMemoryInventory();
        return;
      }

      const memoryCorrectionPattern = /update that|correct.*(project|memory|brief)|change.*saved/i;
      if (!isTeamConnected && memoryCorrectionPattern.test(trimmed)) {
        appendUserMessage(trimmed);
        setRailMode('essentials');
        if (isMobile) setTabMode('brief');
        if (sessionId) void logEvent({ sessionId, eventName: 'memory_correction_requested' });
        await botSay('Use the editable brief fields to correct a saved fact. Each change is saved to this temporary project only.');
        return;
      }

      const memoryResetPattern = /forget.*this.*project|reset.*my.*project|clear.*my.*project|start.*over/i;
      if (!isTeamConnected && memoryResetPattern.test(trimmed)) {
        appendUserMessage(trimmed);
        await clearEditableDraft();
        return;
      }

      const deletionPattern = /delete.*(this )?(project|data)|erase.*(this )?(project|data)|remove.*my.*data/i;
      if (!isTeamConnected && deletionPattern.test(trimmed)) {
        appendUserMessage(trimmed);
        setDeletionConfirmationPending(true);
        await botSay('Deletion freezes new work for this session and queues removal of its stored project data. Reply DELETE exactly to confirm. Work already reserved with a provider may still complete, and provider copies or backups have separate retention controls.');
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

        const sendResult = await teamRelay.send(trimmed);
        if (sendResult === 'failed') {
          await botSay('Sorry, I could not reach the team right now. Please email hello@balancestudio.tv.');
          return;
        }

        if (sendResult === 'persisted') void teamRelay.poll().catch(() => undefined);
        return;
      }

      if (currentStep === 'free-chat') {
        await ensureSession();
        appendUserMessage(trimmed);
        await handleLLMResponse(messagesRef.current);
        return;
      }

      if (!isTeamConnected && currentStep === 'references') {
        await processFlowAnswer(trimmed);
        return;
      }

      if (!isTeamConnected && isIntakeStep && trimmed.length > 0) {
        appendUserMessage(trimmed);
        await handleLLMResponse(messagesRef.current);
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
        await botSay(CHAT_UNAVAILABLE_MESSAGE);
      }
    } finally {
      if (submitGeneration === submitGenerationRef.current && !cancelRef.current) {
        setIsTyping(false);
      }
      if (submitGeneration === submitGenerationRef.current) {
        submitInFlightRef.current = false;
      }
    }
  }

  function handleInlineCardClick(card: InlineCard) {
    if (card.type === 'calendly') {
      if (!configuredCalendlyUrl) {
        void botSay('Scheduling is currently unavailable. Please ask the Balance team to arrange a time.');
        return;
      }
      setCalendlyUrl(configuredCalendlyUrl);
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
      const id = await ensureSession();
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

    await botSay(`Got it! I\u2019ve received ${files.length === 1 ? `**${files[0].name}**` : `${files.length} files`} for this temporary draft.`);
    if (cancelRef.current) return;

    await advanceStep('handoff', draftRef.current);

    e.target.value = '';
  }

  function chooseAi(record: ConsentRecord) {
    setEntryPath('ai');
    setNoticeConsent(record);
  }

  function chooseHuman() {
    setEntryPath('human');
    // The existing session contract requires consentVersion and consentedAt. This
    // records first-party relay-session disclosure, not AI processing consent.
    setNoticeConsent({ consentVersion: 'human-relay-1.2', consentedAt: new Date().toISOString() });
  }

  const canInteract = !confidentialRecoveryOpen && !isSessionExpired && (entryPath === 'ai' ? hasStarted && Boolean(sessionId) : humanRequested);
  const showNoticeGate = entryPath === null && !deletionFrozen;
  const showStartChoices = false;
  const showHumanFallback = entryPath === 'human' && !humanRequested;
  const showAttachmentButton = isTeamConnected && humanFileRequestOpen;
  const briefReady = entryPath === 'ai' && !isTeamConnected && isBriefReadyForApproval(draft);
  const showContextBrief = entryPath === 'ai' && !isTeamConnected && hasProjectIntent && !briefApproved;
  const useBriefTabs = showContextBrief && (isMobile || !isMaximized);
  return (
    <div
      className="balance-widget-root"
    >
      {isOpen && (
        <div
          ref={widgetContainerRef}
          role="dialog"
          aria-modal={isMobile || isMaximized ? 'true' : undefined}
          aria-label="Balance Assist"
          aria-labelledby="balance-assist-dialog-title"
          tabIndex={-1}
          className="balance-widget-dialog balance-widget-wrap balance-widget-motion"
          data-rail={showContextBrief ? 'true' : 'false'}
          data-maximized={isMaximized ? 'true' : 'false'}
        >
          {/* Calendly View Overlay */}
          {view === 'calendly' && calendlyUrl && (
            <CalendlyEmbed
              url={calendlyUrl}
              onBack={() => {
                setView('chat');
              }}
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

          <WidgetOverlayHeader
            isTeamConnected={isTeamConnected}
            humanRelayActive={humanRequested || entryPath === 'human'}
            isMaximized={isMaximized}
            canResize={!isMobile}
            onToggleMaximized={() => setIsMaximized((value) => !value)}
            onClose={handleClose}
          />

          {briefReady && showContextBrief && isMobile && (
            <div
              role="status"
              aria-live="polite"
              aria-label="Brief ready"
              className="balance-widget-wrap"
              style={{ padding: '8px 14px', color: brandTokens.colors.warmGold, borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`, fontSize: 11, lineHeight: 1.5 }}
            >
              {getReviewPrompt(isMobile)}
            </div>
          )}

          {deletionFrozen && (
            <div
              role="status"
              data-testid="deletion-status"
              className="balance-widget-wrap"
              style={{ padding: '10px 14px', color: brandTokens.colors.warmGold, borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`, fontSize: 12, lineHeight: 1.5 }}
            >
              {deletionStatus?.status === 'completed'
                ? 'Local deletion completed. Provider retention and backups remain subject to their separate retention policies.'
                : deletionStatus?.status === 'failed'
                  ? 'Deletion processing is delayed and will be retried. This session remains frozen.'
                  : deletionStatus?.status === 'processing' || deletionStatus?.status === 'claimed'
                    ? 'Deletion is processing. New AI or team work is frozen; work already reserved with a provider may still complete.'
                    : 'Deletion requested. This session is frozen while removal is queued.'}
              {deletionStatus?.status === 'completed' && (
                <button
                  type="button"
                  className="balance-widget-action"
                  style={{ marginLeft: 10 }}
                  onClick={() => {
                    window.localStorage?.removeItem?.(DELETION_RECEIPT_STORAGE_KEY);
                    setDeletionStatus(null);
                    handleReset();
                  }}
                >
                  Start a new project
                </button>
              )}
            </div>
          )}

          {useBriefTabs && (
            <div
              role="tablist"
              aria-label="Widget sections"
              className="balance-widget-tabs"
            >
              <button
                role="tab"
                type="button"
                className="balance-widget-action balance-widget-tab"
                aria-selected={tabMode === 'chat'}
                aria-controls="widget-chat-panel"
                id="widget-chat-tab"
                tabIndex={tabMode === 'chat' ? 0 : -1}
                onClick={() => setTabMode('chat')}
                onKeyDown={(event) => handleTabKeyDown(event, 'brief')}
              >
                Chat
              </button>
              <button
                role="tab"
                type="button"
                className="balance-widget-action balance-widget-tab"
                aria-selected={tabMode === 'brief'}
                aria-controls="widget-brief-panel"
                id="widget-brief-tab"
                tabIndex={tabMode === 'brief' ? 0 : -1}
                onClick={() => setTabMode('brief')}
                onKeyDown={(event) => handleTabKeyDown(event, 'chat')}
              >
                Brief
              </button>
            </div>
          )}

          {approvalError && !isTeamConnected && hasProjectIntent && (
            <div
              role="alert"
              className="balance-widget-wrap"
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 14px', color: '#fca5a5', borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`, fontSize: 11 }}
            >
              <span style={{ flex: '1 1 180px' }}>{approvalError}</span>
              <button
                type="button"
                className="balance-widget-action"
                aria-label="Retry sending brief"
                onClick={() => void handleApproveBrief()}
              >
                Retry
              </button>
              <button
                type="button"
                className="balance-widget-action balance-widget-wrap"
                onClick={() => void handleTeamConnect()}
              >
                Talk to the team without AI
              </button>
              <a href="mailto:hello@balancestudio.tv" style={{ color: '#fca5a5' }}>
                Email the team
              </a>
              <button
                type="button"
                className="balance-widget-action"
                onClick={() => {
                  if (!configuredCalendlyUrl) {
                    void botSay('Scheduling is currently unavailable. Please email the Balance team to arrange a time.');
                    return;
                  }
                  setCalendlyUrl(configuredCalendlyUrl);
                  setView('calendly');
                }}
              >
                Book a call
              </button>
            </div>
          )}

          <div className="balance-widget-main">
            {showContextBrief && (
              <div
                data-testid="review-rail"
                id="widget-brief-panel"
                role={useBriefTabs ? 'tabpanel' : undefined}
                aria-labelledby={useBriefTabs ? 'widget-brief-tab' : undefined}
                aria-hidden={useBriefTabs && tabMode !== 'brief' ? 'true' : undefined}
                hidden={useBriefTabs && tabMode !== 'brief'}
                inert={useBriefTabs && tabMode !== 'brief' ? true : undefined}
                className="balance-widget-rail"
              >
                <ReviewPanel
                  draft={draft}
                  approved={briefApproved}
                  mode={railMode}
                  onApprove={handleApproveBrief}
                  onContinueRefining={() => {
                    setRailMode('essentials');
                  }}
                  onChange={handleDraftEdit}
                  provenance={sessionDraft.fieldProvenance}
                  referenceLinks={referenceLinks}
                  onAddReference={addPrivateReference}
                  onRemoveReference={removePrivateReference}
                  transferStatus={telegramBroadcastStatus === 'sent' ? 'delivered' : telegramBroadcastStatus === 'queued' ? 'queued' : 'saved'}
                  approvalInFlight={sessionDraft.approvalInFlight}
                  requiresReapproval={approval.crmRevision !== undefined && !briefApproved}
                  onViewBrief={() => void showMemoryInventory()}
                  onClearBrief={() => void clearEditableDraft()}
                  onWithdrawTransfer={() => void withdrawTransferConsent()}
                  onRequestDeletion={() => {
                    setDeletionConfirmationPending(true);
                    void botSay('Deletion freezes new work for this session and queues removal of its stored project data. Reply DELETE exactly to confirm. Work already reserved with a provider may still complete, and provider copies or backups have separate retention controls.');
                  }}
                />
                {briefApproved && sessionId && !deletionFrozen && (
                  <TrustFeedback
                    submitted={trustFeedbackResponse !== null}
                    onSubmit={handleTrustFeedback}
                  />
                )}
              </div>
            )}

            <div
              id="widget-chat-panel"
              role={useBriefTabs ? 'tabpanel' : undefined}
              aria-labelledby={useBriefTabs ? 'widget-chat-tab' : undefined}
              aria-hidden={useBriefTabs && tabMode !== 'chat' ? 'true' : undefined}
              hidden={useBriefTabs && tabMode !== 'chat'}
              inert={useBriefTabs && tabMode !== 'chat' ? true : undefined}
              tabIndex={0}
              className="balance-widget-chat balance-widget-motion"
            >
                {showNoticeGate ? (
                  <DataUseNotice onConsent={chooseAi} onHuman={chooseHuman} onLeave={handleClose} />
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
                ) : confidentialRecoveryOpen ? (
                  <ConfidentialDiversionRecovery
                    calendlyUrl={configuredCalendlyUrl}
                    onHuman={() => {
                      setConfidentialRecoveryOpen(false);
                      setEntryPath('human');
                    }}
                    onLeave={handleClose}
                  />
                ) : showHumanFallback ? (
                  <HumanFallbacks calendlyUrl={configuredCalendlyUrl} unavailable={sessionUnavailable} />
                ) : (
                  <div role="log" aria-label="Conversation transcript" aria-live="polite" aria-relevant="additions text" className="balance-widget-transcript">
                    {messages.map((msg) => (
                      <MessageBubble key={msg.id} message={msg} onInlineCardClick={handleInlineCardClick} />
                    ))}

                    {isTyping && (
                      <div role="status" aria-label="Balance Assist is typing" style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                        <BotAvatarSmall />
                        <TypingDots />
                      </div>
                    )}

                    {!isTyping && isTeamConnected && humanFileRequestOpen && (
                      <FileRequestBanner
                        note={humanFileRequestNote}
                        onUpload={() => requestedFileInputRef.current?.click()}
                        onShowPolicy={() => setShowUploadPolicy(true)}
                      />
                    )}
                    {!isTyping && isTeamConnected && humanScheduleRequestOpen && (
                      <SchedulingPrompt
                        available={Boolean(configuredCalendlyUrl)}
                        onSchedule={() => {
                          if (!configuredCalendlyUrl) return;
                          setCalendlyUrl(configuredCalendlyUrl);
                          setView('calendly');
                        }}
                      />
                    )}
                  </div>
                )}

                <div ref={messagesEndRef} />
            </div>
          </div>

          {briefApproved && !isTeamConnected && (
            <div
              data-testid="approve-confirmation"
              className="balance-widget-approved-actions"
            >
              <strong role="status" aria-live="polite" className="balance-widget-approved-status">
                {telegramBroadcastStatus === 'sent'
                  ? 'Brief sent to Balance.'
                  : telegramBroadcastStatus === 'queued'
                    ? 'Brief saved. Waiting to send to Balance.'
                    : 'Brief saved.'}
              </strong>
              <button
                type="button" className="balance-widget-action balance-widget-approved-action" aria-label="Edit brief"
                onClick={() => {
                  setRailMode('summary');
                  sessionDraft.reopenApproval();
                  if (useBriefTabs) setTabMode('brief');
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" /></svg>
                Edit Brief
              </button>
              {sessionId && !deletionFrozen && (
                <TrustFeedback
                  submitted={trustFeedbackResponse !== null}
                  onSubmit={handleTrustFeedback}
                />
              )}
            </div>
          )}

          {showAttachmentButton && !deletionFrozen && (
            <input
              ref={requestedFileInputRef}
              type="file"
              multiple
              accept={UPLOAD_ACCEPT_ATTRIBUTE}
              aria-label="Choose requested files"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          )}

          {/* Input Bar */}
          {canInteract && (!useBriefTabs || tabMode === 'chat') && (
            <>
              <div className="balance-widget-composer">
                <div className="balance-widget-composer-inner">
                <label htmlFor="balance-widget-message-input" className="balance-sr-only">
                  {humanRequested ? 'Message the Balance team' : 'Message Balance Assist'}
                </label>
                {entryPath === 'ai' && !isTeamConnected && !deletionFrozen && (
                  <>
                    <button
                      type="button"
                      aria-label="Attach references"
                      aria-expanded={attachmentOpen}
                      onClick={() => setAttachmentOpen((o) => !o)}
                      className="balance-widget-action balance-widget-icon-action"
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
                        className="balance-attachment-popover"
                      >
                        <button
                          type="button"
                          className="balance-widget-action balance-attachment-close"
                          aria-label="Close references"
                          onClick={() => setAttachmentOpen(false)}
                        >
                          &#10005;
                        </button>
                        {referenceLinks.length > 0 && (
                          <div aria-label="Saved reference links" style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                            {referenceLinks.map((link) => (
                              <a
                                key={link.url}
                                href={link.url}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: brandTokens.colors.warmGold, overflowWrap: 'anywhere' }}
                              >
                                {link.url}
                              </a>
                            ))}
                          </div>
                        )}
                        <div className="balance-attachment-content">
                          <AttachmentDropzone
                            onAddLink={addPrivateReference}
                            onFileAnalyzed={handleFileAnalyzed}
                            sessionId={sessionId}
                            consent={entryPath === 'ai' && noticeConsent ? { aiAnalysis: true, producerShare: false, consentedAt: noticeConsent.consentedAt } : null}
                            messageContext={inputValue}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
                <textarea
                  ref={composerInputRef}
                  id="balance-widget-message-input"
                  rows={1}
                  value={inputValue}
                  maxLength={MAX_PROJECT_SCOPE_CHARACTERS}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    e.currentTarget.style.height = 'auto';
                    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={humanStatus === 'sending' || deletionFrozen}
                  placeholder={deletionFrozen ? 'This session is frozen' : humanRequested ? 'Write a message to the Balance team...' : 'Type your message...'}
                  className="balance-widget-input"
                />
                <button
                  onClick={handleSubmitText}
                  disabled={deletionFrozen || !inputValue.trim() || isTyping || humanStatus === 'sending'}
                  className="balance-widget-action balance-widget-icon-action balance-widget-send"
                  aria-label="Send message"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke={inputValue.trim() && !isTyping && humanStatus !== 'sending' ? '#101010' : brandTokens.colors.mutedText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                </div>
              </div>

              {!deletionFrozen && <HumanFooter isTeamConnected={humanRequested} hasTeamReply={isTeamConnected} humanStatus={humanStatus} calendlyUrl={configuredCalendlyUrl} onConnect={handleTeamConnect} />}
            </>
          )}
        </div>
      )}

      {/* Launcher / Close Button */}
      {!isOpen && (
        <button
          ref={launcherRef}
          onClick={handleOpen}
          aria-label="Open Balance Assist"
          className="balance-widget-launcher balance-widget-motion"
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
