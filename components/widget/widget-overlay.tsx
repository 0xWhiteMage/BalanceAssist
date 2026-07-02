'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TypingDots } from '@/components/chat/typing-dots';
import { MessageBubble } from '@/components/chat/message-bubble';
import { CalendlyEmbed } from '@/components/chat/calendly-embed';
import { brandTokens } from '@/lib/brand-tokens';
import { applyTextToDraft, getNextConversationStep } from '@/lib/conversation/extract';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';
import { conversationSteps, getQuickReplyLabel, tryMatchOption } from '@/lib/conversation/flow';
import { getFallbackResponse, getLocalResponse } from '@/lib/conversation/local-responses';
import { createSession, fetchTeamMessages, finalizeLead, logEvent, relayUserMessage, type TeamMessage } from '@/lib/api/client';
import { scoreLead } from '@/lib/qualification/score';
import type { ChatMessage, ConversationStepId, InlineCard } from '@/lib/conversation/types';

let messageCounter = 0;
function nextId() {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBotTexts(stepId: ConversationStepId, draft: LeadDraft): string[] {
  const step = conversationSteps[stepId];
  const raw = step.botMessages;
  return typeof raw === 'function' ? raw(draft) : raw;
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
  const [isTyping, setIsTyping] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [allowAttachment, setAllowAttachment] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isTeamConnected, setIsTeamConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [teamWaitingForReply, setTeamWaitingForReply] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const lastTeamMessageIdRef = useRef<number>(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const draftRef = useRef(draft);
  const stepRef = useRef(currentStep);
  const teamRef = useRef(isTeamConnected);

  messagesRef.current = messages;
  draftRef.current = draft;
  stepRef.current = currentStep;
  teamRef.current = isTeamConnected;
  sessionIdRef.current = sessionId;

  const pollTeamMessages = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;

    const messages = await fetchTeamMessages(id, lastTeamMessageIdRef.current);

    if (messages.length > 0) {
      lastTeamMessageIdRef.current = Math.max(lastTeamMessageIdRef.current, ...messages.map((m) => m.id));
      setTeamWaitingForReply(false);

      const next = [...messagesRef.current];
      for (const msg of messages) {
        next.push({
          id: nextId(),
          sender: 'bot',
          text: msg.text,
          timestamp: Date.now(),
          isTeamMessage: true
        });
      }
      messagesRef.current = next;
      setMessages(next);
    }
  }, []);

  useEffect(() => {
    if (isTeamConnected && sessionIdRef.current) {
      lastTeamMessageIdRef.current = 0;
      setTeamWaitingForReply(false);

      pollTeamMessages().catch(() => undefined);

      const interval = setInterval(() => {
        pollTeamMessages().catch(() => undefined);
      }, teamWaitingForReply ? 1000 : 2000);

      pollIntervalRef.current = interval;

      return () => {
        clearInterval(interval);
        pollIntervalRef.current = null;
      };
    }

    return undefined;
  }, [isTeamConnected, pollTeamMessages, teamWaitingForReply]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const botSay = useCallback(
    async (
      text: string,
      options?: {
        quickReplies?: ChatMessage['quickReplies'];
        inlineCards?: InlineCard[];
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
        setSessionId(session.sessionId);
        sessionIdRef.current = session.sessionId;
        return session.sessionId;
      }
    } catch {
      // Persistence is best-effort; widget continues without it.
    }

    return null;
  }, []);

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
    setIsOpen(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  function handleOpen() {
    cancelRef.current = false;
    setIsOpen(true);
  }

  function handleReset() {
    cancelRef.current = true;
    messagesRef.current = [];
    setMessages([]);
    setDraft(createDefaultLeadDraft());
    setCurrentStep('intro');
    setHasStarted(false);
    setIsTeamConnected(false);
    setView('chat');
    setAllowAttachment(false);
    cancelRef.current = false;
    setTimeout(() => startConversation(), 200);
  }

  async function handleLLMResponse(history: ChatMessage[]) {
    const latestUserText = [...history].reverse().find((message) => message.sender === 'user')?.text ?? '';

    try {
      const llmMessages = history
        .filter((message) => message.text.trim().length > 0)
        .slice(-10)
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
            draft: JSON.stringify(draftRef.current)
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

      await botSay(data.message ?? getFallbackResponse());
    } catch {
      const localFallback = getLocalResponse(latestUserText, {
        draft: draftRef.current,
        step: stepRef.current,
        isTeamConnected: teamRef.current
      });
      await botSay(localFallback ?? getFallbackResponse());
    }
  }

  async function handleTeamConnect() {
    if (isTeamConnected) return;
    setIsTeamConnected(true);
    setCurrentStep('free-chat');

    await ensureSession();
    if (sessionIdRef.current) {
      void logEvent({ sessionId: sessionIdRef.current, eventName: 'human_handoff' });
    }

    const connectMsg: ChatMessage = {
      id: nextId(),
      sender: 'bot',
      text: 'Connected to Balance Studio team — they will respond here in real time.',
      timestamp: Date.now(),
      isSystem: true
    };
    const next = [...messagesRef.current, connectMsg];
    messagesRef.current = next;
    setMessages(next);
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
    } else if (step.field) {
      updatedDraft = { ...draft, [step.field]: value };
      setDraft(updatedDraft);
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

    const reachedQualification = nextStepId === 'qualification';

    if (reachedQualification || nextStepId) {
      await ensureSession();
    }

    if (reachedQualification && sessionIdRef.current) {
      const result = scoreLead(updatedDraft);
      void finalizeLead({
        sessionId: sessionIdRef.current,
        qualificationStatus: result.status,
        score: result.score,
        recommendedNextStep: result.recommendedNextStep,
        leadDraft: updatedDraft
      });
    }

    if (sessionIdRef.current && nextStepId) {
      void logEvent({
        sessionId: sessionIdRef.current,
        eventName: 'step_advanced',
        properties: { from: currentStep, to: nextStepId }
      });
    }

    if (nextStepId) {
      setTimeout(() => advanceStep(nextStepId!, updatedDraft), 300);
    }
  }

  async function handleSubmitText() {
    const trimmed = inputValue.trim();
    if (!trimmed || isTyping) return;
    setInputValue('');

    const step = conversationSteps[currentStep];

    const humanKeywords = /talk.*to.*human|speak.*to.*human|real.*person|human.*agent|connect.*team|connect.*me/i;
    if (humanKeywords.test(trimmed) && !isTeamConnected) {
      const userMsg: ChatMessage = { id: nextId(), sender: 'user', text: trimmed, timestamp: Date.now() };
      const nextMessages = [...messagesRef.current, userMsg];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      handleTeamConnect();
      return;
    }

    if (isTeamConnected) {
      await ensureSession();
      const id = sessionIdRef.current;
      const userMsg: ChatMessage = { id: nextId(), sender: 'user', text: trimmed, timestamp: Date.now() };
      const nextMessages = [...messagesRef.current, userMsg];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      setTeamWaitingForReply(true);

      if (id) {
        const ok = await relayUserMessage(id, trimmed);
        if (!ok) {
          setTeamWaitingForReply(false);
          await botSay('Sorry, I could not reach the team right now. Please email hello@balancestudio.tv.');
        } else {
          setTimeout(() => {
            pollTeamMessages().catch(() => undefined);
          }, 500);
        }
      } else {
        setTeamWaitingForReply(false);
      }
      return;
    }

    if (currentStep === 'free-chat') {
      await ensureSession();
      const userMsg: ChatMessage = { id: nextId(), sender: 'user', text: trimmed, timestamp: Date.now() };
      const nextMessages = [...messagesRef.current, userMsg];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);

      const localResponse = getLocalResponse(trimmed, {
        draft,
        step: currentStep,
        isTeamConnected
      });

      if (localResponse) {
        await botSay(localResponse);
        return;
      }

      await handleLLMResponse(nextMessages);
      return;
    }

    if (step.quickReplies) {
      const matched = tryMatchOption(trimmed, step);
      if (matched) {
        processFlowAnswer(matched, getQuickReplyLabel(currentStep, matched));
        return;
      }
    }

    const localResponse = getLocalResponse(trimmed, {
      draft,
      step: currentStep,
      isTeamConnected
    });

    if (localResponse) {
      const userMsg: ChatMessage = { id: nextId(), sender: 'user', text: trimmed, timestamp: Date.now() };
      const nextMessages = [...messagesRef.current, userMsg];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      await botSay(localResponse);
      return;
    }

    if (step.freeText) {
      processFlowAnswer(trimmed);
      return;
    }

    const userMsg: ChatMessage = { id: nextId(), sender: 'user', text: trimmed, timestamp: Date.now() };
    const nextMessages = [...messagesRef.current, userMsg];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    await handleLLMResponse(nextMessages);
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
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeStr = file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(file.size / 1024)} KB`;

    const userMsg: ChatMessage = {
      id: nextId(),
      sender: 'user',
      text: `Shared: ${file.name}`,
      timestamp: Date.now(),
      attachment: { name: file.name, size: sizeStr }
    };
    const nextMessages = [...messagesRef.current, userMsg];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    await sleep(500);
    if (cancelRef.current) return;

    await botSay(`Got it! I\u2019ve received **${file.name}**. Our team will review this alongside your project details.`);
    setAllowAttachment(false);

    await sleep(400);
    if (cancelRef.current) return;

    await advanceStep('handoff', draftRef.current);

    e.target.value = '';
  }

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
            width: 'min(380px, calc(100vw - 48px))',
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
            <CalendlyEmbed url={calendlyUrl} onBack={() => setView('chat')} />
          )}

          {/* Header */}
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`,
              flexShrink: 0,
              background: 'rgba(16, 16, 16, 0.6)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#101010" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: brandTokens.colors.lightText, letterSpacing: '0.02em' }}>
                  {isTeamConnected ? 'Balance Studio Team' : 'Balance Assist'}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: '10px',
                    color: isTeamConnected ? '#4ade80' : brandTokens.colors.warmGold,
                    textTransform: 'uppercase',
                    letterSpacing: '0.16em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
                  {isTeamConnected ? 'Team connected' : 'Online'}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              style={{
                background: 'none',
                border: 'none',
                color: brandTokens.colors.mutedText,
                cursor: 'pointer',
                fontSize: '16px',
                padding: '4px 8px',
                lineHeight: 1
              }}
              aria-label="Close chat"
            >
              &#10005;
            </button>
          </header>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
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

            {!isTyping && isTeamConnected && teamWaitingForReply && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <span
                  style={{
                    marginLeft: '4px',
                    fontSize: '10px',
                    fontWeight: 600,
                    color: brandTokens.colors.warmGold,
                    textTransform: 'uppercase',
                    letterSpacing: '0.16em'
                  }}
                >
                  Balance Studio Team
                </span>
                <TypingDots />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <div
            style={{
              padding: '10px 12px',
              borderTop: `1px solid ${brandTokens.colors.subtleBorder}`,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(16, 16, 16, 0.4)'
            }}
          >
            {allowAttachment && (
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
                <input type="file" onChange={handleFileSelect} style={{ display: 'none' }} />
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

          {/* Footer */}
          <div
            style={{
              padding: '6px 12px 8px',
              flexShrink: 0,
              textAlign: 'center',
              background: 'rgba(16, 16, 16, 0.4)'
            }}
          >
            {!isTeamConnected ? (
              <button
                onClick={handleTeamConnect}
                style={{
                  background: 'none',
                  border: 'none',
                  color: brandTokens.colors.mutedText,
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontFamily: brandTokens.typography.ui,
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px'
                }}
              >
                Talk to a human
              </button>
            ) : (
              <a
                href="https://t.me/balancestudio"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: brandTokens.colors.mutedText,
                  fontSize: '11px',
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px'
                }}
              >
                Open in Telegram &#8599;
              </a>
            )}
          </div>
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

function BotAvatarSmall() {
  return (
    <div
      style={{
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#101010" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
