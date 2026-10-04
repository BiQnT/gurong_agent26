import { useEffect, useRef, useState } from 'react';
import {
  createChatTransport,
  readChatReply,
  recentChatHistory,
  type ChatReply,
  type ProgressStep,
} from '../lib/chat';
import { createId } from '../lib/id';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reply?: ChatReply;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

type RequestError = { sessionId: string; message: string; prompt: string };
type ChatOptions = {
  siteId: string;
  scopeKey: string;
  deviceId?: string;
  onNotice: (message: string) => void;
};
const storageKey = (scopeKey: string) => `haepung.conversations.v3:${scopeKey}`;
const transport = createChatTransport();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMessage(value: unknown): ChatMessage | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.content !== 'string'
  )
    return null;
  if (value.role !== 'user' && value.role !== 'assistant') return null;
  const message: ChatMessage = { id: value.id, role: value.role, content: value.content };
  if (value.role === 'assistant' && value.reply !== undefined) {
    try {
      message.reply = readChatReply(value.reply);
    } catch {
      /* Preserve readable text when a stored rich response is malformed. */
    }
  }
  return message;
}

function readConversations(key: string): Conversation[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored
      .flatMap((item): Conversation[] => {
        if (
          !isRecord(item) ||
          typeof item.id !== 'string' ||
          !item.id ||
          typeof item.title !== 'string' ||
          !Array.isArray(item.messages)
        )
          return [];
        const messages = item.messages
          .map(readMessage)
          .filter((message): message is ChatMessage => message !== null);
        const updatedAt =
          typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
            ? item.updatedAt
            : new Date(0).toISOString();
        return [{ id: item.id, title: item.title, messages, updatedAt }];
      })
      .slice(0, 40);
  } catch {
    return [];
  }
}

/** Owns persisted conversations and the lifetime of one in-flight chat request. */
export function useChat({ siteId, scopeKey, deviceId, onNotice }: ChatOptions) {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    readConversations(storageKey(scopeKey)),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [error, setError] = useState<RequestError | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const activeChat = conversations.find((chat) => chat.id === activeId);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(scopeKey), JSON.stringify(conversations.slice(0, 40)));
    } catch {
      onNotice('브라우저 저장 공간이 부족해 이번 대화는 임시로 보관합니다.');
    }
  }, [conversations, onNotice, scopeKey]);

  useEffect(
    () => () => {
      const pending = requestRef.current;
      requestRef.current = null;
      pending?.abort();
    },
    [],
  );

  function deleteConversation(id: string) {
    cancel();
    setConversations((current) => current.filter((chat) => chat.id !== id));
    setActiveId((current) => (current === id ? null : current));
    setError(null);
  }

  function newConversation() {
    cancel();
    setActiveId(null);
    setDraft('');
    setError(null);
  }

  function cancel() {
    const pending = requestRef.current;
    requestRef.current = null;
    pending?.abort();
    setLoadingId(null);
    setSteps([]);
  }

  async function send(prompt: string, retry = false) {
    const text = prompt.trim().slice(0, 4000);
    // The ref closes the double-submit window before React commits loading state.
    if (!text || requestRef.current) return;
    const sessionId = activeId ?? createId();
    const controller = new AbortController();
    requestRef.current = controller;
    const isCurrent = () => requestRef.current === controller && !controller.signal.aborted;
    const previousMessages = activeChat?.messages ?? [];
    const lastMessage = previousMessages[previousMessages.length - 1];
    let history: ChatMessage[] = previousMessages;
    let dropTrailingAssistantId: string | null = null;
    if (retry) {
      if (lastMessage?.role === 'user' && lastMessage.content === text) {
        history = previousMessages.slice(0, -1);
      } else if (lastMessage?.role === 'assistant') {
        // Regenerating: exclude the previous answer from history and replace it on success.
        history = previousMessages.slice(0, -1);
        dropTrailingAssistantId = lastMessage.id;
      }
    }

    setDraft('');
    setError(null);
    setActiveId(sessionId);
    setLoadingId(sessionId);
    setSteps([
      {
        id: 'prepare',
        label: '요청 확인',
        detail: '선택한 관측소와 요청 내용을 확인하고 있어요',
        status: 'running',
      },
    ]);
    if (!retry)
      setConversations((current) => {
        const userMessage: ChatMessage = { id: createId(), role: 'user', content: text };
        const updatedAt = new Date().toISOString();
        const existing = current.find((chat) => chat.id === sessionId);
        if (existing)
          return current.map((chat) =>
            chat.id === sessionId
              ? { ...chat, messages: [...chat.messages, userMessage], updatedAt }
              : chat,
          );
        return [
          { id: sessionId, title: text.slice(0, 30), messages: [userMessage], updatedAt },
          ...current,
        ];
      });

    try {
      const reply = await transport.send(
        {
          message: text,
          siteId,
          deviceId,
          history: recentChatHistory(history),
        },
        {
          signal: controller.signal,
          onProgress: (nextSteps) => {
            if (isCurrent()) setSteps(nextSteps);
          },
        },
      );
      if (!isCurrent()) return;
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: reply.content,
        reply,
      };
      setConversations((current) =>
        current.map((chat) => {
          if (chat.id !== sessionId) return chat;
          const base = dropTrailingAssistantId
            ? chat.messages.filter((message) => message.id !== dropTrailingAssistantId)
            : chat.messages;
          return {
            ...chat,
            messages: [...base, assistantMessage],
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    } catch (cause) {
      if (isCurrent())
        setError({
          sessionId,
          message: cause instanceof Error ? cause.message : '요청을 처리하지 못했습니다.',
          prompt: text,
        });
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoadingId(null);
      }
    }
  }

  return {
    conversations,
    activeId,
    setActiveId,
    activeChat,
    draft,
    setDraft,
    loadingId,
    isLoading: loadingId !== null,
    steps,
    error,
    send,
    cancel,
    newConversation,
    deleteConversation,
  };
}
