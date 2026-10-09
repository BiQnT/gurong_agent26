import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  createToolServer,
  MAX_CALLS_PER_SESSION,
  ToolNotice,
  type ToolDefinition,
} from './tool-server.ts';
import { callTool } from './test-helpers/tool-ask.ts';

const server = createToolServer();
after(() => server.close());

const echo: ToolDefinition = {
  name: 'echo',
  description: '받은 값을 돌려준다',
  inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
  run: async (input) => ({
    content: { summary: `값 ${String(input.value)}`, value: input.value },
    card: { value: input.value },
  }),
};
const broken: ToolDefinition = {
  name: 'broken',
  description: '항상 실패한다',
  inputSchema: { type: 'object', properties: {} },
  run: async () => {
    throw new ToolNotice('그 기간은 자료가 없어요.');
  },
};
const leaky: ToolDefinition = {
  name: 'leaky',
  description: '저장소 오류를 그대로 던진다',
  inputSchema: { type: 'object', properties: {} },
  run: async () => {
    throw new Error('SqliteError: database is locked at /srv/haepung/db/haepung.db');
  },
};

async function rpc(url: string, token: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: response.status === 202 ? null : await response.json() };
}

test('a session speaks the MCP handshake and lists only its own tools', async () => {
  const session = await server.open([echo], new AbortController().signal, 10_000);
  assert.match(session.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const init = await rpc(session.url, session.token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } },
  });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
  // 알림에는 본문 없이 202 로 답한다.
  const note = await rpc(session.url, session.token, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  assert.equal(note.status, 202);
  const list = await rpc(session.url, session.token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  assert.deepEqual(
    list.body.result.tools.map((tool: { name: string }) => tool.name),
    ['echo'],
  );
  const unknown = await rpc(session.url, session.token, { jsonrpc: '2.0', id: 3, method: 'x/y' });
  assert.equal(unknown.body.error.code, -32601);
  session.close();
});

test('tool calls are recorded with their card, only notices reach the model, and the cap holds', async () => {
  const session = await server.open([echo, broken, leaky], new AbortController().signal, 10_000);
  const tools = { url: session.url, token: session.token };
  const ok = await callTool(tools, 'echo', { value: 7 });
  assert.deepEqual(ok.result, { summary: '값 7', value: 7 });
  assert.equal(ok.isError, false);
  // 카드 자료는 AI 에게 가지 않고 서버 기록에만 남는다.
  assert.deepEqual(session.calls[0].card, { value: 7 });
  const failed = await callTool(tools, 'broken');
  assert.equal(failed.isError, true);
  assert.equal(failed.result, '그 기간은 자료가 없어요.');
  // 저장소 오류 글은 AI 에게 넘기지 않는다.
  const leaked = await callTool(tools, 'leaky');
  assert.equal(leaked.result, '자료를 읽지 못했어요.');
  assert.deepEqual(
    session.calls.map((call) => [call.name, call.ok, call.card === undefined]),
    [
      ['echo', true, false],
      ['broken', false, true],
      ['leaky', false, true],
    ],
  );
  // 한꺼번에 불러도 상한을 넘지 않는다.
  const burst = await Promise.all(
    Array.from({ length: MAX_CALLS_PER_SESSION }, (_, index) =>
      callTool(tools, 'echo', { value: index }),
    ),
  );
  assert.equal(burst.filter((item) => item.isError).length, 3);
  assert.match(String(burst.find((item) => item.isError)?.result), /도구 횟수를 넘었어요/);
  assert.equal(session.calls.length, MAX_CALLS_PER_SESSION);
  session.close();
});

test('tokens are per session: a wrong, closed, expired or aborted session gets 401', async () => {
  let clock = 1_000_000;
  const timed = createToolServer(() => clock);
  after(() => timed.close());
  const session = await timed.open([echo], new AbortController().signal, 1000);
  const other = await timed.open([echo], new AbortController().signal, 1000);
  const tools = { url: session.url, token: session.token };
  assert.equal((await callTool(tools, 'echo', { value: 1 }, 'x'.repeat(43))).status, 401);
  assert.equal((await callTool(tools, 'echo', { value: 1 })).status, 200);
  // 다른 세션의 토큰으로는 이 세션의 기록이 늘지 않는다.
  await callTool(tools, 'echo', { value: 2 }, other.token);
  assert.equal(session.calls.length, 1);
  clock += 2000;
  assert.equal((await callTool(tools, 'echo', { value: 1 })).status, 401);
  session.close();
  other.close();

  const controller = new AbortController();
  const aborted = await server.open([echo], controller.signal, 10_000);
  controller.abort();
  assert.equal(
    (await callTool({ url: aborted.url, token: aborted.token }, 'echo', { value: 1 })).status,
    401,
  );
  aborted.close();
  const closed = await server.open([echo], new AbortController().signal, 10_000);
  closed.close();
  assert.equal(
    (await callTool({ url: closed.url, token: closed.token }, 'echo', { value: 1 })).status,
    401,
  );
});
