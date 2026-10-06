import type { LiveObservation, SiteWeather } from './live.ts';

// 널기 판단 규칙 함수 (기획서 US-1 · P0). 등급은 이 함수만 정하고 생성형 AI 는 설명만 한다.
// 같은 입력이면 AI 없이도 같은 등급이 나온다. 결정과 이유: docs/decisions/0010-drying-grade-rules.md
//
// 기준값은 모두 현장 검증 전 가설값이다. 판정마다 적용한 기준을 함께 남겨 기준이 바뀌어도
// 과거 판정을 다시 볼 수 있게 한다.

export type DryingGrade = '적합' | '주의' | '부적합' | '판정 불가';

export type DryingThresholds = {
  /** 기준 이름. 판정·기록에 함께 남는다 */
  version: string;
  /** 적합: 습도가 이 값 미만 (기획서 가설값 60%) */
  dryHumidityBelow: number;
  /** 적합: 풍속이 이 값 이상 (기획서 가설값 2m/s) */
  minWind: number;
  /** 부적합: 풍속이 이 값 이상 (기상청 강풍주의보 육상 기준 14m/s) */
  galeWind: number;
  /** 부적합: 습도가 이 값 이상 */
  wetHumidityAtLeast: number;
  /** 적합: 기온이 이 값 이하 (기획서 "영하 수도~영상 10도 내외" 적정 구간) */
  maxTemperature: number;
  /** 부적합: 기온이 이 값 초과 */
  hotTemperatureAbove: number;
  /** 이 값 미만의 저온은 판정 대상에서 뺀다 (기획서: 저온 조건 판정 제외) */
  minTemperature: number;
  /** 거리 게이트 */
  maxDistanceM: number;
};

export const DRYING_THRESHOLDS: DryingThresholds = {
  version: '2026-10-06 가설값',
  dryHumidityBelow: 60,
  minWind: 2,
  galeWind: 14,
  wetHumidityAtLeast: 85,
  maxTemperature: 10,
  hotTemperatureAbove: 15,
  minTemperature: -5,
  maxDistanceM: 1000,
};

/** 사람이 읽는 적용 기준 한 줄. */
export function describeThresholds(t: DryingThresholds = DRYING_THRESHOLDS): string {
  return (
    `적합: 습도 ${t.dryHumidityBelow}% 미만 · 풍속 ${t.minWind}~${t.galeWind}m/s · 기온 ${t.minTemperature}~${t.maxTemperature}°C / ` +
    `부적합: 비·눈, 풍속 ${t.galeWind}m/s 이상, 습도 ${t.wetHumidityAtLeast}% 이상, 기온 ${t.hotTemperatureAbove}°C 초과 ` +
    `(${t.version})`
  );
}

export type Assessment = {
  grade: DryingGrade;
  summary: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  /** 판정에 쓴 관측 시각. 판정 불가로 관측이 없으면 null */
  observedAt: string | null;
  ageMinutes: number | null;
  distanceM: number | null;
  deviceName: string;
  /** 수집 경로 (E-UM 대기환경 일괄 조회, 기상청 AWS 매분자료 등) */
  source: string;
  reasons: string[];
  /** 등급을 바꾸지 않는 조언 (예보·자외선 등) */
  advice?: string[];
  /** 판정 당시 적용한 기준 */
  thresholds?: DryingThresholds;
};

/** ISO 시각을 한국 시간 `MM.DD HH:mm KST` 로. 서버·화면·AI 설명이 같은 표기를 쓴다. */
export function kst(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return '시각 없음';
  const shifted = new Date(time + 9 * 60 * 60 * 1000).toISOString();
  return `${shifted.slice(5, 7)}.${shifted.slice(8, 10)} ${shifted.slice(11, 16)} KST`;
}

/** 기온·습도·풍속이 장비 고장으로 보이는가. 바닷가에서 습도 5% 미만은 나오지 않는다. */
export function implausibleReading(humidity: number | null): boolean {
  return humidity !== null && humidity < 5;
}

type Axes = { temperature: number; humidity: number; windSpeed: number; raining: boolean };

/** 세 축(+강수)만으로 등급을 정한다. 신뢰도·거리 게이트를 통과한 값에만 쓴다. */
export function gradeConditions(
  { temperature, humidity, windSpeed, raining }: Axes,
  t: DryingThresholds = DRYING_THRESHOLDS,
): { grade: Exclude<DryingGrade, '판정 불가'>; reasons: string[]; problems: string[] } {
  const reasons: string[] = [];
  const problems: string[] = [];
  const unsuitable: string[] = [];
  if (raining) unsuitable.push('비·눈이 오고 있어요');
  if (windSpeed >= t.galeWind) unsuitable.push(`강풍(${windSpeed}m/s)이에요`);
  if (humidity >= t.wetHumidityAtLeast) unsuitable.push(`습도가 매우 높아요(${humidity}%)`);
  if (temperature > t.hotTemperatureAbove) unsuitable.push(`기온이 높아요(${temperature}°C)`);

  reasons.push(
    `기온 ${temperature}°C · ${
      temperature > t.hotTemperatureAbove
        ? `${t.hotTemperatureAbove}°C 초과로 산패 위험이 커요`
        : temperature > t.maxTemperature
          ? `적정 ${t.minTemperature}~${t.maxTemperature}°C보다 높아요`
          : `적정 ${t.minTemperature}~${t.maxTemperature}°C 안이에요`
    }`,
  );
  reasons.push(
    `습도 ${humidity}% · ${
      humidity >= t.wetHumidityAtLeast
        ? `${t.wetHumidityAtLeast}% 이상이라 습기가 머물러요`
        : humidity >= t.dryHumidityBelow
          ? `기준 ${t.dryHumidityBelow}% 미만보다 높아 건조가 더딜 수 있어요`
          : `기준 ${t.dryHumidityBelow}% 미만이에요`
    }`,
  );
  reasons.push(
    `풍속 ${windSpeed}m/s · ${
      windSpeed >= t.galeWind
        ? `강풍주의보 육상 기준 ${t.galeWind}m/s 이상이에요`
        : windSpeed < t.minWind
          ? `기준 ${t.minWind}m/s보다 약해 통풍이 부족해요`
          : `기준 ${t.minWind}~${t.galeWind}m/s 안이에요`
    }`,
  );
  if (temperature > t.maxTemperature && temperature <= t.hotTemperatureAbove)
    problems.push(`기온이 적정보다 높아요(${temperature}°C)`);
  if (humidity >= t.dryHumidityBelow && humidity < t.wetHumidityAtLeast)
    problems.push(`습도가 높아요(${humidity}%)`);
  if (windSpeed < t.minWind) problems.push(`바람이 약해요(${windSpeed}m/s)`);

  const grade = unsuitable.length ? '부적합' : problems.length ? '주의' : '적합';
  return { grade, reasons, problems: unsuitable.length ? unsuitable : problems };
}

const PROVIDER_SOURCE: Record<string, string> = {
  kma: '기상청 API허브 AWS 매분자료',
  eum: '포항 E-UM 대기환경 관측 API',
};

function unavailable(
  summary: string,
  observation: LiveObservation | null,
  reasons: string[],
  t: DryingThresholds,
): Assessment {
  return {
    grade: '판정 불가',
    summary,
    temperature: observation?.temperature ?? null,
    humidity: observation?.humidity ?? null,
    windSpeed: observation?.windSpeed ?? null,
    observedAt: observation?.observedAt ?? null,
    ageMinutes: observation?.ageMinutes ?? null,
    distanceM: observation?.distanceM ?? null,
    deviceName: observation?.device.name ?? '사용할 수 있는 관측기 없음',
    source: observation ? PROVIDER_SOURCE[observation.device.provider ?? 'eum'] : '없음',
    reasons,
    thresholds: t,
  };
}

/** 예보·강수는 등급을 바꾸지 않는 조언으로 정리한다 (기획서: 강우·자외선은 조언으로만). */
export function weatherAdvice(weather: SiteWeather | undefined | null): string[] {
  const advice: string[] = [];
  const next = weather?.forecast?.hours.find((hour) => hour.precipitation !== '없음');
  if (next)
    advice.push(
      `${kst(next.at)} ${next.precipitation} 예보예요 (기상청 초단기예보). 덮개나 회수를 미리 준비해 주세요.`,
    );
  if (weather?.rain?.todayMm && weather.rain.todayMm > 0)
    advice.push(
      `오늘 구룡포 AWS 강수량 ${weather.rain.todayMm}mm. 원물이 젖지 않았는지 확인해 주세요.`,
    );
  return advice;
}

/** 관측 하나와 덕장 날씨로 널기 등급을 정한다. */
export function assessDrying(
  observation: LiveObservation | null,
  weather?: SiteWeather | null,
  t: DryingThresholds = DRYING_THRESHOLDS,
): Assessment {
  const advice = weatherAdvice(weather);
  const withAdvice = (assessment: Assessment): Assessment =>
    advice.length ? { ...assessment, advice } : assessment;
  if (!observation)
    return withAdvice(
      unavailable(
        '덕장 1km 안에서 쓸 수 있는 관측값이 없어 판정할 수 없어요.',
        null,
        ['검사를 통과한 관측기가 없어요. 덕장 위치와 관측기 연결을 확인해 주세요.'],
        t,
      ),
    );
  const where = `${observation.device.name} · 덕장에서 ${
    observation.distanceM === null || observation.distanceM === undefined
      ? '거리 미확인'
      : `${observation.distanceM}m`
  }`;
  if (
    observation.distanceM === null ||
    observation.distanceM === undefined ||
    observation.distanceM > t.maxDistanceM
  )
    return withAdvice(
      unavailable(
        '가까운 관측기가 1km 밖에 있어 판정할 수 없어요.',
        observation,
        [`${where} · 거리 기준 ${t.maxDistanceM}m를 넘어요.`],
        t,
      ),
    );
  if (observation.status !== 'current')
    return withAdvice(
      unavailable(
        '최근 관측값이 아니어서 판정할 수 없어요.',
        observation,
        [
          `${where} · ${kst(observation.observedAt)} 측정 (${observation.ageMinutes ?? '?'}분 전)으로 최신 값이 아니에요.`,
        ],
        t,
      ),
    );
  const { temperature, humidity, windSpeed } = observation;
  if (temperature === null || humidity === null || windSpeed === null)
    return withAdvice(
      unavailable(
        '기온·습도·풍속 중 빠진 값이 있어 판정할 수 없어요.',
        observation,
        [`${where} · 필수 관측값이 비어 있어요.`],
        t,
      ),
    );
  if (implausibleReading(humidity))
    return withAdvice(
      unavailable(
        '관측기 값이 비정상으로 보여 판정할 수 없어요.',
        observation,
        [
          `${where} · 습도 ${humidity}%는 현장에서 나올 수 없는 값이라 관측기 상태 확인이 필요해요.`,
        ],
        t,
      ),
    );
  if (temperature < t.minTemperature)
    return withAdvice(
      unavailable(
        `기온 ${temperature}°C의 저온은 아직 판정 기준 밖이에요.`,
        observation,
        [`기온 ${t.minTemperature}°C 미만의 동결·해동 조건은 기획서에 따라 판정에서 제외해요.`],
        t,
      ),
    );
  const raining = Boolean(weather?.precipitation && weather.precipitation.type !== '없음');
  const graded = gradeConditions({ temperature, humidity, windSpeed, raining }, t);
  const summary =
    graded.grade === '적합'
      ? '습도가 낮고 바람이 있어 널기 좋은 조건이에요.'
      : graded.grade === '주의'
        ? `${graded.problems.join(', ')}. 현장 상태를 확인하고 널어 주세요.`
        : `${graded.problems.join(', ')}. 지금은 널기를 미루거나 회수를 검토해 주세요.`;
  const reasons = [...graded.reasons];
  if (weather?.precipitation)
    reasons.push(
      `강수 ${weather.precipitation.type} · ${kst(weather.precipitation.observedAt)} 기상청 초단기실황`,
    );
  reasons.push(`${kst(observation.observedAt)} 측정 (${observation.ageMinutes}분 전) · ${where}`);
  return withAdvice({
    grade: graded.grade,
    summary,
    temperature,
    humidity,
    windSpeed,
    observedAt: observation.observedAt,
    ageMinutes: observation.ageMinutes,
    distanceM: observation.distanceM,
    deviceName: observation.device.name,
    source: PROVIDER_SOURCE[observation.device.provider ?? 'eum'],
    reasons,
    thresholds: t,
  });
}

/** 기록된 관측 표본으로 배치를 평가한다. 표본마다 지금 기준으로 다시 등급을 매긴다. */
export type BatchEvaluation = {
  thresholds: DryingThresholds;
  counts: Record<Exclude<DryingGrade, '판정 불가'>, number>;
  /** 값이 비어 판정하지 못한 표본(결측) */
  unrated: number;
  firstUnsuitableAt: string | null;
  summary: string;
};

export function evaluateBatch(
  observations: {
    observedAt: string;
    temperature: number | null;
    humidity: number | null;
    wind: number | null;
  }[],
  t: DryingThresholds = DRYING_THRESHOLDS,
): BatchEvaluation {
  const counts = { 적합: 0, 주의: 0, 부적합: 0 };
  let unrated = 0;
  let firstUnsuitableAt: string | null = null;
  for (const item of observations) {
    if (
      item.temperature === null ||
      item.humidity === null ||
      item.wind === null ||
      implausibleReading(item.humidity) ||
      item.temperature < t.minTemperature
    ) {
      unrated += 1;
      continue;
    }
    const { grade } = gradeConditions(
      {
        temperature: item.temperature,
        humidity: item.humidity,
        windSpeed: item.wind,
        raining: false,
      },
      t,
    );
    counts[grade] += 1;
    if (grade === '부적합' && !firstUnsuitableAt) firstUnsuitableAt = item.observedAt;
  }
  const rated = counts.적합 + counts.주의 + counts.부적합;
  const percent = (value: number) => (rated ? Math.round((value / rated) * 100) : 0);
  const summary = rated
    ? `적합 ${percent(counts.적합)}% · 주의 ${percent(counts.주의)}% · 부적합 ${percent(counts.부적합)}% (표본 ${rated}개${unrated ? `, 결측·판정 제외 ${unrated}개` : ''})`
    : '판정할 수 있는 관측 표본이 아직 없어요.';
  return { thresholds: t, counts, unrated, firstUnsuitableAt, summary };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const timestamp = (value: unknown): value is string =>
  text(value) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));

/** 서버·저장된 응답의 판정을 화면에 쓰기 전에 확인한다. 맞지 않으면 null. */
export function readAssessment(value: unknown): Assessment | null {
  if (!record(value)) return null;
  if (!text(value.grade) || !['적합', '주의', '부적합', '판정 불가'].includes(value.grade))
    return null;
  if (!text(value.summary) || !text(value.deviceName) || !text(value.source)) return null;
  if (!Array.isArray(value.reasons) || !value.reasons.length || !value.reasons.every(text))
    return null;
  const graded = value.grade !== '판정 불가';
  const nullable = (item: unknown, check: (x: unknown) => boolean) =>
    item === null ? !graded : check(item);
  if (!nullable(value.observedAt, timestamp)) return null;
  if (!nullable(value.ageMinutes, (x) => finite(x) && x >= 0)) return null;
  if (!nullable(value.distanceM, (x) => finite(x) && x >= 0)) return null;
  if (!nullable(value.temperature, finite)) return null;
  if (!nullable(value.humidity, (x) => finite(x) && x >= 0 && x <= 100)) return null;
  if (!nullable(value.windSpeed, (x) => finite(x) && x >= 0)) return null;
  // 거리 게이트를 넘는 판정은 판정 불가여야 한다.
  if (graded && (value.distanceM as number) > 1000) return null;
  if (value.advice !== undefined && (!Array.isArray(value.advice) || !value.advice.every(text)))
    return null;
  return {
    grade: value.grade as DryingGrade,
    summary: value.summary,
    temperature: value.temperature as number | null,
    humidity: value.humidity as number | null,
    windSpeed: value.windSpeed as number | null,
    observedAt: value.observedAt as string | null,
    ageMinutes: value.ageMinutes as number | null,
    distanceM: value.distanceM as number | null,
    deviceName: value.deviceName,
    source: value.source,
    reasons: [...(value.reasons as string[])],
    ...(value.advice ? { advice: [...(value.advice as string[])] } : {}),
    ...(record(value.thresholds) && text(value.thresholds.version)
      ? { thresholds: value.thresholds as DryingThresholds }
      : {}),
  };
}
