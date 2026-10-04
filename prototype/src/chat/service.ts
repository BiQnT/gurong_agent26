import { randomUUID } from 'node:crypto';
import { getConfig } from '../config.ts';
import { getDb } from '../db/index.ts';
import { loadCatalog, type CatalogApi } from '../eum/catalog.ts';
import { ClaudeCliError, runClaude } from '../agent/claude-cli.ts';

// POST /api/chat 의 본체. 프론트에 보내는 이벤트 형식은 prototype/README.md 의 "채팅 API" 가 정본이다.

export type ChatEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; id: string; status: 'start'; name: string; label?: string }
  | { type: 'tool'; id: string; status: 'end'; isError: boolean }
  | { type: 'done'; messageId: number; text: string; costUsd?: number }
  | { type: 'error'; message: string };

export class ChatError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const MAX_MESSAGE_LENGTH = 2000;

type SessionRow = { id: string; agent_session_id: string | null };

export type ChatContext = { session: SessionRow; isNew: boolean; message: string };

// 한 대화에 두 요청이 동시에 들어오면 claude 세션이 꼬인다. 프로세스 안에서만 막는다.
const busy = ((globalThis as { gwamegiBusySessions?: Set<string> }).gwamegiBusySessions ??= new Set());

let catalogCache: Map<string, CatalogApi> | undefined;
function toolLabel(toolName: string): string | undefined {
  catalogCache ??= loadCatalog(getConfig().eumCatalogPath);
  // 카탈로그 이름 끝의 조사 메모 "(⚠ E-UM 자료실 미등록 …)" 는 화면에 보이지 않게 뗀다.
  return catalogCache.get(toolName)?.name.replace(/\s*\(.*\)\s*$/, '');
}

/** 검증과 잠금. 실패는 ChatError(HTTP 상태 포함)로 던진다. 성공하면 반드시 streamChat 으로 이어서 잠금을 푼다. */
export function prepareChat(body: unknown): ChatContext {
  const { sessionId, message } = (body ?? {}) as { sessionId?: unknown; message?: unknown };
  if (typeof message !== 'string' || !message.trim()) throw new ChatError('message 가 비어 있다', 400);
  if (message.length > MAX_MESSAGE_LENGTH) throw new ChatError(`message 는 ${MAX_MESSAGE_LENGTH}자 이하여야 한다`, 400);
  if (sessionId !== undefined && typeof sessionId !== 'string') throw new ChatError('sessionId 는 문자열이어야 한다', 400);

  let session: SessionRow;
  let isNew = false;
  if (sessionId) {
    const row = getDb().prepare('SELECT id, agent_session_id FROM chat_session WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!row) throw new ChatError('대화를 찾을 수 없다', 404);
    session = row;
  } else {
    session = { id: randomUUID(), agent_session_id: null };
    isNew = true;
  }
  if (busy.has(session.id)) throw new ChatError('이 대화는 이전 답변을 아직 만드는 중이다', 409);
  busy.add(session.id);
  return { session, isNew, message: message.trim() };
}

export async function* streamChat(context: ChatContext, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const { session, isNew, message } = context;
  const config = getConfig();
  const db = getDb();
  const now = () => new Date().toISOString();
  try {
    if (isNew) {
      db.prepare('INSERT INTO chat_session (id, app_env, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        session.id, config.appEnv, now(), now(),
      );
    }
    db.prepare("INSERT INTO chat_message (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)").run(
      session.id, message, now(),
    );
    yield { type: 'session', sessionId: session.id };

    const tools: { id: string; name: string; input: unknown; isError?: boolean }[] = [];
    for await (const event of runClaude(config, {
      prompt: message,
      resumeSessionId: session.agent_session_id ?? undefined,
      signal,
    })) {
      switch (event.type) {
        case 'init':
          // 첫 턴이 도중에 실패해도 세션 파일은 생겼을 수 있으니 init 시점에 바로 저장한다.
          if (!session.agent_session_id) {
            session.agent_session_id = event.sessionId;
            db.prepare('UPDATE chat_session SET agent_session_id = ? WHERE id = ?').run(event.sessionId, session.id);
          }
          break;
        case 'text_delta':
          yield { type: 'delta', text: event.text };
          break;
        case 'tool_start': {
          const name = event.name.replace(/^mcp__eum__/, '');
          tools.push({ id: event.id, name, input: event.input });
          yield { type: 'tool', id: event.id, status: 'start', name, label: toolLabel(name) };
          break;
        }
        case 'tool_end': {
          const tool = tools.find((t) => t.id === event.id);
          if (tool) tool.isError = event.isError;
          yield { type: 'tool', id: event.id, status: 'end', isError: event.isError };
          break;
        }
        case 'result': {
          if (event.isError) {
            yield { type: 'error', message: `답변을 만들지 못했다 (${event.subtype ?? 'error'})` };
            break;
          }
          const info = db
            .prepare("INSERT INTO chat_message (session_id, role, content, tool_calls, cost_usd, created_at) VALUES (?, 'assistant', ?, ?, ?, ?)")
            .run(
              session.id,
              event.text,
              tools.length ? JSON.stringify(tools.map(({ name, input, isError }) => ({ name, input, isError }))) : null,
              event.costUsd ?? null,
              now(),
            );
          db.prepare('UPDATE chat_session SET updated_at = ? WHERE id = ?').run(now(), session.id);
          yield { type: 'done', messageId: Number(info.lastInsertRowid), text: event.text, costUsd: event.costUsd };
          break;
        }
      }
    }
  } catch (error) {
    if (error instanceof ClaudeCliError) {
      console.error(`[chat] ${error.message}\n${error.stderr}`);
      yield { type: 'error', message: error.message };
    } else {
      console.error('[chat]', error);
      yield { type: 'error', message: '서버 오류' };
    }
  } finally {
    busy.delete(session.id);
  }
}

export type StoredMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: { name: string; input: unknown; isError?: boolean }[] | null;
  createdAt: string;
};

export function listMessages(sessionId: string): StoredMessage[] | undefined {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM chat_session WHERE id = ?').get(sessionId)) return undefined;
  const rows = db
    .prepare('SELECT id, role, content, tool_calls, created_at FROM chat_message WHERE session_id = ? ORDER BY id')
    .all(sessionId) as { id: number; role: 'user' | 'assistant'; content: string; tool_calls: string | null; created_at: string }[];
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : null,
    createdAt: row.created_at,
  }));
}
