import {
  DRYING_THRESHOLDS,
  gradeConditions,
  implausibleReading,
  kst,
  type DryingGrade,
  type DryingThresholds,
} from './drying.ts';
import type { SiteWeather } from './live.ts';

// AI 도구(server/agent-tools.ts)가 돌려주고 채팅 카드가 그리는 분석 결과. 숫자는 모두 여기서 계산한다.
// AI 는 이 결과를 고르고 설명만 한다 (ADR 0011). 등급은 drying.ts 의 같은 규칙 함수로 매긴다.

export type Stat = { mean: number | null; min: number | null; max: number | null };
export type GradeCounts = { 적합: number; 주의: number; 부적합: number; 제외: number };
type Rated = Exclude<DryingGrade, '판정 불가'>;

/** 과거 관측 한 점. 시간자료면 그 시간, 배치 표본이면 그 30분을 대표한다. */
export type HistorySample = {
  at: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  /** 그 구간의 강수량(mm). 자료에 강수가 없으면 null */
  rainMm: number | null;
  /** 비·눈 여부를 따로 아는 경우 (예보의 강수형태). 없으면 rainMm 으로 본다 */
  raining?: boolean;
};

export type HistoryRow = {
  /** 일 단위면 `MM.DD`, 주 단위면 `MM.DD~MM.DD` (KST) */
  label: string;
  from: string;
  to: string;
  samples: number;
  temperature: Stat;
  humidity: Stat;
  windSpeed: Stat;
  rainMm: number | null;
  /** 등급별 시간 (표본 수 × 표본 간격). 제외는 값이 비었거나 판정 기준 밖인 시간 */
  gradeHours: GradeCounts;
  /** 이 칸에서 자료가 있어야 하는 시간 (마지막 주가 짧거나 오늘이면 지금까지) */
  expectedHours: number;
  /** 일 단위일 때 가장 길게 이어진 적합 구간 (예: `13~16시`) */
  bestWindow: string | null;
};

export type HistorySummary = {
  kind: 'history';
  /** 자료 이름 (예: 기상청 구룡포 AWS 시간자료) */
  source: string;
  station: string;
  /** 덕장과 관측 지점 사이 거리. 모르면 null */
  distanceM: number | null;
  /** 조회 기간 (KST 날짜 `YYYY-MM-DD`) */
  from: string;
  to: string;
  resolution: 'day' | 'week';
  sampleMinutes: number;
  expectedSamples: number;
  samples: number;
  /** 값이 다 있는 표본이 기대 표본보다 모자란 비율 (%) */
  missingRate: number;
  rainKnown: boolean;
  rows: HistoryRow[];
  totals: {
    temperature: Stat;
    humidity: Stat;
    windSpeed: Stat;
    rainMm: number | null;
    gradeHours: GradeCounts;
    /** 판정한 시간 중 등급별 비율 (%, 제외 시간은 뺀다) */
    percentages: Record<Rated, number>;
  };
  thresholds: string;
  /** 코드가 만든 한 문단 요약. AI 답이 검사에 걸리면 이 문장을 대신 보여 준다 */
  summary: string;
};

/** 기상청 단기예보(3일) 한 시간 (server/sources/kma-history.ts 가 읽는다). */
export type ShortForecastHour = {
  at: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  precipitation: string;
  /** 강수확률(%) */
  pop: number | null;
};
export type ShortForecast = { issuedAt: string; hours: ShortForecastHour[] };

/** 단기예보를 날짜별로 묶은 예상 (KST). */
export type ForecastDay = {
  date: string;
  label: string;
  /** 예보 시간 중 등급별 시간 수 (예상) */
  gradeHours: GradeCounts;
  /** 그날 예보가 있는 시간 수 */
  hours: number;
  bestWindow: string | null;
  temperature: Stat;
  humidity: Stat;
  windSpeed: Stat;
  maxPop: number | null;
  /** 비·눈 예보가 있는 시간 수 */
  precipitationHours: number;
};

export type ForecastOutlook = {
  kind: 'forecast';
  source: string;
  issuedAt: string;
  /** 단기예보(3일)를 날짜별로 묶은 예상. 단기예보를 받지 못했으면 없다 */
  days?: ForecastDay[];
  /** 단기예보 발표 시각 */
  daysIssuedAt?: string;
  hours: {
    at: string;
    temperature: number | null;
    humidity: number | null;
    windSpeed: number | null;
    precipitation: string;
    /** 예보값에 같은 규칙 함수를 적용한 예상 등급 (현재 판정이 아니다) */
    expectedGrade: DryingGrade;
  }[];
  thresholds: string;
  summary: string;
};

/** 배치 하나의 기록 요약 (server/assessment.ts 가 만든다). */
export type BatchDigest = {
  kind: 'batch';
  name: string;
  status: '진행 중' | '종료' | '취소';
  fish: string;
  quantity: number;
  startedAt: string;
  endedAt: string | null;
  /** 시작부터 종료(진행 중이면 지금)까지 시간 */
  elapsedHours: number;
  samples: number;
  missingRate: number | null;
  temperature: Stat;
  humidity: Stat;
  windSpeed: Stat;
  /** 표본을 지금 기준으로 다시 매긴 등급 비율 (%, 비·눈 제외). 판정한 표본이 없으면 null */
  percentages: Record<Rated, number> | null;
  ratedSamples: number;
  alerts: number;
  firstUnsuitableAt: string | null;
  summary: string;
};

const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const round1 = (value: number) => Math.round(value * 10) / 10;

/** ISO 시각의 KST 날짜 `YYYY-MM-DD`. */
export function kstDate(value: string | number): string {
  const time = typeof value === 'number' ? value : Date.parse(value);
  return new Date(time + KST_MS).toISOString().slice(0, 10);
}
/** KST 날짜 `YYYY-MM-DD` 의 0시(ISO 밀리초). */
export function kstMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00+09:00`);
}
const kstHour = (time: number) => new Date(time + KST_MS).getUTCHours();
const shortDate = (date: string) => `${date.slice(5, 7)}.${date.slice(8, 10)}`;

function stat(values: (number | null)[]): Stat {
  const valid = values.filter(finite);
  if (!valid.length) return { mean: null, min: null, max: null };
  return {
    mean: round1(valid.reduce((sum, value) => sum + value, 0) / valid.length),
    min: Math.min(...valid),
    max: Math.max(...valid),
  };
}

/** 표본 하나의 등급. 값이 비었거나 기준 밖(비정상 습도, 저온)이면 제외. */
export function gradeSample(
  sample: HistorySample,
  t: DryingThresholds = DRYING_THRESHOLDS,
): Rated | '제외' {
  const { temperature, humidity, windSpeed } = sample;
  if (!finite(temperature) || !finite(humidity) || !finite(windSpeed)) return '제외';
  if (implausibleReading(humidity) || temperature < t.minTemperature) return '제외';
  return gradeConditions(
    {
      temperature,
      humidity,
      windSpeed,
      raining: sample.raining ?? (finite(sample.rainMm) && sample.rainMm > 0),
    },
    t,
  ).grade;
}

const emptyCounts = (): GradeCounts => ({ 적합: 0, 주의: 0, 부적합: 0, 제외: 0 });

function hoursOf(counts: GradeCounts, sampleMinutes: number): GradeCounts {
  const scale = sampleMinutes / 60;
  return {
    적합: round1(counts.적합 * scale),
    주의: round1(counts.주의 * scale),
    부적합: round1(counts.부적합 * scale),
    제외: round1(counts.제외 * scale),
  };
}

function rainTotal(samples: HistorySample[]): number | null {
  const values = samples.map((sample) => sample.rainMm).filter(finite);
  return values.length ? round1(values.reduce((sum, value) => sum + value, 0)) : null;
}

/** 하루 표본에서 가장 길게 이어진 적합 구간. 시작~끝(끝 시각 포함 시간까지) `13~16시`. */
function bestWindow(samples: HistorySample[], sampleMinutes: number, t: DryingThresholds) {
  let best: { start: number; end: number } | null = null;
  let run: { start: number; end: number } | null = null;
  const step = sampleMinutes * 60_000;
  for (const sample of samples) {
    const time = Date.parse(sample.at);
    if (gradeSample(sample, t) === '적합') {
      // 관측 시각이 수집 간격보다 조금 늦게 찍혀도(13:00 다음 13:31) 같은 구간으로 본다.
      run =
        run && time - run.end < step * 1.5
          ? { start: run.start, end: time }
          : { start: time, end: time };
      if (!best || run.end - run.start > best.end - best.start) best = { ...run };
    } else run = null;
  }
  if (!best) return null;
  const endHour = kstHour(best.end + step);
  return `${kstHour(best.start)}~${endHour === 0 ? 24 : endHour}시`;
}

/**
 * 과거 표본을 일·주 단위로 묶어 기온·습도·풍속 통계와 규칙 등급 시간을 낸다.
 * 31일까지는 일 단위, 그보다 길면 주 단위다. 기간 밖 표본은 버린다.
 */
export function summarizeHistory(
  input: {
    samples: HistorySample[];
    from: string;
    to: string;
    source: string;
    station: string;
    distanceM: number | null;
    sampleMinutes: number;
    /** 기대 표본을 셀 때 이 시각 이후는 뺀다 (오늘이 포함된 기간) */
    now: number;
  },
  t: DryingThresholds = DRYING_THRESHOLDS,
): HistorySummary {
  const start = kstMidnight(input.from);
  const end = Math.min(kstMidnight(input.to) + DAY_MS, input.now);
  const step = input.sampleMinutes * 60_000;
  // 같은 시각이 두 번 들어오면(배치가 겹친 경우 등) 하나만 쓴다.
  const byTime = new Map<number, HistorySample>();
  for (const sample of input.samples) {
    const time = Date.parse(sample.at);
    if (Number.isFinite(time) && time >= start && time < end && !byTime.has(time))
      byTime.set(time, sample);
  }
  const samples = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, sample]) => sample);
  const days = Math.round((kstMidnight(input.to) - start) / DAY_MS) + 1;
  const resolution: HistorySummary['resolution'] = days > 31 ? 'week' : 'day';
  const binDays = resolution === 'week' ? 7 : 1;
  const rows: HistoryRow[] = [];
  for (
    let binStart = start;
    binStart < kstMidnight(input.to) + DAY_MS;
    binStart += binDays * DAY_MS
  ) {
    const binEnd = Math.min(binStart + binDays * DAY_MS, kstMidnight(input.to) + DAY_MS);
    const inBin = samples.filter((sample) => {
      const time = Date.parse(sample.at);
      return time >= binStart && time < binEnd;
    });
    const counts = emptyCounts();
    for (const sample of inBin) counts[gradeSample(sample, t)] += 1;
    const fromDate = kstDate(binStart);
    const toDate = kstDate(binEnd - 1);
    rows.push({
      label: binDays === 1 ? shortDate(fromDate) : `${shortDate(fromDate)}~${shortDate(toDate)}`,
      from: fromDate,
      to: toDate,
      samples: inBin.length,
      temperature: stat(inBin.map((sample) => sample.temperature)),
      humidity: stat(inBin.map((sample) => sample.humidity)),
      windSpeed: stat(inBin.map((sample) => sample.windSpeed)),
      rainMm: rainTotal(inBin),
      gradeHours: hoursOf(counts, input.sampleMinutes),
      expectedHours: round1(Math.max(0, Math.min(binEnd, end) - binStart) / 3_600_000),
      bestWindow: binDays === 1 ? bestWindow(inBin, input.sampleMinutes, t) : null,
    });
  }
  const counts = emptyCounts();
  for (const sample of samples) counts[gradeSample(sample, t)] += 1;
  const rated = counts.적합 + counts.주의 + counts.부적합;
  const percent = (value: number) => (rated ? Math.round((value / rated) * 100) : 0);
  const expectedSamples = Math.max(0, Math.ceil((end - start) / step));
  const complete = samples.filter(
    (sample) => finite(sample.temperature) && finite(sample.humidity) && finite(sample.windSpeed),
  ).length;
  const missingRate = expectedSamples
    ? round1((Math.max(0, expectedSamples - complete) / expectedSamples) * 100)
    : 100;
  const rainKnown = samples.some((sample) => finite(sample.rainMm));
  const totals = {
    temperature: stat(samples.map((sample) => sample.temperature)),
    humidity: stat(samples.map((sample) => sample.humidity)),
    windSpeed: stat(samples.map((sample) => sample.windSpeed)),
    rainMm: rainTotal(samples),
    gradeHours: hoursOf(counts, input.sampleMinutes),
    percentages: {
      적합: percent(counts.적합),
      주의: percent(counts.주의),
      부적합: percent(counts.부적합),
    },
  };
  // 올해가 아니면 연도를 붙인다 ("작년 12월" 요약이 올해 12월로 읽히지 않게).
  const thisYear = kstDate(input.now).slice(0, 4);
  const withYear = (date: string) =>
    date.slice(0, 4) === thisYear ? shortDate(date) : `${date.slice(0, 4)}.${shortDate(date)}`;
  const period = `${withYear(input.from)}~${withYear(input.to)}`;
  const where = `${input.station}${input.distanceM === null ? '' : `(덕장에서 ${input.distanceM.toLocaleString()}m)`}`;
  const summary = !rated
    ? `${period} ${where}의 ${input.source}에서 판정할 수 있는 표본이 없어요 (기대 ${expectedSamples}개, 결측 ${missingRate}%).`
    : `${period} ${where} ${input.source} ${samples.length}개(결측 ${missingRate}%) 기준, ` +
      `적합 ${totals.gradeHours.적합}시간(${totals.percentages.적합}%) · 주의 ${totals.gradeHours.주의}시간(${totals.percentages.주의}%) · 부적합 ${totals.gradeHours.부적합}시간(${totals.percentages.부적합}%). ` +
      `평균 기온 ${totals.temperature.mean}°C, 평균 습도 ${totals.humidity.mean}%, 평균 풍속 ${totals.windSpeed.mean}m/s` +
      (rainKnown
        ? `, 강수 ${totals.rainMm ?? 0}mm.`
        : '. 강수 자료가 없어 비·눈은 등급에서 뺐어요.');
  return {
    kind: 'history',
    source: input.source,
    station: input.station,
    distanceM: input.distanceM,
    from: input.from,
    to: input.to,
    resolution,
    sampleMinutes: input.sampleMinutes,
    expectedSamples,
    samples: samples.length,
    missingRate,
    rainKnown,
    rows,
    totals,
    thresholds: t.version,
    summary,
  };
}

type ForecastHour = {
  at: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  precipitation: string;
};

/** 예보 한 시간에 같은 규칙 함수로 예상 등급을 매긴다. 값이 빠졌거나 저온이면 판정 불가. */
function expectedGrade(hour: ForecastHour, t: DryingThresholds): DryingGrade {
  const known =
    finite(hour.temperature) &&
    finite(hour.humidity) &&
    finite(hour.windSpeed) &&
    hour.precipitation !== '알 수 없음' &&
    hour.temperature >= t.minTemperature;
  return known
    ? gradeConditions(
        {
          temperature: hour.temperature as number,
          humidity: hour.humidity as number,
          windSpeed: hour.windSpeed as number,
          raining: hour.precipitation !== '없음',
        },
        t,
      ).grade
    : '판정 불가';
}

/** 단기예보를 KST 날짜별로 묶는다: 예상 등급 시간, 가장 긴 적합 구간, 기온·습도·풍속, 강수확률. */
export function forecastDays(
  short: ShortForecast,
  t: DryingThresholds = DRYING_THRESHOLDS,
): ForecastDay[] {
  const byDate = new Map<string, ShortForecastHour[]>();
  for (const hour of short.hours) {
    const date = kstDate(hour.at);
    byDate.set(date, [...(byDate.get(date) ?? []), hour]);
  }
  return [...byDate.entries()].map(([date, hours]) => {
    const counts = emptyCounts();
    for (const hour of hours) {
      const grade = expectedGrade(hour, t);
      counts[grade === '판정 불가' ? '제외' : grade] += 1;
    }
    const samples: HistorySample[] = hours.map((hour) => ({
      at: hour.at,
      temperature: hour.temperature,
      humidity: hour.humidity,
      windSpeed: hour.windSpeed,
      rainMm: null,
      raining: hour.precipitation !== '없음',
    }));
    const pops = hours.map((hour) => hour.pop).filter(finite);
    return {
      date,
      label: shortDate(date),
      gradeHours: counts,
      hours: hours.length,
      bestWindow: bestWindow(samples, 60, t),
      temperature: stat(hours.map((hour) => hour.temperature)),
      humidity: stat(hours.map((hour) => hour.humidity)),
      windSpeed: stat(hours.map((hour) => hour.windSpeed)),
      maxPop: pops.length ? Math.max(...pops) : null,
      precipitationHours: hours.filter(
        (hour) => hour.precipitation !== '없음' && hour.precipitation !== '알 수 없음',
      ).length,
    };
  });
}

/**
 * 예보 시간마다 같은 규칙 함수로 예상 등급을 매긴다. 현재 등급은 바꾸지 않는다.
 * 가까운 몇 시간은 초단기예보(없으면 단기예보 앞 6시간), 3일은 단기예보를 날짜별로 묶어 준다.
 */
export function forecastOutlook(
  input: { ultra?: SiteWeather['forecast'] | null; short?: ShortForecast | null },
  t: DryingThresholds = DRYING_THRESHOLDS,
): ForecastOutlook | null {
  const near = input.ultra?.hours.length
    ? { source: '기상청 초단기예보', issuedAt: input.ultra.issuedAt, hours: input.ultra.hours }
    : input.short?.hours.length
      ? {
          source: '기상청 단기예보',
          issuedAt: input.short.issuedAt,
          hours: input.short.hours.slice(0, 6),
        }
      : null;
  if (!near) return null;
  const hours = near.hours.map(({ at, temperature, humidity, windSpeed, precipitation }) => ({
    at,
    temperature,
    humidity,
    windSpeed,
    precipitation,
    expectedGrade: expectedGrade({ at, temperature, humidity, windSpeed, precipitation }, t),
  }));
  const days = input.short?.hours.length ? forecastDays(input.short, t) : undefined;
  const clock = (value: string) => kst(value).slice(6, 11);
  const good = hours.filter((hour) => hour.expectedGrade === '적합').map((hour) => clock(hour.at));
  const bad = hours.filter((hour) => hour.expectedGrade === '부적합');
  const nearText =
    `${near.source}(${kst(near.issuedAt)} 발표) 앞으로 ${hours.length}시간: ` +
    hours.map((hour) => `${clock(hour.at)} ${hour.expectedGrade}`).join(', ') +
    '. ' +
    (good.length
      ? `적합 예상 시각은 ${good.join(', ')}이에요.`
      : bad.length === hours.length
        ? '이 시간 내내 부적합으로 예상돼요.'
        : '적합으로 예상되는 시각은 없어요.');
  const daysText = days?.length
    ? ' 날짜별(기상청 단기예보): ' +
      days
        .map(
          (day) =>
            `${day.label} 적합 ${day.gradeHours.적합}시간·주의 ${day.gradeHours.주의}시간·부적합 ${day.gradeHours.부적합}시간` +
            `${day.bestWindow ? `(가장 긴 적합 ${day.bestWindow})` : ''}` +
            `${day.maxPop === null ? '' : `, 강수확률 최고 ${day.maxPop}%`}`,
        )
        .join(' / ') +
      '.'
    : '';
  return {
    kind: 'forecast',
    source:
      days && near.source !== '기상청 단기예보' ? `${near.source}·기상청 단기예보` : near.source,
    issuedAt: near.issuedAt,
    ...(days ? { days, daysIssuedAt: input.short!.issuedAt } : {}),
    hours,
    thresholds: t.version,
    summary: `${nearText}${daysText} 예보로 매긴 예상이라 현재 판정과 다를 수 있어요.`,
  };
}

// ── 화면이 서버 응답을 쓰기 전에 형식을 확인한다 ──

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const nullableNumber = (value: unknown) => value === null || finite(value);
const validStat = (value: unknown) =>
  record(value) &&
  nullableNumber(value.mean) &&
  nullableNumber(value.min) &&
  nullableNumber(value.max);
const validCounts = (value: unknown) =>
  record(value) && ['적합', '주의', '부적합', '제외'].every((key) => finite(value[key]));
const GRADES = ['적합', '주의', '부적합', '판정 불가'];
const instant = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const date = (value: unknown) => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
const validPercentages = (value: unknown) =>
  record(value) && ['적합', '주의', '부적합'].every((key) => finite(value[key]));

export function readHistorySummary(value: unknown): HistorySummary | null {
  if (
    !record(value) ||
    value.kind !== 'history' ||
    !text(value.source) ||
    !text(value.station) ||
    !date(value.from) ||
    !date(value.to) ||
    !nullableNumber(value.distanceM) ||
    (value.resolution !== 'day' && value.resolution !== 'week') ||
    !finite(value.missingRate) ||
    !text(value.summary) ||
    !text(value.thresholds) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 40 ||
    !record(value.totals) ||
    !validCounts(value.totals.gradeHours) ||
    !validStat(value.totals.temperature) ||
    !validStat(value.totals.humidity) ||
    !validStat(value.totals.windSpeed) ||
    !validPercentages(value.totals.percentages)
  )
    return null;
  const rowsValid = value.rows.every(
    (row) =>
      record(row) &&
      text(row.label) &&
      finite(row.samples) &&
      validStat(row.temperature) &&
      validStat(row.humidity) &&
      validStat(row.windSpeed) &&
      nullableNumber(row.rainMm) &&
      validCounts(row.gradeHours) &&
      finite(row.expectedHours) &&
      (row.bestWindow === null || text(row.bestWindow)),
  );
  return rowsValid ? (value as HistorySummary) : null;
}

export function readBatchDigest(value: unknown): BatchDigest | null {
  if (
    !record(value) ||
    value.kind !== 'batch' ||
    !text(value.name) ||
    !['진행 중', '종료', '취소'].includes(value.status as string) ||
    !text(value.fish) ||
    !finite(value.quantity) ||
    !instant(value.startedAt) ||
    !finite(value.elapsedHours) ||
    !finite(value.samples) ||
    !nullableNumber(value.missingRate) ||
    !validStat(value.temperature) ||
    !validStat(value.humidity) ||
    !validStat(value.windSpeed) ||
    !finite(value.alerts) ||
    !text(value.summary) ||
    (value.percentages !== null && !validPercentages(value.percentages))
  )
    return null;
  return value as BatchDigest;
}

export function readForecastOutlook(value: unknown): ForecastOutlook | null {
  if (
    !record(value) ||
    value.kind !== 'forecast' ||
    !text(value.source) ||
    !instant(value.issuedAt) ||
    !text(value.summary) ||
    !text(value.thresholds) ||
    !Array.isArray(value.hours) ||
    value.hours.length > 72
  )
    return null;
  const hoursValid = value.hours.every(
    (hour) =>
      record(hour) &&
      instant(hour.at) &&
      nullableNumber(hour.temperature) &&
      nullableNumber(hour.humidity) &&
      nullableNumber(hour.windSpeed) &&
      text(hour.precipitation) &&
      GRADES.includes(hour.expectedGrade as string),
  );
  const daysValid =
    (value.daysIssuedAt === undefined || instant(value.daysIssuedAt)) &&
    (value.days === undefined ||
      (Array.isArray(value.days) &&
        value.days.length <= 5 &&
        value.days.every(
          (day) =>
            record(day) &&
            date(day.date) &&
            text(day.label) &&
            validCounts(day.gradeHours) &&
            finite(day.hours) &&
            (day.bestWindow === null || text(day.bestWindow)) &&
            validStat(day.temperature) &&
            validStat(day.humidity) &&
            validStat(day.windSpeed) &&
            nullableNumber(day.maxPop) &&
            finite(day.precipitationHours),
        )));
  return hoursValid && daysValid ? (value as ForecastOutlook) : null;
}
