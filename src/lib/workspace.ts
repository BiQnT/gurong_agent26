import type { OperationsData, GuidanceReply } from './operations.ts';

export type MemberRole = 'owner' | 'worker';
export type MemberLanguage = 'ko' | 'vi';
export type Account = { id: string; name: string; email: string };
export type SiteInput = { name: string; address: string; latitude: number; longitude: number };
export type Site = SiteInput & {
  id: string;
  createdAt: string;
  role: MemberRole;
  language: MemberLanguage;
};
export type WorkspaceSession = { user: Account | null; sites: Site[] };
/** 주소 검색 결과. 도로·마을 단위라 정확한 위치는 지도 핀으로 맞춘다. */
export type GeocodeHit = { latitude: number; longitude: number; label: string };
export type TeamMember = Account & { role: MemberRole; language: MemberLanguage; joinedAt: string };
export type Invitation = {
  id: string;
  siteId: string;
  language: MemberLanguage;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string;
  /** 운영자가 링크를 다시 복사할 수 있는가. 대기 중이고 서버 비밀값으로 만든 초대만 true (ADR 0012) */
  linkAvailable: boolean;
};
export type Team = { members: TeamMember[]; invitations: Invitation[] };
export type InvitePreview = {
  siteName: string;
  ownerName: string;
  language: MemberLanguage;
  expiresAt: string;
  status: Invitation['status'];
};
export type OperationsEnvelope = { data: OperationsData; revision: number };

/** 새 비밀번호 규칙. 서버 가입 검증과 가입 화면이 같은 문구·함수를 쓴다. */
export const PASSWORD_RULE = '비밀번호는 8~128자로, 문자와 숫자를 하나 이상 넣어 주세요.';
/** 가입처럼 비밀번호를 새로 정할 때만 쓴다. 로그인은 규칙 전에 만든 비밀번호도 받도록 길이만 본다. */
export const isStrongPassword = (password: string) =>
  password.length >= 8 &&
  password.length <= 128 &&
  /\p{L}/u.test(password) &&
  /[0-9]/.test(password);

export class WorkspaceError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const environment = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env;
  const base = (environment?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  // Keep the deadline active through response.json(), including stalled response bodies.
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, 20000);
  try {
    let response: Response;
    try {
      response = await fetch(`${base}/api${path}`, {
        method: options.method || 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new WorkspaceError('서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.', 0);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new WorkspaceError('서버 응답을 읽을 수 없어요.', response.status);
    }
    if (!response.ok) {
      const failure =
        typeof data === 'object' && data !== null
          ? (data as { error?: unknown; code?: unknown })
          : {};
      throw new WorkspaceError(
        typeof failure.error === 'string' ? failure.error : '요청을 처리하지 못했어요.',
        response.status,
        typeof failure.code === 'string' ? failure.code : undefined,
      );
    }
    return data as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (timedOut)
      throw new WorkspaceError(
        '서버 응답을 기다리는 시간이 초과됐어요. 저장 여부를 확인한 뒤 다시 시도해 주세요.',
        504,
        'REQUEST_TIMEOUT',
      );
    throw error;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', abort);
  }
}

const sitePath = (id: string) => `/sites/${encodeURIComponent(id)}`;
export const workspaceApi = {
  session: (signal?: AbortSignal) => request<WorkspaceSession>('/auth/session', { signal }),
  signup: (input: { name: string; email: string; password: string }) =>
    request<WorkspaceSession>('/auth/signup', { method: 'POST', body: input }),
  login: (input: { email: string; password: string }) =>
    request<WorkspaceSession>('/auth/login', { method: 'POST', body: input }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST', body: {} }),
  createSite: (input: SiteInput) => request<Site>('/sites', { method: 'POST', body: input }),
  updateSite: (id: string, input: SiteInput) =>
    request<Site>(sitePath(id), { method: 'PATCH', body: input }),
  updatePreference: (id: string, language: MemberLanguage) =>
    request<Site>(`${sitePath(id)}/preferences`, { method: 'PATCH', body: { language } }),
  team: (id: string) => request<Team>(`${sitePath(id)}/team`),
  invite: (id: string, language: MemberLanguage) =>
    request<{ invitation: Invitation; token: string }>(`${sitePath(id)}/invitations`, {
      method: 'POST',
      body: { language },
    }),
  invitationLink: (id: string, invitationId: string) =>
    request<{ token: string }>(
      `${sitePath(id)}/invitations/${encodeURIComponent(invitationId)}/link`,
    ),
  revokeInvite: (id: string, invitationId: string) =>
    request<{ ok: true }>(`${sitePath(id)}/invitations/${encodeURIComponent(invitationId)}`, {
      method: 'DELETE',
    }),
  removeMember: (id: string, memberId: string) =>
    request<{ ok: true }>(`${sitePath(id)}/members/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    }),
  invitation: (token: string) =>
    request<InvitePreview>(`/invitations/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    request<Site>(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} }),
  operations: (id: string, signal?: AbortSignal) =>
    request<OperationsEnvelope>(`${sitePath(id)}/operations`, { signal }),
  saveOperations: (id: string, envelope: OperationsEnvelope) =>
    request<OperationsEnvelope>(`${sitePath(id)}/operations`, { method: 'PUT', body: envelope }),
  answerQuestion: (id: string, guidanceId: string, replyId: string, text: string) =>
    request<OperationsEnvelope>(
      `${sitePath(id)}/guidance/${encodeURIComponent(guidanceId)}/replies/${encodeURIComponent(replyId)}/answer`,
      { method: 'POST', body: { text } },
    ),
  geocode: (query: string, signal?: AbortSignal) =>
    request<{ results: GeocodeHit[] }>(`/geocode/search?q=${encodeURIComponent(query)}`, {
      signal,
    }),
  reverseGeocode: (location: { latitude: number; longitude: number }, signal?: AbortSignal) =>
    request<{ address: string | null }>(
      `/geocode/reverse?lat=${location.latitude}&lng=${location.longitude}`,
      { signal },
    ),
  reply: (id: string, guidanceId: string, kind: GuidanceReply['kind'], text?: string) =>
    request<OperationsEnvelope>(
      `${sitePath(id)}/guidance/${encodeURIComponent(guidanceId)}/replies`,
      { method: 'POST', body: { kind, text } },
    ),
};
