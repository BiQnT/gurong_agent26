import { object, type BridgeConfig } from '../eum.ts';

// E-UM INT_S06_005 자외선 실시간. 근로자 햇빛 노출 조언의 참고값일 뿐 건조 판정에는 쓰지 않는다.
const UV_URL = 'https://genix.pohang-eum.kr/dpg/sensor/latest/uvIndex';
const CACHE_MS = 10 * 60 * 1000;
// 실패는 짧게만 기억한다. 잠깐의 장애가 10분 동안 자외선을 가리지 않게 한다.
const FAILURE_CACHE_MS = 60 * 1000;
const TIMEOUT_MS = 12000;
// 센서 오류값(8.68e31 등)을 거르는 자료 확인 범위다. 위험·안전 기준이 아니다.
const MAX_UV_INDEX = 20;
const UV_MAX_AGE_MS = 60 * 60 * 1000;

export type UvStage = '낮음' | '보통' | '높음' | '매우높음' | '위험';
export type UvReading = { uvIndex: number; observedAt: string; stage: UvStage; fetchedAt: string };
export type UvIndexSource = () => Promise<UvReading | null>;

/** 기상청 자외선지수 단계. 지수는 정수로 발표되므로 소수 측정값은 반올림해 단계를 정한다. */
export function uvStage(uvIndex: number): UvStage {
  const value = Math.round(uvIndex);
  if (value <= 2) return '낮음';
  if (value <= 5) return '보통';
  if (value <= 7) return '높음';
  if (value <= 10) return '매우높음';
  return '위험';
}

function readObservedAt(value: unknown, timezoneOffset: string): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  // Date 는 2월 30일 같은 없는 날짜를 다음 달로 넘기므로 되돌려 비교해 거른다.
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  )
    return null;
  // E-UM 시각에는 시간대가 없다. 관측 API 와 같은 설정(기본 +09:00)으로 읽는다.
  const parsed = Date.parse(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ?? timezoneOffset}`,
  );
  return Number.isFinite(parsed) ? parsed : null;
}

/** E-UM 응답 본문 `{ status, data: { dateTime, uvIndex } }` 을 읽는다. 확인할 수 없으면 null. */
export function readUvIndex(
  payload: unknown,
  timezoneOffset: string,
  fetchedAt: string,
): UvReading | null {
  if (!object(payload) || payload.status !== 'success' || !object(payload.data)) return null;
  const raw = payload.data.uvIndex;
  const uvIndex =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(uvIndex) || uvIndex < 0 || uvIndex > MAX_UV_INDEX) return null;
  const observedAt = readObservedAt(payload.data.dateTime, timezoneOffset);
  // 시각을 밝힐 수 없거나 조회 시각보다 미래인 값은 조언 근거로 쓰지 않는다 (시계 차이 5분 허용).
  // 멈춘 센서의 옛 값도 쓰지 않는다. 갱신 주기를 아직 확인하지 못해 1시간까지 받는다.
  const fetched = Date.parse(fetchedAt);
  if (
    observedAt === null ||
    observedAt > fetched + 5 * 60 * 1000 ||
    observedAt < fetched - UV_MAX_AGE_MS
  )
    return null;
  return {
    uvIndex,
    observedAt: new Date(observedAt).toISOString(),
    stage: uvStage(uvIndex),
    fetchedAt,
  };
}

/** 10분 캐시. 동시에 여러 번 불러도 E-UM 요청은 하나만 나간다. 실패하면 던지지 않고 null. */
export function createUvIndexSource(
  config: Pick<BridgeConfig, 'eumServiceKey' | 'timezoneOffset'>,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): UvIndexSource {
  let cache: { until: number; value: UvReading | null } | null = null;
  let pending: Promise<UvReading | null> | null = null;

  async function load(): Promise<UvReading | null> {
    if (!config.eumServiceKey) return null;
    // 키는 설정에서 한 번 풀어 두었고 여기서 URLSearchParams 가 한 번만 인코딩한다 (eum.ts 와 같다).
    const url = new URL(UV_URL);
    url.searchParams.set('serviceKey', config.eumServiceKey);
    try {
      const response = await fetcher(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) return null;
      return readUvIndex(
        await response.json(),
        config.timezoneOffset,
        new Date(now()).toISOString(),
      );
    } catch {
      // 오류 내용에는 URL(키)이 섞일 수 있어 남기지 않는다.
      return null;
    }
  }

  return () => {
    if (cache && now() < cache.until) return Promise.resolve(cache.value);
    pending ??= load().then((value) => {
      cache = { value, until: now() + (value ? CACHE_MS : FAILURE_CACHE_MS) };
      pending = null;
      return value;
    });
    return pending;
  };
}
