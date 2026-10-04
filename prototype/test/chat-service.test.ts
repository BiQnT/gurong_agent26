import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// getConfig() 가 처음 불릴 때 환경변수를 읽으므로 import 전에 정한다.
const dir = mkdtempSync(path.join(tmpdir(), 'gwamegi-chat-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
process.env.AGENT_WORKDIR = path.join(dir, 'agent');
process.env.APP_ENV = 'test';
process.env.AGENT_MAX_CONCURRENCY = '1';
// 없는 실행 파일. claude 를 띄우지 못하는 경로를 확인한다.
process.env.CLAUDE_BIN = path.join(dir, 'no-such-claude');

const { getConfig } = await import('../src/config.ts');
const { getDb, migrate } = await import('../src/db/index.ts');
const { ChatError, prepareChat, streamChat, listSessions, listMessages } = await import('../src/chat/service.ts');

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ChatError) return error.status;
    throw error;
  }
  return undefined;
}

beforeAll(() => {
  migrate(getDb(), getConfig().migrationsDir);
});

describe('prepareChat', () => {
  it('잘못된 요청은 400, 없는 대화는 404', () => {
    expect(statusOf(() => prepareChat({}))).toBe(400);
    expect(statusOf(() => prepareChat({ message: '   ' }))).toBe(400);
    expect(statusOf(() => prepareChat({ message: 'x'.repeat(2001) }))).toBe(400);
    expect(statusOf(() => prepareChat({ message: 'hi', sessionId: 3 }))).toBe(400);
    expect(statusOf(() => prepareChat({ message: 'hi', sessionId: 'nope' }))).toBe(404);
  });

  it('동시 실행 상한을 넘으면 503, 끝나면 잠금이 풀린다', async () => {
    const first = prepareChat({ message: '첫 질문' });
    expect(statusOf(() => prepareChat({ message: '둘째' }))).toBe(503);

    const events = await collect(streamChat(first));
    expect(events[0]).toEqual({ type: 'session', sessionId: first.session.id });
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('claude CLI 를 실행하지 못했다') });

    // 실패한 턴이라도 사용자 메시지는 남고, 같은 대화로 다시 보낼 수 있다
    expect(listMessages(first.session.id)?.map((m) => m.role)).toEqual(['user']);
    expect(statusOf(() => prepareChat({ message: '다시', sessionId: first.session.id }))).toBeUndefined();
  });
});

describe('listSessions', () => {
  it('환경별로 거르고 첫 질문을 제목으로 쓴다', () => {
    const mine = listSessions('test');
    expect(mine[0]).toMatchObject({ appEnv: 'test', title: '첫 질문' });
    expect(listSessions('prod')).toEqual([]);
    expect(listSessions(undefined).length).toBe(mine.length);
  });
});
