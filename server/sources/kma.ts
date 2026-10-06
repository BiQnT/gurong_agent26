import type { LiveObservation, SiteWeather } from '../../src/lib/live.ts';
import type { BridgeConfig } from '../eum.ts';

export type { SiteWeather };

// 기상청 API허브와 공공데이터포털에서 E-UM 을 보조하는 실시간 자료를 읽는다.
// 호출 기록: research/api-tests/2026-10-06-kma-apihub.md
//
// - A2 AWS 816 구룡포 매분자료: E-UM 관측기가 오래됐거나 이상할 때 대신 쓰는 관측값 (1분 갱신)
// - A3 초단기실황: 지금 비·눈이 오는지 (매시 자료, 약 40분 뒤 나온다)
// - B6 출몰시각: 일출·일몰 (하루 한 번)
// 키는 URL 에만 들어가고 오류 글·로그에는 넣지 않는다. 실패하면 던지지 않고 null 이다.

const AWS_URL = 'https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-aws2_min';
const NOWCAST_URL =
  'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst';
const FORECAST_URL =
  'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtFcst';
const RISESET_URL =
  'https://apis.data.go.kr/B090041/openapi/service/RiseSetInfoService/getLCRiseSetInfo';
// API허브는 대개 0.5~1초에 답하지만 가끔 응답 없이 멈춘다 (2026-10-06 VM 에서 6번 중 1번 10초 초과).
// 한 번에 4초까지만 기다리고 한 번 더 부른다.
const ATTEMPT_TIMEOUT_MS = 4000;
const ATTEMPTS = 2;
/** 관측 응답이 기상청을 기다리는 최대 시간. 늦은 결과는 캐시에 남아 다음 조회부터 쓰인다. */
export const KMA_WAIT_MS = 5000;

/** 정해진 시간 안에 끝나지 않으면 null. 원래 작업은 계속된다. */
export async function within<T>(work: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(resolve, ms, null);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 기상청 관측지점 정보(A1)로 확인한 816 구룡포. */
export const AWS_816 = {
  id: 'kma-aws-816',
  name: '기상청 구룡포 AWS',
  address: '경상북도 포항시 남구 구룡포읍 병포리 (기상청 AWS 816)',
  latitude: 35.9831,
  longitude: 129.5475,
  provider: 'kma' as const,
};

const PRECIPITATION: Record<string, string> = {
  '0': '없음',
  '1': '비',
  '2': '비/눈',
  '3': '눈',
  '5': '빗방울',
  '6': '빗방울눈날림',
  '7': '눈날림',
};

export type KmaSource = {
  aws: () => Promise<LiveObservation | null>;
  weather: (site: { latitude: number; longitude: number }) => Promise<SiteWeather | null>;
};

/** 기상청 격자 변환(A6, 람베르트 정각원추). 좌표 → 동네예보 격자. */
export function toKmaGrid(latitude: number, longitude: number): { nx: number; ny: number } {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEGRAD = Math.PI / 180;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + latitude * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = longitude * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

/** KST 시각 문자열 `YYYYMMDDHHMI` 를 ISO 로. */
function kstIso(stamp: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+09:00`);
  if (!Number.isFinite(parsed)) return null;
  // 2월 30일처럼 없는 날짜가 다음 달로 넘어가지 않게, 되돌린 값이 원문과 같은지 본다.
  const back = new Date(parsed + 9 * 60 * 60 * 1000).toISOString();
  if (back.slice(0, 16).replace(/\D/g, '') !== stamp) return null;
  return new Date(parsed).toISOString();
}

/** KST 기준 날짜·시각 조각. */
function kstParts(time: number) {
  const kst = new Date(time + 9 * 60 * 60 * 1000).toISOString();
  return {
    date: kst.slice(0, 10).replaceAll('-', ''),
    hour: kst.slice(11, 13),
    minute: kst.slice(14, 16),
  };
}

/** -50 이하는 관측이 없거나 오류다 (응답 머리말의 설명). */
function measured(value: string | undefined, min = -50, max = Infinity): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > min && number <= max ? number : null;
}

/** AWS 매분자료(A2) 응답에서 마지막 관측 줄을 읽는다. */
export function readAwsMinute(
  body: string,
  now: number,
  staleAfterMinutes: number,
): { observation: LiveObservation; rain: SiteWeather['rain'] } | null {
  // YYMMDDHHMI STN WD1 WS1 WDS WSS WD10 WS10 TA RE RN-15m RN-60m RN-12H RN-DAY HM PA PS TD
  const rows = body
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row && !row.startsWith('#'))
    .map((row) => row.split(/\s+/))
    .filter((column) => column.length >= 15 && column[1] === '816');
  // 최근 몇 분을 받아 기온·습도가 있는 마지막 줄을 쓴다 (마지막 분이 비어 있을 수 있다).
  const column =
    rows.findLast(
      (row) => measured(row[8], -50, 60) !== null && measured(row[14], -1, 100) !== null,
    ) ?? rows.at(-1);
  if (!column) return null;
  const observedAt = kstIso(column[0]);
  const temperature = measured(column[8], -50, 60);
  const humidity = measured(column[14], -1, 100);
  const windSpeed = measured(column[7], -1, 100);
  const parsed = observedAt ? Date.parse(observedAt) : NaN;
  const ageMinutes =
    Number.isFinite(parsed) && parsed <= now + 60_000
      ? Math.max(0, Math.floor((now - parsed) / 60000))
      : null;
  const missing = temperature === null || humidity === null || windSpeed === null;
  const issues: string[] = [];
  if (missing) issues.push('기상청 AWS 의 필수 관측값(기온·습도·풍속) 중 빠진 값이 있어요.');
  if (!observedAt) issues.push('기상청 AWS 관측 시각을 확인할 수 없어요.');
  else if (ageMinutes === null) issues.push('기상청 AWS 관측 시각이 조회 시각보다 미래예요.');
  const status: LiveObservation['status'] =
    !observedAt || ageMinutes === null || missing
      ? 'invalid'
      : ageMinutes > staleAfterMinutes
        ? 'stale'
        : 'current';
  if (status === 'stale') issues.push(`기상청 AWS 의 마지막 관측이 ${ageMinutes}분 전이에요.`);
  return {
    observation: {
      device: { ...AWS_816 },
      temperature,
      humidity,
      windSpeed,
      observedAt,
      observedAtRaw: column[0],
      ageMinutes,
      status,
      issues,
    },
    rain: observedAt
      ? { last60mMm: measured(column[11]), todayMm: measured(column[13]), observedAt }
      : null,
  };
}

/** 초단기실황(A3) JSON 에서 강수형태와 1시간 강수량을 읽는다. */
export function readNowcast(payload: unknown): SiteWeather['precipitation'] {
  const items = (payload as { response?: { body?: { items?: { item?: unknown } } } })?.response
    ?.body?.items?.item;
  if (!Array.isArray(items)) return null;
  const value = (category: string) =>
    (items as Record<string, unknown>[]).find((item) => item.category === category);
  const pty = value('PTY');
  if (!pty || typeof pty.obsrValue !== 'string' || !(pty.obsrValue in PRECIPITATION)) return null;
  const observedAt = kstIso(`${String(pty.baseDate)}${String(pty.baseTime)}`);
  if (!observedAt) return null;
  const rain = Number(value('RN1')?.obsrValue);
  return {
    type: PRECIPITATION[pty.obsrValue],
    rain1hMm: Number.isFinite(rain) && rain >= 0 ? rain : null,
    observedAt,
  };
}

/** 초단기예보(A4) JSON 에서 지금 시각 이후 6시간을 읽는다. 예보라서 등급에는 쓰지 않는다. */
export function readUltraForecast(payload: unknown, now: number): SiteWeather['forecast'] {
  const items = (payload as { response?: { body?: { items?: { item?: unknown } } } })?.response
    ?.body?.items?.item;
  if (!Array.isArray(items) || !items.length) return null;
  const rows = items as Record<string, unknown>[];
  const issuedAt = kstIso(`${String(rows[0].baseDate)}${String(rows[0].baseTime)}`);
  if (!issuedAt) return null;
  const byTime = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const key = `${String(row.fcstDate)}${String(row.fcstTime)}`;
    if (typeof row.category !== 'string' || typeof row.fcstValue !== 'string') continue;
    byTime.set(key, { ...byTime.get(key), [row.category]: row.fcstValue });
  }
  const number = (value: string | undefined) => {
    const parsed = Number(value);
    return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null;
  };
  const hourStart = now - (now % (60 * 60_000));
  const hours = [...byTime.entries()]
    .map(([key, values]) => ({ at: kstIso(key), values }))
    .filter((entry): entry is { at: string; values: Record<string, string> } => entry.at !== null)
    .filter((entry) => Date.parse(entry.at) >= hourStart)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, 6)
    .map(({ at, values }) => {
      const humidity = number(values.REH);
      const wind = number(values.WSD);
      return {
        at,
        temperature: number(values.T1H),
        humidity: humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null,
        windSpeed: wind !== null && wind >= 0 ? wind : null,
        precipitation: PRECIPITATION[values.PTY ?? ''] ?? '알 수 없음',
        rain: values.RN1 && values.RN1 !== '강수없음' ? values.RN1 : null,
      };
    });
  return hours.length ? { issuedAt, hours } : null;
}

/** 출몰시각(B6) XML 에서 일출·일몰을 `HH:MM` 으로 읽는다. */
export function readRiseSet(xml: string): SiteWeather['sun'] {
  const field = (name: string) => new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(xml)?.[1];
  const clock = (value: string | undefined) =>
    value && /^\d{4}$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : null;
  const date = field('locdate');
  const sunrise = clock(field('sunrise'));
  const sunset = clock(field('sunset'));
  if (!date || !/^\d{8}$/.test(date) || !sunrise || !sunset) return null;
  return { date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`, sunrise, sunset };
}

/** 공공데이터포털 키는 인코딩된 값(Encoding)이면 한 번 풀어 둔다. URLSearchParams 가 다시 한 번 인코딩한다. */
function plainKey(key: string): string {
  if (!key.includes('%')) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

export function createKmaSource(
  config: Pick<BridgeConfig, 'kmaAuthKey' | 'dataGoKrKey' | 'staleAfterMinutes'>,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): KmaSource | null {
  const kmaKey = config.kmaAuthKey ? plainKey(config.kmaAuthKey) : '';
  const dataKey = config.dataGoKrKey ? plainKey(config.dataGoKrKey) : '';
  if (!kmaKey) return null;
  const cache = new Map<string, { until: number; value: Promise<unknown> }>();

  /** 같은 열쇠로 동시에 부르면 한 번만 보내고, 성공·실패 모두 정해진 시간 동안 기억한다. */
  function cached<T>(
    key: string,
    ttlMs: number,
    failTtlMs: number,
    load: () => Promise<T | null>,
  ): Promise<T | null> {
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value as Promise<T | null>;
    const entry: { until: number; value: Promise<unknown> } = {
      until: now() + ttlMs,
      value: Promise.resolve(null),
    };
    entry.value = load().then(
      (value) => {
        if (value === null) entry.until = now() + failTtlMs;
        return value;
      },
      () => {
        entry.until = now() + failTtlMs;
        return null;
      },
    );
    if (cache.size > 200) cache.clear();
    cache.set(key, entry);
    return entry.value as Promise<T | null>;
  }

  async function get(url: URL): Promise<string | null> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const response = await fetcher(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        });
        // HTTP 오류(권한 없음 등)는 다시 불러도 같으므로 바로 끝낸다.
        if (!response.ok) return null;
        return await response.text();
      } catch {
        // 연결이 멈추거나 끊긴 경우만 다시 부른다. 오류 글에 키가 든 URL 이 섞일 수 있어 넘기지 않는다.
      }
    }
    return null;
  }

  const awsMinute = () =>
    cached('aws', 60_000, 30_000, async () => {
      // 방금 분은 아직 안 들어왔을 수 있어 최근 10분(1분 전까지)을 받아 마지막 정상 줄을 쓴다.
      const from = kstParts(now() - 10 * 60_000);
      const to = kstParts(now() - 60_000);
      const url = new URL(AWS_URL);
      url.searchParams.set('tm1', `${from.date}${from.hour}${from.minute}`);
      url.searchParams.set('tm2', `${to.date}${to.hour}${to.minute}`);
      url.searchParams.set('stn', '816');
      url.searchParams.set('disp', '0');
      url.searchParams.set('help', '0');
      url.searchParams.set('authKey', kmaKey);
      const body = await get(url);
      return body ? readAwsMinute(body, now(), config.staleAfterMinutes) : null;
    });

  return {
    async aws() {
      return (await awsMinute())?.observation ?? null;
    },
    async weather(site) {
      const { nx, ny } = toKmaGrid(site.latitude, site.longitude);
      // 매시 자료가 약 40분 뒤 나오므로 45분 전 시각의 정시를 묻는다.
      const base = kstParts(now() - 45 * 60_000);
      const today = kstParts(now()).date;
      // 초단기예보는 매시 30분 자료가 약 45분 뒤 나오므로 50분 전 시각의 30분을 묻는다.
      const issue = kstParts(now() - 50 * 60_000);
      const [precipitation, aws, sun, forecast] = await Promise.all([
        cached(`ncst:${nx},${ny}:${base.date}${base.hour}`, 10 * 60_000, 60_000, async () => {
          const url = new URL(NOWCAST_URL);
          for (const [name, value] of Object.entries({
            pageNo: '1',
            numOfRows: '20',
            dataType: 'JSON',
            base_date: base.date,
            base_time: `${base.hour}00`,
            nx: String(nx),
            ny: String(ny),
            authKey: kmaKey,
          }))
            url.searchParams.set(name, value);
          const body = await get(url);
          if (!body) return null;
          try {
            return readNowcast(JSON.parse(body));
          } catch {
            return null;
          }
        }),
        awsMinute(),
        dataKey
          ? cached(
              `sun:${today}:${site.latitude.toFixed(2)},${site.longitude.toFixed(2)}`,
              24 * 60 * 60_000,
              10 * 60_000,
              async () => {
                const url = new URL(RISESET_URL);
                url.searchParams.set('serviceKey', dataKey);
                url.searchParams.set('locdate', today);
                url.searchParams.set('longitude', site.longitude.toFixed(4));
                url.searchParams.set('latitude', site.latitude.toFixed(4));
                url.searchParams.set('dnYn', 'Y');
                const body = await get(url);
                return body ? readRiseSet(body) : null;
              },
            )
          : Promise.resolve(null),
        cached(`fcst:${nx},${ny}:${issue.date}${issue.hour}`, 10 * 60_000, 60_000, async () => {
          const url = new URL(FORECAST_URL);
          for (const [name, value] of Object.entries({
            pageNo: '1',
            numOfRows: '60',
            dataType: 'JSON',
            base_date: issue.date,
            base_time: `${issue.hour}30`,
            nx: String(nx),
            ny: String(ny),
            authKey: kmaKey,
          }))
            url.searchParams.set(name, value);
          const body = await get(url);
          if (!body) return null;
          try {
            return readUltraForecast(JSON.parse(body), now());
          } catch {
            return null;
          }
        }),
      ]);
      if (!precipitation && !aws?.rain && !sun && !forecast) return null;
      return { precipitation, rain: aws?.rain ?? null, sun, forecast };
    },
  };
}
