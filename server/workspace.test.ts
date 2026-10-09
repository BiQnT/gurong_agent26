import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { Connect } from 'vite';
import {
  createWorkspaceMiddleware,
  createWorkspaceService,
  openWorkspaceStore,
  passwordHash,
} from './workspace.ts';
import { createApiMiddleware } from './vite-api.ts';
import { runScript, scriptPath } from './test-helpers/run-script.ts';
import { GUIDANCE_FACTS, type OperationsData } from '../src/lib/operations.ts';
import type {
  Account,
  Invitation,
  InvitePreview,
  OperationsEnvelope,
  Site,
  Team,
  WorkspaceSession,
} from '../src/lib/workspace.ts';

const credentials = (name: string) => ({
  name,
  email: `${name.toLowerCase()}@example.test`,
  password: 'test-only-password-2026',
});
const siteInput = {
  name: '테스트 덕장',
  address: '테스트 주소',
  latitude: 35.98,
  longitude: 129.55,
};
type Failure = { code: string; error: string };
type InvitationResult = { invitation: Invitation; token: string };

async function startServer(middleware: Connect.NextHandleFunction) {
  const server = createServer((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    }),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, base: `http://127.0.0.1:${address.port}` };
}
async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
function agent(base: string) {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async call<T = Failure>(
      path: string,
      method = 'GET',
      body?: unknown,
      headers: Record<string, string> = {},
    ) {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return {
        status: response.status,
        body: (await response.json()) as T,
        headers: response.headers,
      };
    },
    async signup(name: string): Promise<Account> {
      const response = await this.call<WorkspaceSession>('/auth/signup', 'POST', credentials(name));
      assert.equal(response.status, 200);
      assert.ok(response.body.user);
      return response.body.user;
    },
    async site(name = siteInput.name): Promise<Site> {
      const response = await this.call<Site>('/sites', 'POST', { ...siteInput, name });
      assert.equal(response.status, 200);
      return response.body;
    },
    async invite(siteId: string): Promise<InvitationResult> {
      const response = await this.call<InvitationResult>(`/sites/${siteId}/invitations`, 'POST', {
        language: 'vi',
      });
      assert.equal(response.status, 200);
      return response.body;
    },
    async accept(token: string): Promise<Site> {
      const response = await this.call<Site>(`/invitations/${token}/accept`, 'POST', {});
      assert.equal(response.status, 200);
      return response.body;
    },
  };
}
async function fixture(t: TestContext, bridge = false, inviteLinkSecret?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'gwamegi-workspace-test-'));
  const dataFile = join(directory, 'workspace.json');
  let now = Date.parse('2026-10-04T09:00:00.000Z');
  const service = createWorkspaceService({ dataFile, now: () => now, inviteLinkSecret });
  const middleware = bridge
    ? createApiMiddleware(
        {
          projectRoot: directory,
          eumServiceKey: '',
          openaiApiKey: '',
          openaiModel: 'test-model',
          llmBaseUrl: 'https://api.openai.com/v1',
          staleAfterMinutes: 30,
          timezoneOffset: '+09:00',
        },
        service,
      )
    : createWorkspaceMiddleware(service);
  const { server, base } = await startServer(middleware);
  t.after(async () => {
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    dataFile,
    base,
    agent: () => agent(base),
    now: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}
function workData(): OperationsData {
  const at = '2026-10-04T08:00:00.000Z';
  return {
    batches: [
      {
        id: 'batch-test',
        name: '실제 입력 배치',
        fish: '꽁치',
        quantity: 10,
        status: 'ongoing',
        startedAt: at,
        note: '',
        observations: [],
        logs: [],
      },
    ],
    guidance: [
      {
        id: 'guidance-test',
        batchId: 'batch-test',
        title: '널기',
        original: '간격을 두고 널어 주세요.',
        translated: 'Vui lòng treo cá.',
        language: 'vi',
        facts: { ...GUIDANCE_FACTS },
        approvedAt: at,
        preparedAt: at,
        channel: 'workspace',
        status: 'prepared',
        replies: [],
      },
    ],
  };
}

test('signup, duplicate rejection, login, session rotation and logout use protected server cookies', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  assert.deepEqual((await owner.call<WorkspaceSession>('/auth/session')).body, {
    user: null,
    sites: [],
  });
  assert.equal(
    (await owner.call('/auth/signup', 'POST', { ...credentials('Owner'), password: 'short' }))
      .status,
    400,
  );
  const signup = await owner.call<WorkspaceSession>('/auth/signup', 'POST', credentials('Owner'));
  assert.equal(signup.status, 200);
  assert.ok(signup.body.user);
  assert.deepEqual(Object.keys(signup.body.user).sort(), ['email', 'id', 'name']);
  assert.match(signup.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(signup.headers.get('set-cookie')!, /test-only-password/);
  assert.equal(
    (await owner.call<WorkspaceSession>('/auth/session')).body.user?.id,
    signup.body.user.id,
  );
  assert.equal(
    (
      await f
        .agent()
        .call('/auth/signup', 'POST', { ...credentials('Owner'), email: ' OWNER@EXAMPLE.TEST ' })
    ).status,
    409,
  );
  const oldCookie = owner.cookie;
  assert.equal(
    (
      await owner.call('/auth/login', 'POST', {
        ...credentials('Owner'),
        password: 'wrong-password',
      })
    ).status,
    401,
  );
  assert.equal((await owner.call('/auth/login', 'POST', credentials('Owner'))).status, 200);
  assert.notEqual(owner.cookie, oldCookie);
  assert.equal(
    (
      await f
        .agent()
        .call<WorkspaceSession>('/auth/session', 'GET', undefined, { Cookie: oldCookie })
    ).body.user,
    null,
  );
  const loggedInCookie = owner.cookie;
  assert.equal((await owner.call('/auth/logout', 'POST', {})).status, 200);
  assert.equal(
    (
      await f
        .agent()
        .call<WorkspaceSession>('/auth/session', 'GET', undefined, { Cookie: loggedInCookie })
    ).body.user,
    null,
  );
  const raw = await readFile(f.dataFile, 'utf8');
  assert.ok(!raw.includes(credentials('Owner').password));
  assert.ok(!raw.includes(loggedInCookie.split('=')[1]));
  assert.equal((await stat(f.dataFile)).mode & 0o777, 0o600);
});

test('new passwords need 8 to 128 characters with a letter and a digit, older ones still log in', async (t) => {
  const f = await fixture(t);
  // 규칙 전에 가입한 계정(문자만 있는 비밀번호)을 첫 요청 전에 저장해 둔다.
  const salt = '0123456789abcdef0123456789abcdef';
  await writeFile(
    f.dataFile,
    JSON.stringify({
      version: 1,
      users: [
        {
          id: 'legacy-user',
          name: 'Legacy',
          email: 'legacy@example.test',
          salt,
          passwordHash: await passwordHash('onlyletters', salt),
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      sites: [],
      memberships: [],
      sessions: [],
      invitations: [],
      operations: [],
    }),
  );
  const signup = (password: string) =>
    f.agent().call('/auth/signup', 'POST', { ...credentials('New'), password });
  for (const password of ['onlyletters', '12345678', '--------', 'abc1234']) {
    const rejected = await signup(password);
    assert.equal(rejected.status, 400, password);
    assert.match(rejected.body.code, /^(WEAK_PASSWORD|INVALID_CREDENTIALS)$/, password);
  }
  const weak = await signup('onlyletters');
  assert.equal(weak.body.code, 'WEAK_PASSWORD');
  assert.match(weak.body.error, /문자와 숫자/);
  assert.equal((await signup(`a1${'x'.repeat(127)}`)).status, 400);
  assert.equal((await signup('덕장비밀번호2026')).status, 200);
  assert.equal(
    (
      await f.agent().call('/auth/login', 'POST', {
        email: 'legacy@example.test',
        password: 'onlyletters',
      })
    ).status,
    200,
  );
});

test('site registration validates coordinates and every owner route enforces site membership', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  const stranger = f.agent();
  const anonymous = f.agent();
  await owner.signup('Owner');
  await stranger.signup('Stranger');
  assert.equal((await anonymous.call('/sites', 'POST', siteInput)).status, 401);
  for (const patch of [
    { latitude: 91 },
    { longitude: -181 },
    { latitude: null },
    { latitude: '35' },
    { name: ' ' },
    { address: '' },
  ]) {
    assert.equal((await owner.call('/sites', 'POST', { ...siteInput, ...patch })).status, 400);
  }
  const site = await owner.site();
  const otherSite = await stranger.site('다른 덕장');
  assert.equal(site.role, 'owner');
  for (const [path, method, body] of [
    [`/sites/${site.id}`, 'PATCH', siteInput],
    [`/sites/${site.id}/team`, 'GET', undefined],
    [`/sites/${site.id}/invitations`, 'POST', { language: 'vi', role: 'owner' }],
    [`/sites/${site.id}/operations`, 'GET', undefined],
    [`/sites/${site.id}/operations`, 'PUT', { revision: 0, data: workData() }],
  ] as const)
    assert.equal((await stranger.call(path, method, body)).status, 403, path);
  assert.equal((await owner.call(`/sites/${otherSite.id}/team`)).status, 403);
  assert.equal(
    (
      await owner.call(
        `/sites/${site.id}/members/${(await owner.call<WorkspaceSession>('/auth/session')).body.user!.id}`,
        'DELETE',
      )
    ).status,
    409,
  );
  const edit = await owner.call<Site>(`/sites/${site.id}`, 'PATCH', {
    ...siteInput,
    name: '수정 덕장',
    latitude: 0,
    longitude: 0,
    role: 'worker',
  });
  assert.equal(edit.body.name, '수정 덕장');
  assert.equal(edit.body.latitude, 0);
  assert.equal(edit.body.role, 'owner');
});

test('invites are one-time hashed bearer links with expiry, revocation and safe same-account retry', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  const worker = f.agent();
  const another = f.agent();
  await owner.signup('Owner');
  const workerUser = await worker.signup('Worker');
  await another.signup('Another');
  const site = await owner.site();
  const invited = await owner.invite(site.id);
  const preview = await f.agent().call<InvitePreview>(`/invitations/${invited.token}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.siteName, site.name);
  assert.equal(preview.body.status, 'pending');
  assert.ok(!JSON.stringify(preview.body).includes('example.test'));
  assert.ok(!(await readFile(f.dataFile, 'utf8')).includes(invited.token));
  assert.equal(
    (await f.agent().call(`/invitations/${invited.token}/accept`, 'POST', {})).status,
    401,
  );
  assert.equal((await owner.call(`/invitations/${invited.token}/accept`, 'POST', {})).status, 409);
  assert.equal((await worker.accept(invited.token)).role, 'worker');
  assert.equal((await worker.accept(invited.token)).id, site.id);
  assert.equal(
    (await another.call(`/invitations/${invited.token}/accept`, 'POST', {})).status,
    410,
  );
  assert.equal((await owner.call<Team>(`/sites/${site.id}/team`)).body.members.length, 2);
  assert.equal(
    (await owner.call(`/sites/${site.id}/invitations/${invited.invitation.id}`, 'DELETE')).status,
    409,
  );
  assert.equal(
    (await owner.call(`/sites/${site.id}/members/${workerUser.id}`, 'DELETE')).status,
    200,
  );
  assert.equal((await worker.call(`/sites/${site.id}/operations`)).status, 403);
  assert.equal((await worker.call(`/invitations/${invited.token}/accept`, 'POST', {})).status, 410);
  const revoked = await owner.invite(site.id);
  assert.equal(
    (await owner.call(`/sites/${site.id}/invitations/${revoked.invitation.id}`, 'DELETE')).status,
    200,
  );
  assert.equal(
    (await f.agent().call<InvitePreview>(`/invitations/${revoked.token}`)).body.status,
    'revoked',
  );
  assert.equal((await worker.call(`/invitations/${revoked.token}/accept`, 'POST', {})).status, 410);
  const expired = await owner.invite(site.id);
  f.advance(7 * 24 * 60 * 60 * 1000);
  assert.equal(
    (await f.agent().call<InvitePreview>(`/invitations/${expired.token}`)).body.status,
    'expired',
  );
  assert.equal((await worker.call(`/invitations/${expired.token}/accept`, 'POST', {})).status, 410);
  assert.equal(
    (await owner.call<Team>(`/sites/${site.id}/team`)).body.invitations.find(
      (i) => i.id === expired.invitation.id,
    )?.status,
    'expired',
  );
});

const LINK_SECRET = 'test-only-invite-link-secret';
test('owners copy a pending invite link again from the server secret; others and used links cannot', async (t) => {
  const f = await fixture(t, false, LINK_SECRET);
  const owner = f.agent();
  const worker = f.agent();
  const other = f.agent();
  await owner.signup('Owner');
  await worker.signup('Worker');
  await other.signup('Other');
  const site = await owner.site();
  const otherSite = await other.site('다른 덕장');
  const link = (agentOf: ReturnType<typeof f.agent>, siteId: string, invitationId: string) =>
    agentOf.call<{ token?: string; code?: string }>(
      `/sites/${siteId}/invitations/${invitationId}/link`,
    );

  const accepted = await owner.invite(site.id);
  assert.match(accepted.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(accepted.invitation.linkAvailable, true);
  const copied = await link(owner, site.id, accepted.invitation.id);
  assert.equal(copied.status, 200);
  assert.deepEqual(copied.body, { token: accepted.token });
  await worker.accept(accepted.token);
  const used = await link(owner, site.id, accepted.invitation.id);
  assert.equal(used.status, 410);
  assert.equal(used.body.code, 'INVITATION_UNAVAILABLE');

  const pending = await owner.invite(site.id);
  assert.equal((await link(worker, site.id, pending.invitation.id)).status, 403);
  assert.equal((await link(other, site.id, pending.invitation.id)).status, 403);
  assert.equal((await link(f.agent(), site.id, pending.invitation.id)).status, 401);
  const elsewhere = await link(other, otherSite.id, pending.invitation.id);
  assert.equal(elsewhere.status, 404);
  assert.equal(elsewhere.body.code, 'INVITATION_NOT_FOUND');
  assert.equal(
    (await owner.call(`/sites/${site.id}/invitations/${pending.invitation.id}/link`, 'POST', {}))
      .status,
    405,
  );
  const team = (await owner.call<Team>(`/sites/${site.id}/team`)).body;
  assert.deepEqual(
    team.invitations.map((i) => [i.id, i.status, i.linkAvailable]),
    [
      [accepted.invitation.id, 'accepted', false],
      [pending.invitation.id, 'pending', true],
    ],
  );

  assert.equal(
    (await owner.call(`/sites/${site.id}/invitations/${pending.invitation.id}`, 'DELETE')).status,
    200,
  );
  assert.equal((await link(owner, site.id, pending.invitation.id)).status, 410);
  const expiring = await owner.invite(site.id);
  f.advance(7 * 24 * 60 * 60 * 1000);
  assert.equal((await link(owner, site.id, expiring.invitation.id)).status, 410);
  assert.equal(
    (await owner.call<Team>(`/sites/${site.id}/team`)).body.invitations.find(
      (i) => i.id === expiring.invitation.id,
    )?.linkAvailable,
    false,
  );

  // 저장 형식은 그대로다. 토큰 원문이나 linkAvailable 은 저장하지 않는다.
  const raw = await readFile(f.dataFile, 'utf8');
  for (const token of [accepted.token, pending.token, expiring.token])
    assert.ok(!raw.includes(token));
  const stored = JSON.parse(raw) as { invitations: Record<string, unknown>[] };
  for (const invitation of stored.invitations)
    assert.deepEqual(
      Object.keys(invitation)
        .filter((key) => key !== 'acceptedBy')
        .sort(),
      ['createdAt', 'expiresAt', 'id', 'language', 'siteId', 'status', 'tokenHash'],
    );
});

test('without the secret links show once; random links made before the secret stay valid but cannot be copied again', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  await owner.signup('Owner');
  const site = await owner.site();
  const legacy = await owner.invite(site.id);
  assert.equal(legacy.invitation.linkAvailable, false);
  const unset = await owner.call(`/sites/${site.id}/invitations/${legacy.invitation.id}/link`);
  assert.equal(unset.status, 409);
  assert.equal(unset.body.code, 'INVITE_LINK_UNAVAILABLE');

  // 같은 저장소를 비밀값을 설정한 서버로 다시 띄운다 (배포 후 재시작과 같다).
  const restart = async (inviteLinkSecret: string) => {
    const service = createWorkspaceService({ dataFile: f.dataFile, now: f.now, inviteLinkSecret });
    const started = await startServer(createWorkspaceMiddleware(service));
    t.after(() => closeServer(started.server));
    const next = agent(started.base);
    return <T = Failure>(path: string, method = 'GET', body?: unknown) =>
      next.call<T>(path, method, body, { Cookie: owner.cookie });
  };
  const withSecret = await restart(LINK_SECRET);
  const old = await withSecret(`/sites/${site.id}/invitations/${legacy.invitation.id}/link`);
  assert.equal(old.status, 409);
  assert.equal(old.body.code, 'INVITE_LINK_UNAVAILABLE');
  assert.equal(
    (await withSecret<InvitePreview>(`/invitations/${legacy.token}`)).body.status,
    'pending',
  );
  const fresh = (
    await withSecret<InvitationResult>(`/sites/${site.id}/invitations`, 'POST', { language: 'ko' })
  ).body;
  assert.equal(fresh.invitation.linkAvailable, true);
  assert.deepEqual(
    (await withSecret(`/sites/${site.id}/invitations/${fresh.invitation.id}/link`)).body,
    { token: fresh.token },
  );

  // 비밀값을 바꾸면 그 전 초대는 다시 복사할 수 없지만 링크는 그대로 쓸 수 있다.
  const rotated = await restart('another-test-only-secret');
  assert.equal(
    (await rotated(`/sites/${site.id}/invitations/${fresh.invitation.id}/link`)).status,
    409,
  );
  assert.equal(
    (await rotated<InvitePreview>(`/invitations/${fresh.token}`)).body.status,
    'pending',
  );
});

test('worker self preferences never grant owner rights or edit another membership', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  const worker = f.agent();
  const ownerUser = await owner.signup('Owner');
  await worker.signup('Worker');
  const site = await owner.site();
  await worker.accept((await owner.invite(site.id)).token);
  const prefs = await worker.call<Site>(`/sites/${site.id}/preferences`, 'PATCH', {
    language: 'ko',
    userId: ownerUser.id,
    role: 'owner',
    name: 'hijack',
  });
  assert.equal(prefs.status, 200);
  assert.equal(prefs.body.role, 'worker');
  assert.equal(prefs.body.language, 'ko');
  assert.equal(prefs.body.name, site.name);
  assert.equal(
    (await worker.call(`/sites/${site.id}/preferences`, 'PATCH', { language: 'xx' })).status,
    400,
  );
  for (const [path, method, body] of [
    [`/sites/${site.id}`, 'PATCH', siteInput],
    [`/sites/${site.id}/team`, 'GET', undefined],
    [`/sites/${site.id}/invitations`, 'POST', { language: 'vi' }],
    [`/sites/${site.id}/members/${ownerUser.id}`, 'DELETE', undefined],
    [`/sites/${site.id}/operations`, 'PUT', { revision: 0, data: workData() }],
  ] as const)
    assert.equal((await worker.call(path, method, body)).status, 403, path);
  assert.equal((await worker.call(`/sites/${site.id}/operations`)).status, 200);
  const team = (await owner.call<Team>(`/sites/${site.id}/team`)).body;
  assert.equal(team.members.find((m) => m.id === ownerUser.id)?.role, 'owner');
});

test('revision writes are atomic and real worker replies are deduplicated per account without closing batches', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  const worker = f.agent();
  const second = f.agent();
  const stranger = f.agent();
  await owner.signup('Owner');
  const workerUser = await worker.signup('Worker');
  await second.signup('Second');
  await stranger.signup('Stranger');
  const site = await owner.site();
  const otherSite = await stranger.site('별도 덕장');
  await worker.accept((await owner.invite(site.id)).token);
  await second.accept((await owner.invite(site.id)).token);
  const operationsPath = `/sites/${site.id}/operations`;
  const replyPath = `/sites/${site.id}/guidance/guidance-test/replies`;
  assert.equal(
    (
      await owner.call(operationsPath, 'PUT', {
        revision: 0,
        data: { batches: [{}], guidance: [] },
      })
    ).status,
    400,
  );
  assert.equal(
    (await owner.call<OperationsEnvelope>(operationsPath, 'PUT', { revision: 0, data: workData() }))
      .body.revision,
    1,
  );
  assert.equal(
    (await owner.call(operationsPath, 'PUT', { revision: 0, data: workData() })).status,
    409,
  );
  const races = await Promise.all(
    [1, 2].map(() => owner.call(operationsPath, 'PUT', { revision: 1, data: workData() })),
  );
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await owner.call(replyPath, 'POST', { kind: 'completed' })).status, 403);
  assert.equal((await stranger.call(replyPath, 'POST', { kind: 'completed' })).status, 403);
  assert.equal(
    (
      await worker.call(`/sites/${otherSite.id}/guidance/guidance-test/replies`, 'POST', {
        kind: 'completed',
      })
    ).status,
    403,
  );
  assert.equal((await worker.call(replyPath, 'POST', { kind: 'question', text: ' ' })).status, 400);
  const completed = await worker.call<OperationsEnvelope>(replyPath, 'POST', {
    kind: 'completed',
    simulated: true,
    userId: 'forged',
    userName: 'forged',
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.revision, 3);
  const reply = completed.body.data.guidance[0].replies[0];
  assert.equal(reply.simulated, false);
  assert.equal(reply.userId, workerUser.id);
  assert.equal(reply.userName, workerUser.name);
  assert.equal(completed.body.data.batches[0].status, 'ongoing');
  assert.equal(completed.body.data.batches[0].endedAt, undefined);
  assert.equal(
    (await worker.call<OperationsEnvelope>(replyPath, 'POST', { kind: 'completed' })).body.revision,
    3,
  );
  const secondCompleted = await second.call<OperationsEnvelope>(replyPath, 'POST', {
    kind: 'completed',
  });
  assert.equal(secondCompleted.body.data.guidance[0].replies.length, 2);
  assert.equal(secondCompleted.body.revision, 4);
  const questioned = await worker.call<OperationsEnvelope>(replyPath, 'POST', {
    kind: 'question',
    text: '어디에 널까요?',
  });
  assert.equal(questioned.body.data.guidance[0].replies.length, 3);
  assert.equal(
    (await owner.call(operationsPath, 'PUT', { revision: 5, data: workData() })).body.code,
    'PROTECTED_WORKER_HISTORY',
  );
  const updated = structuredClone(questioned.body);
  updated.data.batches[0].note = '운영자 메모';
  assert.equal(
    (await owner.call<OperationsEnvelope>(operationsPath, 'PUT', updated)).body.revision,
    6,
  );
  const forged = structuredClone(updated);
  forged.revision = 6;
  forged.data.guidance[0].replies[0].userName = 'fake';
  assert.equal((await owner.call(operationsPath, 'PUT', forged)).status, 400);
  const final = (await second.call<OperationsEnvelope>(operationsPath)).body;
  assert.equal(final.data.batches[0].status, 'ongoing');
  assert.equal(final.data.guidance[0].replies.length, 3);
});

test('users, memberships, invitations, sessions and operations reload from the private disk file', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  const worker = f.agent();
  const ownerUser = await owner.signup('Owner');
  await worker.signup('Worker');
  const site = await owner.site();
  const invite = await owner.invite(site.id);
  await worker.accept(invite.token);
  await owner.call(`/sites/${site.id}/operations`, 'PUT', { revision: 0, data: workData() });
  await worker.call(`/sites/${site.id}/guidance/guidance-test/replies`, 'POST', { kind: 'read' });
  const copiedPath = join(f.directory, 'reloaded.json');
  await copyFile(f.dataFile, copiedPath);
  const reloaded = createWorkspaceService({
    dataFile: copiedPath,
    now: () => Date.parse('2026-10-04T09:00:00.000Z'),
  });
  const server = await startServer(createWorkspaceMiddleware(reloaded));
  t.after(() => closeServer(server.server));
  const reader = agent(server.base);
  const session = await reader.call<WorkspaceSession>('/auth/session', 'GET', undefined, {
    Cookie: owner.cookie,
  });
  assert.equal(session.body.user?.id, ownerUser.id);
  assert.equal(session.body.sites[0].id, site.id);
  const operations = await reader.call<OperationsEnvelope>(
    `/sites/${site.id}/operations`,
    'GET',
    undefined,
    { Cookie: worker.cookie },
  );
  assert.equal(operations.body.revision, 2);
  assert.equal(operations.body.data.guidance[0].replies[0].kind, 'read');
  assert.equal(
    (await reader.call<InvitePreview>(`/invitations/${invite.token}`)).body.status,
    'accepted',
  );
  assert.equal((await reader.call('/auth/login', 'POST', credentials('Owner'))).status, 200);
});

test('cross-origin writes and unauthorized chat/site-observation requests fail before upstream calls', async (t) => {
  const f = await fixture(t, true);
  const owner = f.agent();
  const worker = f.agent();
  assert.equal(
    (
      await owner.call('/auth/signup', 'POST', credentials('Blocked'), {
        Origin: 'https://untrusted.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await owner.call('/auth/signup', 'POST', credentials('Blocked'), {
        'Sec-Fetch-Site': 'cross-site',
      })
    ).status,
    403,
  );
  assert.equal((await owner.call('/auth/login', 'POST', credentials('Blocked'))).status, 401);
  assert.equal((await owner.call('/chat', 'POST', {})).status, 400);
  assert.equal(
    (await owner.call('/chat', 'POST', { siteId: 'fake', message: '날씨', history: [] })).status,
    401,
  );
  await owner.signup('Owner');
  await worker.signup('Worker');
  const site = await owner.site();
  await worker.accept((await owner.invite(site.id)).token);
  assert.equal(
    (await worker.call('/chat', 'POST', { siteId: site.id, message: '날씨', history: [] })).status,
    403,
  );
  assert.equal(
    (await owner.call('/chat', 'POST', { siteId: 'another-site', message: '날씨', history: [] }))
      .status,
    403,
  );
  assert.equal((await f.agent().call(`/observations?siteId=${site.id}`)).status, 401);
  assert.equal((await owner.call('/observations?siteId=another-site')).status, 403);
  assert.equal((await owner.call('/health')).status, 200);
});

test('private database paths never reach static middleware and request bodies are bounded', async (t) => {
  const f = await fixture(t, true);
  await f.agent().signup('Owner');
  for (const path of [
    '/.local-data/workspace.json',
    '/.LOCAL-DATA/workspace.json',
    '/%2elocal-data/workspace.json',
    '/.local-data%2fworkspace.json?raw',
    '/@fs/private/project/.local-data/workspace.json',
    '/@fs/private/project/%2Elocal-data/workspace.json?import',
    '/@fs/private/project%5c.local-data%5cworkspace.json',
  ]) {
    const response = await fetch(`${f.base}${path}`);
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), {
      error: '요청한 파일을 찾을 수 없어요.',
      code: 'NOT_FOUND',
    });
  }
  const malformed = await fetch(`${f.base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  const oversized = await f
    .agent()
    .call('/auth/signup', 'POST', { filler: 'x'.repeat(1024 * 1024) });
  assert.equal(oversized.status, 413);
  const wrongType = await fetch(`${f.base}/api/auth/signup`, { method: 'POST', body: '{}' });
  assert.equal(wrongType.status, 415);
});

test('only a site owner can answer real questions; answers survive closed batches, retries and later saves', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  const worker = f.agent();
  const stranger = f.agent();
  const ownerUser = await owner.signup('Owner');
  await worker.signup('Worker');
  await stranger.signup('Stranger');
  const site = await owner.site();
  const otherSite = await stranger.site('다른 덕장');
  await worker.accept((await owner.invite(site.id)).token);
  const operationsPath = `/sites/${site.id}/operations`;
  const guidancePath = `/sites/${site.id}/guidance/guidance-test`;
  await owner.call(operationsPath, 'PUT', { revision: 0, data: workData() });
  const question = (
    await worker.call<OperationsEnvelope>(`${guidancePath}/replies`, 'POST', {
      kind: 'question',
      text: '어디에 널까요?\n바깥쪽인가요?',
    })
  ).body;
  const questionId = question.data.guidance[0].replies[0].id;
  const answerPath = `${guidancePath}/replies/${questionId}/answer`;
  assert.equal((await worker.call(answerPath, 'POST', { text: '위조 답변' })).status, 403);
  assert.equal((await stranger.call(answerPath, 'POST', { text: '다른 덕장 답변' })).status, 403);
  assert.equal(
    (
      await owner.call(
        `/sites/${otherSite.id}/guidance/guidance-test/replies/${questionId}/answer`,
        'POST',
        { text: '다른 덕장 답변' },
      )
    ).status,
    403,
  );
  assert.equal((await owner.call(answerPath, 'POST', { text: ' ' })).status, 400);
  assert.equal((await owner.call(answerPath, 'POST', { text: 'x'.repeat(1001) })).status, 400);
  assert.equal(
    (await owner.call(`${guidancePath}/replies/missing/answer`, 'POST', { text: '답변' })).status,
    404,
  );
  const read = (
    await worker.call<OperationsEnvelope>(`${guidancePath}/replies`, 'POST', { kind: 'read' })
  ).body;
  assert.equal(
    (
      await owner.call(
        `${guidancePath}/replies/${read.data.guidance[0].replies[1].id}/answer`,
        'POST',
        { text: '답변' },
      )
    ).status,
    400,
  );
  const closed = structuredClone(read);
  closed.data.batches[0].status = 'completed';
  closed.data.batches[0].endedAt = '2026-10-04T09:00:00.000Z';
  assert.equal(
    (await owner.call<OperationsEnvelope>(operationsPath, 'PUT', closed)).body.revision,
    4,
  );
  assert.equal(
    (await worker.call(`${guidancePath}/replies`, 'POST', { kind: 'completed' })).body.code,
    'BATCH_CLOSED',
  );
  const answerText = '바깥쪽 건조대에 널어 주세요.\n간격을 확인해 주세요.';
  const answered = (
    await owner.call<OperationsEnvelope>(answerPath, 'POST', {
      text: answerText,
      userId: 'forged',
      userName: 'forged',
    })
  ).body;
  assert.equal(answered.revision, 5);
  assert.deepEqual(answered.data.guidance[0].replies[0].answer, {
    text: answerText,
    at: '2026-10-04T09:00:00.000Z',
    userId: ownerUser.id,
    userName: ownerUser.name,
  });
  assert.equal(answered.data.batches[0].status, 'completed');
  assert.equal(
    (await owner.call<OperationsEnvelope>(answerPath, 'POST', { text: ` ${answerText} ` })).body
      .revision,
    5,
  );
  assert.equal(
    (await owner.call(answerPath, 'POST', { text: '다른 답변으로 수정' })).body.code,
    'ANSWER_EXISTS',
  );
  const staleAnswer = structuredClone(answered);
  delete staleAnswer.data.guidance[0].replies[0].answer;
  assert.equal(
    (await owner.call(operationsPath, 'PUT', staleAnswer)).body.code,
    'PROTECTED_WORKER_HISTORY',
  );
  const updated = structuredClone(answered);
  updated.data.batches[0].note = '응답 이후 운영자 메모';
  assert.equal(
    (await owner.call<OperationsEnvelope>(operationsPath, 'PUT', updated)).body.revision,
    6,
  );
  const reloaded = (await worker.call<OperationsEnvelope>(operationsPath)).body;
  assert.equal(reloaded.data.guidance[0].replies[0].answer?.text, answerText);
});

test('login is limited per client address and email for ten minutes after five failures', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  await owner.signup('Owner');
  await f.agent().signup('Other');
  const wrong = { ...credentials('Owner'), password: 'wrong-password-2026' };
  for (let attempt = 0; attempt < 5; attempt += 1)
    assert.equal((await owner.call('/auth/login', 'POST', wrong)).status, 401);
  const limited = await owner.call('/auth/login', 'POST', credentials('Owner'));
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'LOGIN_RATE_LIMITED');
  assert.equal((await f.agent().call('/auth/login', 'POST', credentials('Other'))).status, 200);
  // 같은 호스트의 프록시(루프백)가 알려 준 다른 접속 주소는 따로 센다.
  assert.equal(
    (
      await f.agent().call('/auth/login', 'POST', credentials('Owner'), {
        'X-Forwarded-For': '203.0.113.7, 10.0.0.1',
      })
    ).status,
    200,
  );
  f.advance(10 * 60 * 1000 - 1);
  assert.equal((await owner.call('/auth/login', 'POST', credentials('Owner'))).status, 429);
  f.advance(1);
  assert.equal((await owner.call('/auth/login', 'POST', credentials('Owner'))).status, 200);
  // 10분이 지난 실패와 성공 전의 실패는 세지 않는다.
  for (let attempt = 0; attempt < 4; attempt += 1) await owner.call('/auth/login', 'POST', wrong);
  f.advance(10 * 60 * 1000);
  assert.equal((await owner.call('/auth/login', 'POST', wrong)).status, 401);
  assert.equal((await owner.call('/auth/login', 'POST', credentials('Owner'))).status, 200);
  for (let attempt = 0; attempt < 4; attempt += 1) await owner.call('/auth/login', 'POST', wrong);
  assert.equal((await owner.call('/auth/login', 'POST', credentials('Owner'))).status, 200);
});

test('signup is limited per client address and an account keeps only its ten newest sessions', async (t) => {
  const f = await fixture(t);
  await f.agent().signup('User0');
  // 실패한 가입(이미 쓰는 이메일)은 세지 않는다.
  for (let attempt = 0; attempt < 3; attempt += 1)
    assert.equal((await f.agent().call('/auth/signup', 'POST', credentials('User0'))).status, 409);
  for (let index = 1; index < 10; index += 1) await f.agent().signup(`User${index}`);
  const limited = await f.agent().call('/auth/signup', 'POST', credentials('User10'));
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'SIGNUP_RATE_LIMITED');
  // 같은 호스트의 프록시(루프백)가 알려 준 다른 접속 주소는 따로 센다.
  const proxied = await f.agent().call('/auth/signup', 'POST', credentials('User10'), {
    'X-Forwarded-For': '203.0.113.9',
  });
  assert.equal(proxied.status, 200);
  f.advance(60 * 60 * 1000);
  assert.equal((await f.agent().call('/auth/signup', 'POST', credentials('User11'))).status, 200);

  // 가입 때 세션 1개 + 로그인 11번: 오래된 2개가 빠지고 최근 10개만 남는다.
  const devices = [];
  for (let index = 0; index < 11; index += 1) {
    f.advance(1);
    const device = f.agent();
    assert.equal((await device.call('/auth/login', 'POST', credentials('User0'))).status, 200);
    devices.push(device);
  }
  const session = async (device: ReturnType<typeof f.agent>) =>
    (await device.call<WorkspaceSession>('/auth/session')).body.user?.email ?? null;
  assert.equal(await session(devices[0]), null);
  assert.equal(await session(devices[1]), 'user0@example.test');
  assert.equal(await session(devices[10]), 'user0@example.test');
  const stored = JSON.parse(await readFile(f.dataFile, 'utf8')) as {
    users: { id: string; email: string }[];
    sessions: { userId: string }[];
  };
  const user0 = stored.users.find((user) => user.email === 'user0@example.test')!;
  assert.equal(stored.sessions.filter((item) => item.userId === user0.id).length, 10);
});

test('session cookies get Secure behind a TLS proxy only when cookieSecure is set', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gwamegi-workspace-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const cookieSecure of [true, false]) {
    // BridgeConfig 의 cookieSecure 가 계정 서비스까지 이어지는지 본다.
    const middleware = createApiMiddleware({
      projectRoot: join(directory, String(cookieSecure)),
      eumServiceKey: '',
      openaiApiKey: '',
      openaiModel: 'test-model',
      llmBaseUrl: 'https://api.openai.com/v1',
      staleAfterMinutes: 30,
      timezoneOffset: '+09:00',
      cookieSecure,
    });
    const { server, base } = await startServer(middleware);
    t.after(() => closeServer(server));
    const client = agent(base);
    for (const [path, body] of [
      ['/auth/signup', credentials('Owner')],
      ['/auth/login', credentials('Owner')],
      ['/auth/logout', {}],
    ] as const) {
      const cookie = (await client.call(path, 'POST', body)).headers.get('set-cookie')!;
      assert.match(cookie, /HttpOnly; SameSite=Lax/, path);
      assert.equal(/; Secure$/.test(cookie), cookieSecure, path);
    }
  }
});

test('health reads the database, and a newer stored schema makes it fail', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gwamegi-workspace-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fileService = createWorkspaceService({ dataFile: join(directory, 'workspace.json') });
  assert.deepEqual(await fileService.health(), { schema: 1 });
  const databasePath = join(directory, 'shared.db');
  const service = createWorkspaceService({ databasePath });
  assert.deepEqual(await service.health(), { schema: 1 });
  await openWorkspaceStore({ databasePath }).write(() => undefined);
  const db = new Database(databasePath);
  db.exec(`UPDATE documents SET schema = 2 WHERE key = 'workspace'`);
  db.close();
  await assert.rejects(service.health(), { code: 'SCHEMA_TOO_NEW' });
});

test('the file store refuses to save an invalid workspace document and keeps the previous file', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  await owner.signup('Owner');
  const site = await owner.site();
  const before = await readFile(f.dataFile, 'utf8');
  await assert.rejects(
    openWorkspaceStore({ dataFile: f.dataFile }).write((db) => {
      db.memberships = [];
    }),
    { code: 'INVALID_DOCUMENT' },
  );
  assert.equal(await readFile(f.dataFile, 'utf8'), before);
  assert.equal((await owner.call<Team>(`/sites/${site.id}/team`)).status, 200);
});

test('admin imports a teammate workspace.json, exports it unchanged, lists users and resets passwords', async (t) => {
  const f = await fixture(t);
  const owner = f.agent();
  const worker = f.agent();
  await owner.signup('Owner');
  await worker.signup('Worker');
  const site = await owner.site();
  await worker.accept((await owner.invite(site.id)).token);
  await owner.call(`/sites/${site.id}/operations`, 'PUT', { revision: 0, data: workData() });
  const original: unknown = JSON.parse(await readFile(f.dataFile, 'utf8'));
  const admin = scriptPath('admin.ts');
  const env = { DATABASE_PATH: join(f.directory, 'db', 'haepung.db') };

  assert.notEqual((await runScript(admin, ['users'], { DATABASE_PATH: '' })).code, 0);
  const broken = join(f.directory, 'broken.json');
  await writeFile(broken, JSON.stringify({ version: 1, users: [{}] }));
  assert.notEqual((await runScript(admin, ['import-json', broken], env)).code, 0);
  const imported = await runScript(admin, ['import-json', f.dataFile], env);
  assert.equal(imported.code, 0, imported.stderr);
  const again = await runScript(admin, ['import-json', f.dataFile], env);
  assert.notEqual(again.code, 0);
  assert.match(again.stderr, /--force/);
  assert.equal((await runScript(admin, ['import-json', f.dataFile, '--force'], env)).code, 0);

  const exported = join(f.directory, 'exported.json');
  assert.equal((await runScript(admin, ['export-json', exported], env)).code, 0);
  assert.deepEqual(JSON.parse(await readFile(exported, 'utf8')), original);
  assert.equal((await stat(exported)).mode & 0o777, 0o600);
  assert.notEqual((await runScript(admin, ['export-json', exported], env)).code, 0);

  const users = (await runScript(admin, ['users'], env)).stdout;
  assert.ok(users.includes(`owner@example.test\t${site.name}(${site.id}):owner`), users);
  assert.ok(users.includes(`worker@example.test\t${site.name}(${site.id}):worker`), users);

  const reset = await runScript(admin, ['reset-password', ' Owner@Example.test '], env);
  assert.equal(reset.code, 0, reset.stderr);
  const temporary = reset.stdout.trim().split(': ').pop()!;
  assert.notEqual((await runScript(admin, ['reset-password', 'nobody@example.test'], env)).code, 0);
  const service = createWorkspaceService({
    databasePath: env.DATABASE_PATH,
    now: () => Date.parse('2026-10-04T09:00:00.000Z'),
  });
  const server = await startServer(createWorkspaceMiddleware(service));
  t.after(() => closeServer(server.server));
  const reader = agent(server.base);
  const sessionOf = async (cookie: string) =>
    (await reader.call<WorkspaceSession>('/auth/session', 'GET', undefined, { Cookie: cookie }))
      .body.user;
  assert.equal(await sessionOf(owner.cookie), null);
  assert.equal((await sessionOf(worker.cookie))?.email, 'worker@example.test');
  assert.equal((await reader.call('/auth/login', 'POST', credentials('Owner'))).status, 401);
  assert.equal(
    (
      await reader.call('/auth/login', 'POST', {
        email: 'owner@example.test',
        password: temporary,
      })
    ).status,
    200,
  );
});
