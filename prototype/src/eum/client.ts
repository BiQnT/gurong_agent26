import type { CatalogApi } from './catalog.ts';

export type EumResult =
  | { ok: true; apiId: string; fetchedAt: string; fetchedAtKst: string; data: unknown }
  | { ok: false; apiId: string; fetchedAt: string; fetchedAtKst: string; error: string; httpStatus?: number };

type CallOptions = {
  serviceKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

// E-UM 발급 키를 URL에서 복사하면 %2F 처럼 이미 인코딩된 채로 .env 에 들어가는 경우가 있다.
// URLSearchParams 가 이를 다시 인코딩하면 %252F 가 되어 401 이 나므로 한 번 풀어둔다.
// (승계 코드 ideas/001 dry_check_agent.py 의 unquote 와 같은 처리)
export function normalizeServiceKey(key: string): string {
  if (!key.includes('%')) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

// E-UM 응답의 측정 시각(logDateTime 등)은 시간대 표기 없이 KST 로 보인다.
// 에이전트가 경과 시간을 비교할 수 있게 조회 시각도 같은 형식으로 준다.
export function formatKst(date: Date): string {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false });
}

/**
 * E-UM API 한 건을 호출한다. 실패해도 던지지 않고 { ok: false } 로 돌려준다.
 * 에러 문자열에는 요청 URL을 넣지 않는다 (serviceKey 가 쿼리스트링에 있다).
 */
export async function callEum(
  api: CatalogApi,
  params: Record<string, string>,
  options: CallOptions,
): Promise<EumResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now?.() ?? new Date();
  const base = { apiId: api.apiId, fetchedAt: now.toISOString(), fetchedAtKst: formatKst(now) };

  const serviceKey = normalizeServiceKey(options.serviceKey);
  const url = new URL(api.url);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('serviceKey', serviceKey); // 마지막에 넣어 params 가 덮어쓰지 못하게 한다
  // 응답 본문 일부를 에러로 돌려주므로, 혹시 키가 메아리쳐 와도 가린다.
  const excerpt = (text: string) => text.slice(0, 200).replaceAll(serviceKey, '***').replaceAll(options.serviceKey, '***');

  let lastError = '';
  // 네트워크 오류와 5xx 만 한 번 더 시도한다. 4xx 는 다시 불러도 같다.
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      text = await response.text();
    } catch (error) {
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      continue;
    }
    if (response.status >= 500) {
      lastError = `HTTP ${response.status}`;
      continue;
    }
    if (!response.ok) {
      return { ok: false, ...base, httpStatus: response.status, error: `HTTP ${response.status}: ${excerpt(text)}` };
    }
    let body: { status?: unknown; data?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, ...base, httpStatus: response.status, error: `JSON 이 아닌 응답: ${excerpt(text)}` };
    }
    if (body.status !== 'success') {
      return { ok: false, ...base, httpStatus: response.status, error: `E-UM status=${String(body.status)}: ${excerpt(text)}` };
    }
    return { ok: true, ...base, data: body.data };
  }
  return { ok: false, ...base, error: lastError };
}
