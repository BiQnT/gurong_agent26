import { kstMidnight, type HistorySample, type ShortForecast } from '../../src/lib/analysis.ts';
import type { WeatherHistory, WeatherHistorySource } from '../agent-tools.ts';
import type { BridgeConfig } from '../eum.ts';
import {
  AWS_816,
  kstIso,
  kstParts,
  plainKey,
  PRECIPITATION,
  readAwsRows,
  toKmaGrid,
} from './kma.ts';

// 기상청 API허브의 과거 관측(AWS 816 구룡포)과 단기예보(3일)를 AI 도구에 준다 (ADR 0011).
// 호출 기록: research/api-tests/2026-10-09-kma-history.md
//
// 과거: AWS 매분자료를 하루치 통째로 받으면 23~30초가 걸리고, 여러 날을 함께 부르면 30초에서 잘린다.
// 정각 1분만 부르면 보통 0.3~0.5초라, 기간에 맞춰 1·3·6·12시간마다 정각 값을 받아 시간자료처럼 쓴다.
// API허브는 가끔 몇 초씩 멈추므로 정해진 시간 안에 받은 만큼만 쓰고, 못 받은 시각 수를 따로 알린다.
// 지난 시각의 값은 바뀌지 않으므로 받은 값은 기억해 둔다.

const AWS_URL = 'https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-aws2_min';
const VILAGE_URL =
  'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst';
const ATTEMPT_TIMEOUT_MS = 4000;
/** 동시에 보내는 요청 수 (6개로 하루 24번이 1.6초, 2026-10-09 확인) */
const CONCURRENCY = 10;
/** 과거 조회 한 번에 쓰는 최대 시간. 넘으면 받은 만큼만 쓰고 나머지는 결측으로 남긴다 */
const BUDGET_MS = 25_000;
/** 기억해 둘 시각 수 (하루 24개 기준 약 1년) */
const CACHE_LIMIT = 9000;
/** 정각 자료가 들어오기까지 기다리는 여유 */
const SETTLE_MS = 70 * 60_000;

/** 기간 길이에 맞춘 표본 간격(시간). 길수록 성기게 받아 호출 수를 줄인다. */
export function sampleStepHours(days: number): number {
  return days <= 7 ? 1 : days <= 31 ? 3 : days <= 62 ? 6 : 12;
}

/** 기간 안의 정각 시각들 (KST `YYYYMMDDHH00`). 아직 자료가 안 들어왔을 시각은 뺀다. */
export function hourlyStamps(
  range: { from: string; to: string },
  stepHours: number,
  now: number,
): string[] {
  const start = kstMidnight(range.from);
  const end = Math.min(kstMidnight(range.to) + 86_400_000, now - SETTLE_MS);
  const stamps: string[] = [];
  for (let time = start; time < end; time += stepHours * 3_600_000) {
    const { date, hour, minute } = kstParts(time);
    stamps.push(`${date}${hour}${minute}`);
  }
  return stamps;
}

type Fetched = { ok: true; body: string } | { ok: false };

/**
 * 한 번 더 불러 볼 수 있는 실패(멈춤·끊김·5xx·429)와 확실한 실패를 가르지 않고 모두 { ok: false } 로 돌려준다.
 * 호출한 쪽은 이것을 "못 받음"으로, 200 인데 줄이 없는 것은 "자료 없음"으로 센다.
 */
async function fetchText(fetcher: typeof fetch, url: URL, signal: AbortSignal): Promise<Fetched> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (signal.aborted) return { ok: false };
    try {
      const response = await fetcher(url, {
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
      });
      // 5xx·429 는 잠시 뒤 나아질 수 있어 한 번 더 부르고, 권한 없음 같은 4xx 는 바로 끝낸다.
      if (response.status >= 500 || response.status === 429) continue;
      if (!response.ok) return { ok: false };
      return { ok: true, body: await response.text() };
    } catch {
      // 멈추거나 끊긴 경우만 한 번 더 부른다. 오류 글에 키가 든 URL 이 섞일 수 있어 넘기지 않는다.
    }
  }
  return { ok: false };
}

/** 구룡포 AWS 816 과거 관측. 키가 없으면 undefined (그때 과거 분석은 배치 기록만 쓴다). */
export function createKmaHistory(
  config: Pick<BridgeConfig, 'kmaAuthKey'>,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): WeatherHistorySource | undefined {
  const key = config.kmaAuthKey ? plainKey(config.kmaAuthKey) : '';
  if (!key) return undefined;
  const cache = new Map<string, HistorySample>();
  const remember = (stamp: string, sample: HistorySample) => {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(stamp, sample);
  };
  // 기간 비교처럼 조회가 겹쳐도 API허브에 동시에 보내는 요청은 서버 전체에서 CONCURRENCY 개까지다.
  let active = 0;
  const waiting: (() => void)[] = [];
  async function limited<T>(work: () => Promise<T>): Promise<T> {
    if (active >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  }

  /** 정각 한 시각의 관측. 받았으면 표본, 200 인데 줄이 없으면 'empty', 못 받았으면 'failed'. */
  async function sampleAt(
    stamp: string,
    stepHours: number,
    signal: AbortSignal,
  ): Promise<HistorySample | 'empty' | 'failed'> {
    const hit = cache.get(stamp);
    if (hit) return stepHours === 1 ? hit : { ...hit, rainMm: null };
    const url = new URL(AWS_URL);
    for (const [name, value] of Object.entries({
      tm1: stamp,
      tm2: stamp,
      stn: '816',
      disp: '0',
      help: '0',
      authKey: key,
    }))
      url.searchParams.set(name, value);
    const fetched = await limited(() => fetchText(fetcher, url, signal));
    if (!fetched.ok) return 'failed';
    const row = readAwsRows(fetched.body)[0];
    if (!row) return 'empty';
    // RN-60m 은 그 정각까지 1시간 강수량이다. 1시간 간격일 때만 그 시간의 강수로 쓴다.
    const sample: HistorySample = {
      at: row.at,
      temperature: row.temperature,
      humidity: row.humidity,
      windSpeed: row.windSpeed,
      rainMm: row.rain60mMm,
    };
    remember(stamp, sample);
    return stepHours === 1 ? sample : { ...sample, rainMm: null };
  }

  return async (range, signal): Promise<WeatherHistory | null> => {
    const days = Math.round((kstMidnight(range.to) - kstMidnight(range.from)) / 86_400_000) + 1;
    const stepHours = sampleStepHours(days);
    const at = now();
    const stamps = hourlyStamps(range, stepHours, at);
    const budget = AbortSignal.any([signal, AbortSignal.timeout(BUDGET_MS)]);
    const samples: HistorySample[] = [];
    let next = 0;
    let unfetched = 0;
    const worker = async () => {
      while (next < stamps.length && !budget.aborted) {
        const sample = await sampleAt(stamps[next++], stepHours, budget);
        // 못 받은 것(멈춤·오류·시간 초과)은 자료가 없는 것과 다르다. 기억하지 않아 다시 물으면 다시 받는다.
        if (sample === 'failed') unfetched += 1;
        else if (sample !== 'empty') samples.push(sample);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stamps.length) }, worker));
    unfetched += stamps.length - next;
    if (!samples.length) return null;
    return {
      samples,
      requested: stamps.length,
      unfetched,
      // 간격은 출처 이름에 넣지 않는다 (간격만 다른 두 기간을 "출처가 다르다"며 비교하지 못하게 된다).
      source: '기상청 구룡포 AWS 관측',
      station: AWS_816.name,
      latitude: AWS_816.latitude,
      longitude: AWS_816.longitude,
      sampleMinutes: stepHours * 60,
      // 아직 들어오지 않은 최근 시각은 결측으로 세지 않게, 자료가 있는 마지막 시각을 알린다.
      until: at - SETTLE_MS,
    };
  };
}

/** 단기예보(getVilageFcst) JSON 을 시간별로 읽는다. 지금 이후 시각만 남긴다. */
export function readVilageForecast(payload: unknown, now: number): ShortForecast | null {
  const items = (payload as { response?: { body?: { items?: { item?: unknown } } } })?.response
    ?.body?.items?.item;
  if (!Array.isArray(items) || !items.length) return null;
  const rows = items as Record<string, unknown>[];
  const issuedAt = kstIso(`${String(rows[0].baseDate)}${String(rows[0].baseTime)}`);
  if (!issuedAt) return null;
  const byTime = new Map<string, Record<string, string>>();
  for (const row of rows) {
    if (typeof row.category !== 'string' || typeof row.fcstValue !== 'string') continue;
    const key = `${String(row.fcstDate)}${String(row.fcstTime)}`;
    byTime.set(key, { ...byTime.get(key), [row.category]: row.fcstValue });
  }
  const number = (value: string | undefined, min: number, max: number) => {
    const parsed = Number(value);
    return value !== undefined &&
      value !== '' &&
      Number.isFinite(parsed) &&
      parsed >= min &&
      parsed <= max
      ? parsed
      : null;
  };
  const hourStart = now - (now % 3_600_000);
  // 발표일·다음 날·모레까지만 1시간 간격이고 풍속이 숫자다. 글피부터는 3시간 간격에 풍속이 부호로 와서
  // (2024-11-28 기상청 개편) 같은 규칙으로 읽을 수 없으므로 쓰지 않는다.
  const baseDay = Date.parse(
    `${String(rows[0].baseDate).slice(0, 4)}-${String(rows[0].baseDate).slice(4, 6)}-${String(rows[0].baseDate).slice(6, 8)}T00:00:00+09:00`,
  );
  const lastHour = baseDay + 3 * 86_400_000;
  const ordered = [...byTime.entries()]
    .map(([key, values]) => ({ at: kstIso(key), values }))
    .filter((entry): entry is { at: string; values: Record<string, string> } => entry.at !== null)
    .filter((entry) => Date.parse(entry.at) >= hourStart && Date.parse(entry.at) < lastHour)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // 혹시 1시간보다 벌어진 곳이 있으면 거기서 끊는다.
  const gap = ordered.findIndex(
    (entry, index) =>
      index > 0 && Date.parse(entry.at) - Date.parse(ordered[index - 1].at) > 3_600_000,
  );
  const hours = (gap === -1 ? ordered : ordered.slice(0, gap)).map(({ at, values }) => ({
    at,
    temperature: number(values.TMP, -50, 60),
    humidity: number(values.REH, 0, 100),
    windSpeed: number(values.WSD, 0, 100),
    precipitation: PRECIPITATION[values.PTY ?? ''] ?? '알 수 없음',
    pop: number(values.POP, 0, 100),
  }));
  return hours.length ? { issuedAt, hours } : null;
}

/** 단기예보 발표 시각(02·05·…·23시). 발표 뒤 10분쯤 지나야 나오므로 20분 여유를 둔다. */
export function vilageBase(now: number): { date: string; time: string } {
  const settled = now - 20 * 60_000;
  const { hour } = kstParts(settled);
  const base = [2, 5, 8, 11, 14, 17, 20, 23].filter((h) => h <= Number(hour)).at(-1);
  // 02시 발표 전(0~2시)이면 전날 23시 발표를 쓴다.
  const day = base === undefined ? kstParts(settled - 3 * 3_600_000).date : kstParts(settled).date;
  return { date: day, time: `${String(base ?? 23).padStart(2, '0')}00` };
}

/** 덕장 격자의 단기예보(약 3일). 키가 없으면 undefined. 발표마다 한 번만 부른다. */
export function createKmaShortForecast(
  config: Pick<BridgeConfig, 'kmaAuthKey'>,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): ((site: { latitude: number; longitude: number }) => Promise<ShortForecast | null>) | undefined {
  const key = config.kmaAuthKey ? plainKey(config.kmaAuthKey) : '';
  if (!key) return undefined;
  const cache = new Map<string, { until: number; value: Promise<ShortForecast | null> }>();
  return (site) => {
    const { nx, ny } = toKmaGrid(site.latitude, site.longitude);
    const base = vilageBase(now());
    const cacheKey = `${nx},${ny}:${base.date}${base.time}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.until > now()) return hit.value;
    const url = new URL(VILAGE_URL);
    for (const [name, value] of Object.entries({
      pageNo: '1',
      numOfRows: '1000',
      dataType: 'JSON',
      base_date: base.date,
      base_time: base.time,
      nx: String(nx),
      ny: String(ny),
      authKey: key,
    }))
      url.searchParams.set(name, value);
    const read = async (target: URL) => {
      const fetched = await fetchText(fetcher, target, AbortSignal.timeout(10_000));
      if (!fetched.ok) return null;
      try {
        return readVilageForecast(JSON.parse(fetched.body), now());
      } catch {
        return null;
      }
    };
    // 발표가 늦게 올라오면 직전 발표(3시간 전)를 쓴다.
    const value = read(url).then(async (result) => {
      if (result) return result;
      const previous = vilageBase(now() - 3 * 3_600_000);
      const fallback = new URL(url);
      fallback.searchParams.set('base_date', previous.date);
      fallback.searchParams.set('base_time', previous.time);
      return read(fallback);
    });
    // 성공은 30분, 실패는 2분 기억한다.
    const entry = { until: now() + 30 * 60_000, value };
    value.then((result) => {
      if (!result) entry.until = now() + 2 * 60_000;
    });
    if (cache.size > 50) cache.clear();
    cache.set(cacheKey, entry);
    return value;
  };
}
