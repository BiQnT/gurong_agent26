import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { BridgeError } from './eum.ts';
import {
  createInitialOperationsData,
  recordWorkerReply,
  validateOperationsData,
  type GuidanceReply,
  type OperationsData,
} from '../src/lib/operations.ts';
import type {
  Account,
  Invitation,
  InvitePreview,
  MemberLanguage,
  MemberRole,
  OperationsEnvelope,
  Site,
  SiteInput,
  Team,
  WorkspaceSession,
} from '../src/lib/workspace.ts';

const COOKIE_NAME = 'gwamegi_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const INVITATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string =>
  typeof value === 'string' &&
  !!value.trim() &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
const contentText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  !!value.trim() &&
  value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const time = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const language = (value: unknown): value is MemberLanguage => value === 'ko' || value === 'vi';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function fail(status: number, code: string, message: string): never {
  throw new BridgeError(status, code, message);
}

export type StoredSite = SiteInput & { id: string; createdAt: string };
export type SiteMembership = {
  siteId: string;
  userId: string;
  role: MemberRole;
  language: MemberLanguage;
  joinedAt: string;
};
type StoredUser = Account & { salt: string; passwordHash: string; createdAt: string };
type StoredSession = { tokenHash: string; userId: string; expiresAt: string };
type StoredInvitation = Omit<Invitation, 'status'> & {
  tokenHash: string;
  status: 'pending' | 'accepted' | 'revoked';
  acceptedBy?: string;
};
type StoredOperations = OperationsEnvelope & { siteId: string };
type Database = {
  version: 1;
  users: StoredUser[];
  sites: StoredSite[];
  memberships: SiteMembership[];
  sessions: StoredSession[];
  invitations: StoredInvitation[];
  operations: StoredOperations[];
};
export type WorkspaceConfig = { projectRoot?: string; dataFile?: string; now?: () => number };
export type WorkspaceMembership = { user: Account; site: StoredSite; membership: SiteMembership };
const emptyDatabase = (): Database => ({
  version: 1,
  users: [],
  sites: [],
  memberships: [],
  sessions: [],
  invitations: [],
  operations: [],
});
const account = ({ id, name, email }: StoredUser): Account => ({ id, name, email });
const unique = (values: string[]) => new Set(values).size === values.length;
function validSiteInput(value: unknown): value is SiteInput {
  return (
    object(value) &&
    text(value.name, 100) &&
    contentText(value.address, 300) &&
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}
function validDatabase(value: unknown): value is Database {
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.users) ||
    !Array.isArray(value.sites) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.invitations) ||
    !Array.isArray(value.operations)
  )
    return false;
  if (
    !value.users.every(
      (u) =>
        object(u) &&
        text(u.id) &&
        text(u.name, 80) &&
        text(u.email, 254) &&
        time(u.createdAt) &&
        typeof u.salt === 'string' &&
        /^[a-f0-9]{32}$/.test(u.salt) &&
        typeof u.passwordHash === 'string' &&
        /^[a-f0-9]{128}$/.test(u.passwordHash),
    ) ||
    !value.sites.every((s) => object(s) && text(s.id) && time(s.createdAt) && validSiteInput(s))
  )
    return false;
  const users = value.users as StoredUser[];
  const sites = value.sites as StoredSite[];
  const hasUser = (id: unknown) => users.some((u) => u.id === id);
  const hasSite = (id: unknown) => sites.some((s) => s.id === id);
  if (
    !value.memberships.every(
      (m) =>
        object(m) &&
        hasUser(m.userId) &&
        hasSite(m.siteId) &&
        (m.role === 'owner' || m.role === 'worker') &&
        language(m.language) &&
        time(m.joinedAt),
    ) ||
    !value.sessions.every(
      (s) =>
        object(s) &&
        typeof s.tokenHash === 'string' &&
        HASH_PATTERN.test(s.tokenHash) &&
        hasUser(s.userId) &&
        time(s.expiresAt),
    ) ||
    !value.invitations.every(
      (i) =>
        object(i) &&
        text(i.id) &&
        hasSite(i.siteId) &&
        language(i.language) &&
        time(i.createdAt) &&
        time(i.expiresAt) &&
        typeof i.tokenHash === 'string' &&
        HASH_PATTERN.test(i.tokenHash) &&
        ['pending', 'accepted', 'revoked'].includes(String(i.status)) &&
        (i.status === 'accepted' ? hasUser(i.acceptedBy) : i.acceptedBy === undefined),
    ) ||
    !value.operations.every(
      (o) =>
        object(o) &&
        hasSite(o.siteId) &&
        Number.isSafeInteger(o.revision) &&
        (o.revision as number) >= 0 &&
        validateOperationsData(o.data),
    )
  )
    return false;
  const memberships = value.memberships as SiteMembership[];
  return (
    unique(users.map((u) => u.id)) &&
    unique(users.map((u) => u.email)) &&
    unique(sites.map((s) => s.id)) &&
    unique(memberships.map((m) => `${m.siteId}:${m.userId}`)) &&
    unique((value.sessions as StoredSession[]).map((s) => s.tokenHash)) &&
    unique((value.invitations as StoredInvitation[]).map((i) => i.id)) &&
    unique((value.invitations as StoredInvitation[]).map((i) => i.tokenHash)) &&
    unique((value.operations as StoredOperations[]).map((o) => o.siteId)) &&
    sites.every(
      (s) =>
        memberships.filter((m) => m.siteId === s.id && m.role === 'owner').length === 1 &&
        (value.operations as StoredOperations[]).some((o) => o.siteId === s.id),
    )
  );
}

/** One serialized transaction queue is shared by all service instances for a data file. */
const stores = new Map<string, ReturnType<typeof diskStore>>();
function diskStore(dataFile: string) {
  let database: Database | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  async function load() {
    if (database) return database;
    try {
      const parsed: unknown = JSON.parse(await readFile(dataFile, 'utf8'));
      if (!validDatabase(parsed)) throw new Error('Invalid workspace data');
      await chmod(dataFile, 0o600);
      database = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      database = emptyDatabase();
    }
    return database;
  }
  async function save(next: Database) {
    await mkdir(dirname(dataFile), { recursive: true, mode: 0o700 });
    const temporary = `${dataFile}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(next), 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, dataFile);
      database = next;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  function run<T>(write: boolean, action: (db: Database) => T | Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      const current = await load();
      const candidate = write ? structuredClone(current) : current;
      const output = await action(candidate);
      if (write) await save(candidate);
      return structuredClone(output);
    });
    queue = result.catch(() => undefined);
    return result;
  }
  return {
    read: <T>(action: (db: Database) => T | Promise<T>) => run(false, action),
    write: <T>(action: (db: Database) => T | Promise<T>) => run(true, action),
  };
}
function passwordHash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, derived) =>
      error ? reject(error) : resolve(derived.toString('hex')),
    );
  });
}
function readCredentials(value: unknown, signup = false) {
  if (
    !object(value) ||
    typeof value.email !== 'string' ||
    typeof value.password !== 'string' ||
    value.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) ||
    value.password.length < 8 ||
    value.password.length > 128 ||
    (signup && !text(value.name, 80))
  ) {
    fail(400, 'INVALID_CREDENTIALS', '이름, 이메일과 8~128자의 비밀번호를 확인해 주세요.');
  }
  return {
    email: value.email.trim().toLowerCase(),
    password: value.password,
    name: signup ? (value.name as string).trim() : '',
  };
}
function readSite(value: unknown): SiteInput {
  if (!validSiteInput(value))
    fail(400, 'INVALID_SITE', '덕장 이름, 주소와 올바른 위도·경도를 입력해 주세요.');
  return {
    name: value.name.trim(),
    address: value.address.trim(),
    latitude: value.latitude,
    longitude: value.longitude,
  };
}
function readCookie(request: IncomingMessage) {
  const entries = (request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (entries.length !== 1) return null;
  const token = entries[0].slice(COOKIE_NAME.length + 1);
  return TOKEN_PATTERN.test(token) ? hash(token) : null;
}
function setCookie(response: ServerResponse, token: string, request: IncomingMessage) {
  const secure = 'encrypted' in request.socket && request.socket.encrypted ? '; Secure' : '';
  response.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSION_MS / 1000 : 0}${secure}`,
  );
}

export function createWorkspaceService(config: WorkspaceConfig = {}) {
  const dataFile = resolve(
    config.dataFile || join(config.projectRoot || process.cwd(), '.local-data', 'workspace.json'),
  );
  let store = stores.get(dataFile);
  if (!store) {
    store = diskStore(dataFile);
    stores.set(dataFile, store);
  }
  const dbStore = store;
  const clock = config.now || Date.now;
  const timestamp = () => new Date(clock()).toISOString();
  function userFor(db: Database, request: IncomingMessage): StoredUser | null {
    const tokenHash = readCookie(request);
    const session =
      tokenHash &&
      db.sessions.find((s) => s.tokenHash === tokenHash && Date.parse(s.expiresAt) > clock());
    return session ? db.users.find((u) => u.id === session.userId) || null : null;
  }
  function requireUser(db: Database, request: IncomingMessage) {
    return userFor(db, request) || fail(401, 'AUTH_REQUIRED', '로그인한 뒤 이용해 주세요.');
  }
  function requireMember(
    db: Database,
    request: IncomingMessage,
    siteId: string,
    role?: MemberRole,
  ): WorkspaceMembership {
    const user = requireUser(db, request);
    const membership = db.memberships.find((m) => m.siteId === siteId && m.userId === user.id);
    const site = db.sites.find((s) => s.id === siteId);
    if (!membership || !site || (role && membership.role !== role))
      fail(403, 'SITE_ACCESS_DENIED', '이 덕장에서 요청한 작업을 할 권한이 없어요.');
    return { user: account(user), site, membership };
  }
  function siteFor(site: StoredSite, member: SiteMembership): Site {
    return { ...site, role: member.role, language: member.language };
  }
  function sessionFor(db: Database, user: StoredUser | null): WorkspaceSession {
    if (!user) return { user: null, sites: [] };
    return {
      user: account(user),
      sites: db.memberships
        .filter((m) => m.userId === user.id)
        .map((m) =>
          siteFor(
            db.sites.find((s) => s.id === m.siteId)!,
            m,
          ),
        ),
    };
  }
  function issueSession(db: Database, user: StoredUser, request: IncomingMessage) {
    const old = readCookie(request);
    db.sessions = db.sessions.filter(
      (s) => s.tokenHash !== old && Date.parse(s.expiresAt) > clock(),
    );
    const token = randomBytes(32).toString('base64url');
    db.sessions.push({
      tokenHash: hash(token),
      userId: user.id,
      expiresAt: new Date(clock() + SESSION_MS).toISOString(),
    });
    return token;
  }
  function invitationFor(item: StoredInvitation): Invitation {
    return {
      id: item.id,
      siteId: item.siteId,
      language: item.language,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      status:
        item.status === 'pending' && Date.parse(item.expiresAt) <= clock()
          ? 'expired'
          : item.status,
    };
  }
  function tokenInvitation(db: Database, token: string) {
    if (!TOKEN_PATTERN.test(token))
      fail(404, 'INVITATION_NOT_FOUND', '초대 링크를 찾을 수 없어요.');
    return (
      db.invitations.find((i) => i.tokenHash === hash(token)) ||
      fail(404, 'INVITATION_NOT_FOUND', '초대 링크를 찾을 수 없어요.')
    );
  }
  function operationsFor(db: Database, siteId: string): StoredOperations {
    return db.operations.find((entry) => entry.siteId === siteId)!;
  }
  const envelope = ({ data, revision }: StoredOperations): OperationsEnvelope => ({
    data,
    revision,
  });
  return {
    requireMember: (request: IncomingMessage, siteId: string, role?: MemberRole) =>
      dbStore.read((db) => requireMember(db, request, siteId, role)),
    session: (request: IncomingMessage) =>
      dbStore.read((db) => sessionFor(db, userFor(db, request))),
    async signup(request: IncomingMessage, response: ServerResponse, body: unknown) {
      const input = readCredentials(body, true);
      const salt = randomBytes(16).toString('hex');
      const derived = await passwordHash(input.password, salt);
      const result = await dbStore.write((db) => {
        if (db.users.some((u) => u.email === input.email))
          fail(409, 'EMAIL_IN_USE', '이미 가입한 이메일이에요. 로그인해 주세요.');
        const user: StoredUser = {
          id: randomUUID(),
          name: input.name,
          email: input.email,
          salt,
          passwordHash: derived,
          createdAt: timestamp(),
        };
        db.users.push(user);
        return { token: issueSession(db, user, request), session: sessionFor(db, user) };
      });
      setCookie(response, result.token, request);
      return result.session;
    },
    async login(request: IncomingMessage, response: ServerResponse, body: unknown) {
      const input = readCredentials(body);
      const candidate = await dbStore.read((db) => db.users.find((u) => u.email === input.email));
      const derived = await passwordHash(
        input.password,
        candidate?.salt || '00000000000000000000000000000000',
      );
      if (
        !candidate ||
        !timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(candidate.passwordHash, 'hex'))
      )
        fail(401, 'LOGIN_FAILED', '이메일 또는 비밀번호가 올바르지 않아요.');
      const result = await dbStore.write((db) => {
        const user = db.users.find((u) => u.id === candidate.id)!;
        return { token: issueSession(db, user, request), session: sessionFor(db, user) };
      });
      setCookie(response, result.token, request);
      return result.session;
    },
    async logout(request: IncomingMessage, response: ServerResponse) {
      await dbStore.write((db) => {
        const tokenHash = readCookie(request);
        db.sessions = db.sessions.filter(
          (s) => s.tokenHash !== tokenHash && Date.parse(s.expiresAt) > clock(),
        );
      });
      setCookie(response, '', request);
      return { ok: true as const };
    },
    createSite: (request: IncomingMessage, body: unknown) =>
      dbStore.write((db) => {
        const user = requireUser(db, request);
        const site: StoredSite = { ...readSite(body), id: randomUUID(), createdAt: timestamp() };
        const member: SiteMembership = {
          siteId: site.id,
          userId: user.id,
          role: 'owner',
          language: 'ko',
          joinedAt: site.createdAt,
        };
        db.sites.push(site);
        db.memberships.push(member);
        db.operations.push({ siteId: site.id, revision: 0, data: createInitialOperationsData() });
        return siteFor(site, member);
      }),
    updateSite: (request: IncomingMessage, siteId: string, body: unknown) =>
      dbStore.write((db) => {
        const { site, membership } = requireMember(db, request, siteId, 'owner');
        Object.assign(site, readSite(body));
        return siteFor(site, membership);
      }),
    updatePreference: (request: IncomingMessage, siteId: string, body: unknown) =>
      dbStore.write((db) => {
        const { site, membership } = requireMember(db, request, siteId);
        if (!object(body) || !language(body.language))
          fail(400, 'INVALID_LANGUAGE', '한국어 또는 베트남어를 선택해 주세요.');
        membership.language = body.language;
        return siteFor(site, membership);
      }),
    team: (request: IncomingMessage, siteId: string): Promise<Team> =>
      dbStore.read((db) => {
        requireMember(db, request, siteId, 'owner');
        return {
          members: db.memberships
            .filter((m) => m.siteId === siteId)
            .map((m) => ({
              ...account(db.users.find((u) => u.id === m.userId)!),
              role: m.role,
              language: m.language,
              joinedAt: m.joinedAt,
            })),
          invitations: db.invitations.filter((i) => i.siteId === siteId).map(invitationFor),
        };
      }),
    invite: (request: IncomingMessage, siteId: string, body: unknown) =>
      dbStore.write((db) => {
        requireMember(db, request, siteId, 'owner');
        if (!object(body) || !language(body.language))
          fail(400, 'INVALID_LANGUAGE', '한국어 또는 베트남어를 선택해 주세요.');
        const token = randomBytes(32).toString('base64url');
        const invitation: StoredInvitation = {
          id: randomUUID(),
          siteId,
          language: body.language,
          tokenHash: hash(token),
          status: 'pending',
          createdAt: timestamp(),
          expiresAt: new Date(clock() + INVITATION_MS).toISOString(),
        };
        db.invitations.push(invitation);
        return { invitation: invitationFor(invitation), token };
      }),
    revokeInvite: (request: IncomingMessage, siteId: string, invitationId: string) =>
      dbStore.write((db) => {
        requireMember(db, request, siteId, 'owner');
        const invitation =
          db.invitations.find((i) => i.id === invitationId && i.siteId === siteId) ||
          fail(404, 'INVITATION_NOT_FOUND', '초대를 찾을 수 없어요.');
        if (invitation.status === 'accepted')
          fail(
            409,
            'INVITATION_USED',
            '이미 수락된 초대예요. 팀원 관리에서 접근 권한을 제거해 주세요.',
          );
        invitation.status = 'revoked';
        return { ok: true as const };
      }),
    removeMember: (request: IncomingMessage, siteId: string, memberId: string) =>
      dbStore.write((db) => {
        requireMember(db, request, siteId, 'owner');
        const member =
          db.memberships.find((m) => m.siteId === siteId && m.userId === memberId) ||
          fail(404, 'MEMBER_NOT_FOUND', '팀원을 찾을 수 없어요.');
        if (member.role === 'owner')
          fail(409, 'OWNER_REQUIRED', '덕장 운영자는 팀에서 제거할 수 없어요.');
        db.memberships = db.memberships.filter((m) => m !== member);
        return { ok: true as const };
      }),
    invitation: (token: string): Promise<InvitePreview> =>
      dbStore.read((db) => {
        const invitation = tokenInvitation(db, token);
        const site = db.sites.find((s) => s.id === invitation.siteId)!;
        const owner = db.memberships.find((m) => m.siteId === site.id && m.role === 'owner')!;
        return {
          siteName: site.name,
          ownerName: db.users.find((u) => u.id === owner.userId)!.name,
          language: invitation.language,
          expiresAt: invitation.expiresAt,
          status: invitationFor(invitation).status,
        };
      }),
    acceptInvite: (request: IncomingMessage, token: string) =>
      dbStore.write((db) => {
        const user = requireUser(db, request);
        const invitation = tokenInvitation(db, token);
        const existing = db.memberships.find(
          (m) => m.siteId === invitation.siteId && m.userId === user.id,
        );
        const site = db.sites.find((s) => s.id === invitation.siteId)!;
        if (invitation.status === 'accepted' && invitation.acceptedBy === user.id && existing)
          return siteFor(site, existing);
        if (invitation.status !== 'pending' || Date.parse(invitation.expiresAt) <= clock())
          fail(
            410,
            'INVITATION_UNAVAILABLE',
            '만료되었거나 이미 사용·취소된 초대예요. 새 초대를 요청해 주세요.',
          );
        if (existing?.role === 'owner')
          fail(
            409,
            'ALREADY_OWNER',
            '이미 이 덕장의 운영자예요. 초대 링크를 근로자에게 전달해 주세요.',
          );
        const member: SiteMembership = existing || {
          siteId: site.id,
          userId: user.id,
          role: 'worker',
          language: invitation.language,
          joinedAt: timestamp(),
        };
        if (!existing) db.memberships.push(member);
        invitation.status = 'accepted';
        invitation.acceptedBy = user.id;
        return siteFor(site, member);
      }),
    operations: (request: IncomingMessage, siteId: string) =>
      dbStore.read((db) => {
        requireMember(db, request, siteId);
        return envelope(operationsFor(db, siteId));
      }),
    saveOperations: (request: IncomingMessage, siteId: string, body: unknown) =>
      dbStore.write((db) => {
        requireMember(db, request, siteId, 'owner');
        if (
          !object(body) ||
          !Number.isSafeInteger(body.revision) ||
          (body.revision as number) < 0 ||
          !validateOperationsData(body.data)
        )
          fail(400, 'INVALID_OPERATIONS', '작업 기록의 형식이 올바르지 않아요.');
        const current = operationsFor(db, siteId);
        if (body.revision !== current.revision)
          fail(
            409,
            'REVISION_CONFLICT',
            '다른 사용자가 기록을 갱신했어요. 최신 내용을 확인한 뒤 다시 저장해 주세요.',
          );
        protectWorkerHistory(current.data, body.data);
        current.data = body.data;
        current.revision += 1;
        return envelope(current);
      }),
    reply: (request: IncomingMessage, siteId: string, guidanceId: string, body: unknown) =>
      dbStore.write((db) => {
        const { user } = requireMember(db, request, siteId, 'worker');
        if (
          !object(body) ||
          !['read', 'completed', 'question'].includes(String(body.kind)) ||
          typeof body.kind !== 'string' ||
          (body.kind === 'question' && !contentText(body.text, 2000)) ||
          (body.text !== undefined && (typeof body.text !== 'string' || body.text.length > 2000))
        )
          fail(400, 'INVALID_REPLY', '응답 종류와 2,000자 이내의 질문을 확인해 주세요.');
        const current = operationsFor(db, siteId);
        const target =
          current.data.guidance.find((g) => g.id === guidanceId) ||
          fail(404, 'GUIDANCE_NOT_FOUND', '작업 안내를 찾을 수 없어요.');
        if (
          body.kind !== 'question' &&
          target.replies.some((r) => r.kind === body.kind && r.userId === user.id && !r.simulated)
        )
          return envelope(current);
        if (
          target.batchId &&
          current.data.batches.some(
            (batch) => batch.id === target.batchId && batch.status !== 'ongoing',
          )
        ) {
          fail(409, 'BATCH_CLOSED', '종료되거나 취소된 배치에는 새 작업 응답을 남길 수 없어요.');
        }
        const reply: GuidanceReply = {
          id: randomUUID(),
          at: timestamp(),
          kind: body.kind as GuidanceReply['kind'],
          simulated: false,
          userId: user.id,
          userName: user.name,
          text:
            body.kind === 'read'
              ? 'Đã đọc · 안내를 확인했어요.'
              : body.kind === 'completed'
                ? 'Đã hoàn thành · 작업을 완료했어요.'
                : (body.text as string).trim(),
        };
        current.data = recordWorkerReply(current.data, guidanceId, reply);
        current.revision += 1;
        return envelope(current);
      }),
    answerQuestion: (
      request: IncomingMessage,
      siteId: string,
      guidanceId: string,
      replyId: string,
      body: unknown,
    ) =>
      dbStore.write((db) => {
        const { user } = requireMember(db, request, siteId, 'owner');
        if (!object(body) || !contentText(body.text, 1000))
          fail(400, 'INVALID_ANSWER', '1,000자 이내로 답변을 입력해 주세요.');
        const current = operationsFor(db, siteId);
        const guidance =
          current.data.guidance.find((g) => g.id === guidanceId) ||
          fail(404, 'GUIDANCE_NOT_FOUND', '작업 안내를 찾을 수 없어요.');
        const reply =
          guidance.replies.find((item) => item.id === replyId) ||
          fail(404, 'REPLY_NOT_FOUND', '질문을 찾을 수 없어요.');
        if (reply.kind !== 'question' || reply.simulated)
          fail(400, 'NOT_A_QUESTION', '근로자가 남긴 실제 질문에만 답할 수 있어요.');
        const answerText = body.text.trim();
        if (reply.answer) {
          if (reply.answer.text !== answerText)
            fail(409, 'ANSWER_EXISTS', '이미 답변한 질문이에요. 보낸 답변은 변경할 수 없어요.');
          return envelope(current);
        }
        reply.answer = {
          text: answerText,
          at: new Date(Math.max(clock(), Date.parse(reply.at))).toISOString(),
          userId: user.id,
          userName: user.name,
        };
        current.revision += 1;
        return envelope(current);
      }),
  };
}
export type WorkspaceService = ReturnType<typeof createWorkspaceService>;

/** Client saves cannot manufacture, erase, or edit another account's response history. */
function protectWorkerHistory(previous: OperationsData, next: OperationsData) {
  for (const guidance of next.guidance) {
    const old = previous.guidance.find((g) => g.id === guidance.id);
    if (!isDeepStrictEqual(guidance.replies, old?.replies || []))
      fail(400, 'PROTECTED_WORKER_HISTORY', '근로자 응답은 해당 계정에서만 추가할 수 있어요.');
  }
  for (const old of previous.guidance) {
    if (old.replies.length && !next.guidance.some((g) => g.id === old.id))
      fail(400, 'PROTECTED_WORKER_HISTORY', '근로자 응답이 있는 안내는 삭제할 수 없어요.');
  }
  for (const batch of next.batches) {
    const old = previous.batches.find((b) => b.id === batch.id);
    if (
      !isDeepStrictEqual(
        batch.logs.filter((l) => l.kind === 'worker'),
        old?.logs.filter((l) => l.kind === 'worker') || [],
      )
    )
      fail(400, 'PROTECTED_WORKER_HISTORY', '근로자 응답 이력은 변경할 수 없어요.');
  }
  for (const old of previous.batches) {
    if (old.logs.some((l) => l.kind === 'worker') && !next.batches.some((b) => b.id === old.id))
      fail(400, 'PROTECTED_WORKER_HISTORY', '근로자 응답 이력이 있는 배치는 삭제할 수 없어요.');
  }
}

function isPublicTunnelHost(hostname: string): boolean {
  // Read lazily: tunnel hosts can come from .env.local loaded after module init.
  const hosts = (process.env.PUBLIC_TUNNEL_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return hosts.some((allowed) =>
    allowed.startsWith('.') ? hostname.endsWith(allowed) : hostname === allowed,
  );
}

export function isLocalWorkspaceRequest(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (!host) return false;
  try {
    const url = new URL(`http://${host}`);
    const isTunnel = isPublicTunnelHost(url.hostname);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !isTunnel) return false;
    const remote = request.socket.remoteAddress;
    // Tunnel clients forward to localhost, so the direct peer stays local.
    if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
    if (request.headers.origin) {
      try {
        if (isTunnel) {
          if (new URL(request.headers.origin).hostname !== url.hostname) return false;
        } else if (request.headers.origin !== url.origin) return false;
      } catch {
        return false;
      }
    }
    return request.headers['sec-fetch-site'] !== 'cross-site';
  } catch {
    return false;
  }
}
function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return Promise.reject(new BridgeError(415, 'JSON_REQUIRED', 'JSON 형식의 요청이 필요해요.'));
  }
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', data);
      request.off('end', end);
      request.off('error', error);
      request.off('aborted', error);
      clearTimeout(deadline);
    };
    const error = () => {
      cleanup();
      reject(new BridgeError(400, 'BODY_ERROR', '요청 본문을 읽을 수 없어요.'));
    };
    const data = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        cleanup();
        request.resume();
        reject(new BridgeError(413, 'BODY_TOO_LARGE', '저장할 작업 기록이 너무 커요.'));
        return;
      }
      chunks.push(buffer);
    };
    const end = () => {
      cleanup();
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new BridgeError(400, 'INVALID_JSON', '요청 본문이 올바른 JSON 형식이 아니에요.'));
      }
    };
    const deadline = setTimeout(() => {
      cleanup();
      request.resume();
      reject(new BridgeError(408, 'BODY_TIMEOUT', '요청 본문을 기다리는 시간이 초과됐어요.'));
    }, 30000);
    request.on('data', data);
    request.on('end', end);
    request.on('error', error);
    request.on('aborted', error);
  });
}
export function createWorkspaceMiddleware(service: WorkspaceService): Connect.NextHandleFunction {
  return (request, response, next) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (!/^\/api\/(?:auth(?:\/|$)|sites(?:\/|$)|invitations(?:\/|$))/.test(path)) {
      next();
      return;
    }
    const send = (status: number, payload: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.end(JSON.stringify(payload));
    };
    void (async () => {
      try {
        if (!isLocalWorkspaceRequest(request))
          fail(403, 'LOCAL_ORIGIN_REQUIRED', '같은 로컬 화면에서만 API를 사용할 수 있어요.');
        let parts: string[];
        try {
          parts = path.split('/').slice(2).map(decodeURIComponent);
        } catch {
          fail(400, 'INVALID_PATH', '요청 주소가 올바르지 않아요.');
        }
        const method = request.method;
        const expect = (allowed: string) => {
          if (method !== allowed) fail(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식이에요.');
        };
        let result: unknown;
        if (parts[0] === 'auth' && parts.length === 2) {
          if (parts[1] === 'session') {
            expect('GET');
            result = await service.session(request);
          } else if (parts[1] === 'signup') {
            expect('POST');
            result = await service.signup(request, response, await readBody(request));
          } else if (parts[1] === 'login') {
            expect('POST');
            result = await service.login(request, response, await readBody(request));
          } else if (parts[1] === 'logout') {
            expect('POST');
            await readBody(request);
            result = await service.logout(request, response);
          } else fail(404, 'NOT_FOUND', '요청한 API를 찾을 수 없어요.');
        } else if (parts[0] === 'sites') {
          const siteId = parts[1];
          if (parts.length === 1) {
            expect('POST');
            result = await service.createSite(request, await readBody(request));
          } else if (parts.length === 2) {
            expect('PATCH');
            result = await service.updateSite(request, siteId, await readBody(request));
          } else if (parts[2] === 'preferences' && parts.length === 3) {
            expect('PATCH');
            result = await service.updatePreference(request, siteId, await readBody(request));
          } else if (parts[2] === 'team' && parts.length === 3) {
            expect('GET');
            result = await service.team(request, siteId);
          } else if (parts[2] === 'invitations' && parts.length === 3) {
            expect('POST');
            result = await service.invite(request, siteId, await readBody(request));
          } else if (parts[2] === 'invitations' && parts.length === 4) {
            expect('DELETE');
            result = await service.revokeInvite(request, siteId, parts[3]);
          } else if (parts[2] === 'members' && parts.length === 4) {
            expect('DELETE');
            result = await service.removeMember(request, siteId, parts[3]);
          } else if (parts[2] === 'operations' && parts.length === 3) {
            if (method === 'GET') result = await service.operations(request, siteId);
            else {
              expect('PUT');
              result = await service.saveOperations(request, siteId, await readBody(request));
            }
          } else if (parts[2] === 'guidance' && parts.length === 5 && parts[4] === 'replies') {
            expect('POST');
            result = await service.reply(request, siteId, parts[3], await readBody(request));
          } else if (
            parts[2] === 'guidance' &&
            parts.length === 7 &&
            parts[4] === 'replies' &&
            parts[6] === 'answer'
          ) {
            expect('POST');
            result = await service.answerQuestion(
              request,
              siteId,
              parts[3],
              parts[5],
              await readBody(request),
            );
          } else fail(404, 'NOT_FOUND', '요청한 API를 찾을 수 없어요.');
        } else if (parts[0] === 'invitations' && parts.length === 2) {
          expect('GET');
          result = await service.invitation(parts[1]);
        } else if (parts[0] === 'invitations' && parts.length === 3 && parts[2] === 'accept') {
          expect('POST');
          await readBody(request);
          result = await service.acceptInvite(request, parts[1]);
        } else fail(404, 'NOT_FOUND', '요청한 API를 찾을 수 없어요.');
        send(200, result);
      } catch (error) {
        if (error instanceof BridgeError)
          send(error.status, { error: error.message, code: error.code });
        else
          send(500, {
            error: '작업 정보를 저장하거나 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.',
            code: 'WORKSPACE_ERROR',
          });
      }
    })();
  };
}
