import assert from 'node:assert/strict';
import test from 'node:test';
import { isStrongPassword, workspaceApi, WorkspaceError } from './workspace.ts';

test('workspace requests send cookie credentials and release the deadline after success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requestSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, '/api/auth/session');
    assert.equal(init?.credentials, 'include');
    requestSignal = init?.signal;
    return Response.json({ user: null, sites: [] });
  });
  assert.deepEqual(await workspaceApi.session(), { user: null, sites: [] });
  assert.ok(requestSignal);
  t.mock.timers.tick(20000);
  assert.equal(requestSignal.aborted, false);
});

test('workspace requests preserve explicit caller cancellation', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init!.signal!;
    if (signal.aborted) throw signal.reason;
    return new Promise<Response>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  });
  const controller = new AbortController();
  const pending = workspaceApi.session(controller.signal);
  const reason = new DOMException('Account switched', 'AbortError');
  controller.abort(reason);
  await assert.rejects(pending, (error: unknown) => error === reason);
  await assert.rejects(
    workspaceApi.session(controller.signal),
    (error: unknown) => error === reason,
  );
});

test('workspace deadline aborts a stalled fetch and exposes a retryable timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      }),
  );
  const pending = workspaceApi.session();
  t.mock.timers.tick(20000);
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof WorkspaceError && error.status === 504 && error.code === 'REQUEST_TIMEOUT',
  );
});

test('workspace deadline remains active while a response body is stalled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
            init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), {
              once: true,
            });
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  const pending = workspaceApi.session();
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(20000);
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof WorkspaceError && error.code === 'REQUEST_TIMEOUT',
  );
});

test('workspace server failures preserve error codes and safely handle malformed error payloads', async (t) => {
  const mocked = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      { error: '다른 사용자가 기록을 갱신했어요.', code: 'REVISION_CONFLICT' },
      { status: 409 },
    ),
  );
  await assert.rejects(
    workspaceApi.session(),
    (error: unknown) =>
      error instanceof WorkspaceError && error.status === 409 && error.code === 'REVISION_CONFLICT',
  );
  mocked.mock.mockImplementation(async () => Response.json(null, { status: 500 }));
  await assert.rejects(
    workspaceApi.session(),
    (error: unknown) => error instanceof WorkspaceError && error.status === 500,
  );
});

test('new passwords need 8 to 128 characters with at least one letter and one digit', () => {
  for (const password of [
    'gwamegi2026',
    '덕장비밀번호2026',
    `a1${'x'.repeat(126)}`,
    // 전각 숫자도 숫자다.
    'gwamegi１２',
    // 자모로 나뉜(NFD) 입력도 NFC 로 맞춘 뒤 잰다.
    '덕장비밀번호2026'.normalize('NFD'),
  ])
    assert.equal(isStrongPassword(password), true, password);
  for (const password of [
    'abc1234',
    'onlyletters',
    '12345678',
    '!!!!1111',
    `a1${'x'.repeat(127)}`,
    // NFD 로는 10자지만 NFC 로는 6자다.
    '비밀번호12'.normalize('NFD'),
  ])
    assert.equal(isStrongPassword(password), false, password);
});
