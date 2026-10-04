import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// getConfig() 가 처음 불릴 때 환경변수를 읽으므로 import 전에 정한다.
const dir = mkdtempSync(path.join(tmpdir(), 'gwamegi-chat-'));
const fakeClaude = path.join(dir, 'fake-claude');
const argsLog = path.join(dir, 'args.log');
process.env.DATABASE_PATH = path.join(dir, 'test.db');
process.env.AGENT_WORKDIR = path.join(dir, 'agent');
process.env.APP_ENV = 'test';
process.env.AGENT_MAX_CONCURRENCY = '1';
process.env.CLAUDE_BIN = fakeClaude; // 처음엔 파일이 없다 → 실행 실패 경로

const { getConfig } = await import('../src/config.ts');
const { getDb, migrate } = await import('../src/db/index.ts');
const { ChatError, prepareChat, streamChat, listSessions, listMessages } = await import('../src/chat/service.ts');

/** 받은 인자를 기록하고 정해진 stream-json 을 그대로 출력하는 가짜 claude. resumed 를 주면 --resume 일 때 그걸 낸다 */
function installFakeClaude(output: string, resumed = output) {
  writeFileSync(
    fakeClaude,
    `#!/bin/sh\necho "$*" >> '${argsLog}'\ncat > /dev/null\ncase "$*" in\n*--resume*) cat <<'__EOF__'\n${resumed}\n__EOF__\n;;\n*) cat <<'__EOF__'\n${output}\n__EOF__\n;;\nesac\n`,
  );
  chmodSync(fakeClaude, 0o755);
}
const lastArgs = () => readFileSync(argsLog, 'utf8').trim().split('\n').at(-1)!;

const recorded = readFileSync(new URL('./fixtures/claude-stream-tool-call.jsonl', import.meta.url), 'utf8').trim();
const recordedSessionId = JSON.parse(recorded.split('\n')[0]).session_id as string;
// 2026-10-04 VM 에서 로그인 없이 실행했을 때의 실제 result 줄
// 2026-10-04 로컬에서 없는 세션 id 로 --resume 했을 때의 실제 result 줄
const noConversation = JSON.stringify({
  type: 'result', subtype: 'error_during_execution', is_error: true,
  errors: ['No conversation found with session ID: 11111111-2222-3333-4444-555555555555'],
  session_id: '11111111-2222-3333-4444-555555555555',
});
const notLoggedIn = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: recordedSessionId }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', session_id: recordedSessionId }),
].join('\n');

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

  it('슬래시 명령처럼 보이는 메시지는 400', () => {
    expect(statusOf(() => prepareChat({ message: '/model haiku' }))).toBe(400);
    expect(statusOf(() => prepareChat({ message: '  /config' }))).toBe(400);
  });
});

describe('streamChat', () => {
  let sessionId = '';

  it('claude 를 못 띄우면 error 로 끝나고, 상한·잠금이 풀린다', async () => {
    const first = prepareChat({ message: '첫 질문' });
    sessionId = first.session.id;
    expect(statusOf(() => prepareChat({ message: '둘째' }))).toBe(503); // 상한 1

    const events = await collect(streamChat(first));
    expect(events[0]).toEqual({ type: 'session', sessionId });
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('claude CLI 를 실행하지 못했다') });
    // 실패한 턴이라도 질문은 남는다
    expect(listMessages(sessionId)?.map((m) => m.role)).toEqual(['user']);
  });

  it('정상 응답: 도구·조각·완료 이벤트를 내고, 답변과 claude 세션 id 를 저장한다', async () => {
    installFakeClaude(recorded);
    const events = await collect(streamChat(prepareChat({ message: '자외선 지수', sessionId })));
    const types = events.map((e) => (e.type === 'tool' ? `tool:${e.status}` : e.type));
    expect(types[0]).toBe('session');
    expect(types).toContain('tool:start');
    expect(types).toContain('delta');
    expect(types.at(-1)).toBe('done');
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ name: 'INT_S06_005', label: '자외선 측정 장비 실시간 수집 정보' });

    const messages = listMessages(sessionId)!;
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', toolCalls: [{ name: 'INT_S06_005', input: {}, isError: true }] });
    const row = getDb().prepare('SELECT agent_session_id FROM chat_session WHERE id = ?').get(sessionId) as { agent_session_id: string };
    expect(row.agent_session_id).toBe(recordedSessionId);
  });

  it('다음 턴은 저장한 claude 세션으로 --resume 하고, 잠금 플래그를 모두 붙인다', async () => {
    await collect(streamChat(prepareChat({ message: '방금 뭐 물었지', sessionId })));
    const args = lastArgs();
    expect(args).toContain(`--resume ${recordedSessionId}`);
    expect(args).toContain('--tools  --strict-mcp-config'); // 내장 도구 끔 ("" 인자)
    expect(args).toContain('--allowedTools mcp__eum__*');
    expect(args).toContain('--permission-mode dontAsk');
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--setting-sources  --disable'); // 개인 설정 미로딩 ("" 인자)
    expect(args).not.toContain('--bare'); // subscription 모드
  });

  it('claude 쪽 대화 기록이 없어졌으면 새로 시작해서 답한다', async () => {
    installFakeClaude(recorded, noConversation);
    getDb().prepare("UPDATE chat_session SET agent_session_id = 'gone' WHERE id = ?").run(sessionId);
    const events = await collect(streamChat(prepareChat({ message: '다시 물어볼게', sessionId })));
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(lastArgs()).not.toContain('--resume'); // 두 번째 시도는 새 대화
    const row = getDb().prepare('SELECT agent_session_id FROM chat_session WHERE id = ?').get(sessionId) as { agent_session_id: string };
    expect(row.agent_session_id).toBe(recordedSessionId);
  });

  it('claude 가 실패 결과를 내면 사유를 error 로 전하고 답변은 저장하지 않는다', async () => {
    installFakeClaude(notLoggedIn);
    const before = listMessages(sessionId)!.length;
    const events = await collect(streamChat(prepareChat({ message: '안녕', sessionId })));
    expect(events.at(-1)).toEqual({ type: 'error', message: '답변을 만들지 못했다: Not logged in · Please run /login' });
    expect(listMessages(sessionId)!.length).toBe(before + 1); // 질문만 늘었다
  });
});

describe('24시간 비용 상한', () => {
  it('넘으면 503', () => {
    const db = getDb();
    const { lastInsertRowid } = db
      .prepare("INSERT INTO chat_message (session_id, role, content, cost_usd, created_at) VALUES ((SELECT id FROM chat_session LIMIT 1), 'assistant', 'x', 999, ?)")
      .run(new Date().toISOString());
    expect(statusOf(() => prepareChat({ message: '비싸다' }))).toBe(503);
    db.prepare('DELETE FROM chat_message WHERE id = ?').run(lastInsertRowid);
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
