import { BridgeError } from './eum.ts';

// 덕장 등록 화면의 주소 ↔ 지도 핀 변환. OpenStreetMap Nominatim 을 서버가 대신 부른다.
// 이용 정책(https://operations.osmfoundation.org/policies/nominatim/): 초당 1회 이하, 앱을 알리는
// User-Agent, 글자를 칠 때마다 부르는 자동완성 금지, 결과 캐시. 그래서 서버 한 곳에서 줄을 세우고 캐시한다.
// 한국은 OSM 에 건물 번호가 거의 없어 도로·마을까지만 찾는다. 정확한 위치는 사용자가 핀으로 맞춘다.

export type GeocodeHit = { latitude: number; longitude: number; label: string };
export type Geocoder = {
  search: (query: string, signal?: AbortSignal) => Promise<GeocodeHit[]>;
  reverse: (latitude: number, longitude: number, signal?: AbortSignal) => Promise<string | null>;
};

const BASE = 'https://nominatim.openstreetmap.org';
// 구룡포 주변 결과를 먼저 보여 준다 (bounded 를 켜지 않아 밖의 주소도 찾는다). 왼쪽,위,오른쪽,아래
const VIEWBOX = '129.30,36.15,129.65,35.85';
const MIN_INTERVAL_MS = 1100;
const MAX_WAITING = 20;
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_SIZE = 500;
const TIMEOUT_MS = 8000;

type Address = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Nominatim 주소 조각을 한국식 순서로 잇는다. 예: 경상북도 포항시 남구 구룡포읍 호미로 */
export function koreanAddress(address: unknown): string {
  if (typeof address !== 'object' || address === null) return '';
  const a = address as Address;
  const parts = [
    text(a.province) ?? text(a.state),
    text(a.city),
    text(a.borough) ?? text(a.county),
    text(a.town) ?? text(a.village) ?? text(a.suburb),
    text(a.road) ?? text(a.hamlet) ?? text(a.quarter),
    text(a.house_number),
  ].filter((part): part is string => part !== null);
  return parts.filter((part, index) => part !== parts[index - 1]).join(' ');
}

function unavailable(): never {
  throw new BridgeError(
    502,
    'GEOCODER_UNAVAILABLE',
    '주소 검색 서비스에 연결하지 못했어요. 지도에서 직접 위치를 선택해 주세요.',
  );
}

function untilAborted(signal: AbortSignal): Promise<never> {
  const stopped = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  stopped.catch(() => undefined);
  return stopped;
}

export function createGeocoder(
  userAgent: () => string,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Geocoder {
  const cache = new Map<string, { until: number; value: unknown }>();
  let queue: Promise<unknown> = Promise.resolve();
  let waiting = 0;
  let last = -Infinity;

  async function call(path: string, params: Record<string, string>, signal?: AbortSignal) {
    const url = new URL(`${BASE}${path}`);
    for (const [name, value] of Object.entries({
      ...params,
      format: 'jsonv2',
      'accept-language': 'ko',
    }))
      url.searchParams.set(name, value);
    const key = url.search;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    if (waiting >= MAX_WAITING)
      throw new BridgeError(
        429,
        'GEOCODER_BUSY',
        '주소 검색 요청이 많아요. 잠시 뒤 다시 시도해 주세요.',
      );
    waiting++;
    // 서버 전체에서 한 줄로 세워 Nominatim 에 1.1초에 한 번만 보낸다.
    const task = queue.then(async () => {
      // 이미 취소된 요청은 차례가 와도 기다리거나 보내지 않고 바로 빠진다 (뒤 사람을 늦추지 않게).
      signal?.throwIfAborted();
      await sleep(Math.max(0, last + MIN_INTERVAL_MS - now()));
      signal?.throwIfAborted();
      last = now();
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
          redirect: 'error',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
            : AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        unavailable();
      }
      if (!response.ok) unavailable();
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        unavailable();
      }
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: now() + CACHE_MS, value });
      return value;
    });
    queue = task.catch(() => undefined);
    try {
      // 취소하면 차례를 기다리지 않고 바로 돌아가 대기 수에서 빠진다.
      return await (signal ? Promise.race([task, untilAborted(signal)]) : task);
    } finally {
      waiting--;
    }
  }

  return {
    async search(query, signal) {
      const value = await call(
        '/search',
        { q: query, countrycodes: 'kr', limit: '3', addressdetails: '1', viewbox: VIEWBOX },
        signal,
      );
      if (!Array.isArray(value)) return [];
      return value.flatMap((row) => {
        if (typeof row !== 'object' || row === null) return [];
        const item = row as Record<string, unknown>;
        const latitude = Number(item.lat);
        const longitude = Number(item.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
        const label = koreanAddress(item.address) || text(item.display_name) || '';
        return label
          ? [
              {
                latitude: Number(latitude.toFixed(6)),
                longitude: Number(longitude.toFixed(6)),
                label,
              },
            ]
          : [];
      });
    },
    async reverse(latitude, longitude, signal) {
      const value = await call(
        '/reverse',
        { lat: latitude.toFixed(6), lon: longitude.toFixed(6), zoom: '18', addressdetails: '1' },
        signal,
      );
      if (typeof value !== 'object' || value === null || 'error' in value) return null;
      return koreanAddress((value as Record<string, unknown>).address) || null;
    },
  };
}

/** 쿼리 문자열을 확인한다. 잘못되면 400. */
export function readGeocodeSearch(params: URLSearchParams): string {
  const query = (params.get('q') ?? '').trim().replace(/\s+/g, ' ');
  if (query.length < 2 || query.length > 200)
    throw new BridgeError(400, 'INVALID_ADDRESS', '찾을 주소를 2~200자로 입력해 주세요.');
  return query;
}

export function readGeocodeReverse(params: URLSearchParams): {
  latitude: number;
  longitude: number;
} {
  const latitude = Number(params.get('lat'));
  const longitude = Number(params.get('lng'));
  if (
    !params.get('lat') ||
    !params.get('lng') ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 85 ||
    Math.abs(longitude) > 180
  )
    throw new BridgeError(400, 'INVALID_LOCATION', '위도·경도가 올바르지 않아요.');
  return { latitude, longitude };
}
