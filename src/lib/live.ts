import { readAssessment, type Assessment } from './drying.ts';

export type LiveDevice = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  /**
   * 자료를 준 곳. 없으면 E-UM. 1km 안 E-UM 이 없거나 이상할 때 기상청 AWS(kma)를,
   * 그것도 5km 안에 없으면 덕장이 속한 기상청 초단기실황 격자(kma-grid)를 대신 쓴다 (ADR 0013)
   */
  provider?: 'eum' | 'kma' | 'kma-grid';
};

/**
 * 기상청 초단기실황 격자 값을 판정·기록에 쓰는 최대 경과 시간(분). 매시 자료가 약 40분 뒤 나오고 다음
 * 자료가 나올 때까지 쓰므로 정시 기준으로 최대 약 105분 지난 값을 받는다. 1분 갱신 관측(30분)보다 길다.
 */
export const GRID_STALE_MINUTES = 120;

export type LiveObservation = {
  device: LiveDevice;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  observedAt: string | null;
  observedAtRaw: string | null;
  ageMinutes: number | null;
  status: 'current' | 'stale' | 'invalid';
  issues: string[];
  distanceM?: number | null;
};

/** 기상청·천문연 보조 자료 (덕장 위치 기준). 판정에는 쓰지 않고 안내·AI 설명 근거로만 쓴다 */
export type SiteWeather = {
  /** 기상청 초단기실황: 지금 비·눈이 오는지 */
  precipitation: { type: string; rain1hMm: number | null; observedAt: string } | null;
  /** 기상청 AWS 816 구룡포 강수량 */
  rain: { last60mMm: number | null; todayMm: number | null; observedAt: string } | null;
  /** 한국천문연구원 일출·일몰 (HH:MM) */
  sun: { date: string; sunrise: string; sunset: string } | null;
  /** 기상청 초단기예보: 앞으로 6시간 (예보라서 등급을 바꾸지 않고 조언으로만 쓴다) */
  forecast?: {
    issuedAt: string;
    hours: {
      at: string;
      temperature: number | null;
      humidity: number | null;
      windSpeed: number | null;
      precipitation: string;
      rain: string | null;
    }[];
  } | null;
};

/** 왜 이 관측을 골랐는지. E-UM 이 정본이고 기상청은 보조다 (ADR 0009, 0013). */
export type SelectionReason =
  'eum' | 'kma-no-recent-eum' | 'kma-eum-anomaly' | 'kma-grid' | 'explicit';

export type LiveSnapshot = {
  fetchedAt: string;
  source: string;
  sourceUrl: string;
  devices: LiveDevice[];
  observations: LiveObservation[];
  selected: LiveObservation | null;
  warnings: string[];
  status: 'ok' | 'archived' | 'error';
  archiveSourceDate?: string;
  error?: string;
  llm: { configured: boolean; model: string };
  site?: { id: string; name: string; latitude: number; longitude: number };
  weather?: SiteWeather;
  selectionReason?: SelectionReason;
  /** 규칙 함수의 널기 판정 (덕장이 있을 때만) */
  assessment?: Assessment;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}

function timestamp(value: unknown): value is string {
  return (
    text(value) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

const PROVIDERS: unknown[] = ['eum', 'kma', 'kma-grid'];

function readDevice(value: unknown): LiveDevice {
  if (
    !record(value) ||
    !text(value.id) ||
    !text(value.name) ||
    typeof value.address !== 'string' ||
    !finite(value.latitude) ||
    Math.abs(value.latitude) > 90 ||
    !finite(value.longitude) ||
    Math.abs(value.longitude) > 180 ||
    // 모르는 기관을 E-UM 으로 보이게 하지 않는다.
    (value.provider !== undefined && !PROVIDERS.includes(value.provider as string))
  )
    throw new Error('관측기 정보를 확인할 수 없어요.');
  return {
    id: value.id,
    name: value.name,
    address: value.address,
    latitude: value.latitude,
    longitude: value.longitude,
    ...(PROVIDERS.includes(value.provider as string)
      ? { provider: value.provider as LiveDevice['provider'] }
      : {}),
  };
}

const mm = (value: unknown) => value === null || (finite(value) && value >= 0);

/** 보조 자료는 형식이 맞는 부분만 남긴다. 없거나 틀려도 관측 응답 전체를 버리지 않는다. */
function readWeather(value: unknown): SiteWeather | undefined {
  if (!record(value)) return undefined;
  const p = value.precipitation;
  const r = value.rain;
  const s = value.sun;
  const precipitation =
    record(p) && text(p.type) && mm(p.rain1hMm) && timestamp(p.observedAt)
      ? { type: p.type, rain1hMm: p.rain1hMm as number | null, observedAt: p.observedAt }
      : null;
  const rain =
    record(r) && mm(r.last60mMm) && mm(r.todayMm) && timestamp(r.observedAt)
      ? {
          last60mMm: r.last60mMm as number | null,
          todayMm: r.todayMm as number | null,
          observedAt: r.observedAt,
        }
      : null;
  const clock = (item: unknown): item is string => text(item) && /^\d{2}:\d{2}$/.test(item);
  const sun =
    record(s) &&
    text(s.date) &&
    /^\d{4}-\d{2}-\d{2}$/.test(s.date) &&
    clock(s.sunrise) &&
    clock(s.sunset)
      ? { date: s.date, sunrise: s.sunrise, sunset: s.sunset }
      : null;
  const f = value.forecast;
  const forecast =
    record(f) &&
    timestamp(f.issuedAt) &&
    Array.isArray(f.hours) &&
    f.hours.every(
      (hour) =>
        record(hour) &&
        timestamp(hour.at) &&
        (hour.temperature === null || finite(hour.temperature)) &&
        (hour.humidity === null ||
          (finite(hour.humidity) && hour.humidity >= 0 && hour.humidity <= 100)) &&
        mm(hour.windSpeed) &&
        text(hour.precipitation) &&
        (hour.rain === null || text(hour.rain)),
    )
      ? {
          issuedAt: f.issuedAt,
          hours: (f.hours as Record<string, unknown>[]).map((hour) => ({
            at: hour.at as string,
            temperature: hour.temperature as number | null,
            humidity: hour.humidity as number | null,
            windSpeed: hour.windSpeed as number | null,
            precipitation: hour.precipitation as string,
            rain: hour.rain as string | null,
          })),
        }
      : null;
  return precipitation || rain || sun || forecast
    ? { precipitation, rain, sun, forecast }
    : undefined;
}

const SELECTION_REASONS = ['eum', 'kma-no-recent-eum', 'kma-eum-anomaly', 'kma-grid', 'explicit'];

export function readLiveObservation(value: unknown): LiveObservation {
  if (
    !record(value) ||
    (value.distanceM !== undefined &&
      value.distanceM !== null &&
      (!finite(value.distanceM) || value.distanceM < 0)) ||
    (value.temperature !== null && !finite(value.temperature)) ||
    (value.humidity !== null &&
      (!finite(value.humidity) || value.humidity < 0 || value.humidity > 100)) ||
    (value.windSpeed !== null && (!finite(value.windSpeed) || value.windSpeed < 0)) ||
    (value.observedAt !== null && !timestamp(value.observedAt)) ||
    (value.observedAtRaw !== null && !text(value.observedAtRaw)) ||
    (value.ageMinutes !== null && (!finite(value.ageMinutes) || value.ageMinutes < 0)) ||
    !text(value.status) ||
    !['current', 'stale', 'invalid'].includes(value.status) ||
    !strings(value.issues)
  )
    throw new Error('실제 관측 데이터 형식이 올바르지 않아요.');
  if (
    value.status !== 'invalid' &&
    [value.temperature, value.humidity, value.windSpeed, value.observedAt, value.ageMinutes].some(
      (item) => item === null,
    )
  ) {
    throw new Error('관측 데이터의 상태와 관측값이 일치하지 않아요.');
  }
  return {
    device: readDevice(value.device),
    temperature: value.temperature as number | null,
    humidity: value.humidity as number | null,
    windSpeed: value.windSpeed as number | null,
    observedAt: value.observedAt as string | null,
    observedAtRaw: value.observedAtRaw as string | null,
    ageMinutes: value.ageMinutes as number | null,
    status: value.status as LiveObservation['status'],
    issues: [...value.issues],
    ...(value.distanceM === undefined ? {} : { distanceM: value.distanceM as number | null }),
  };
}

export function readLiveSnapshot(value: unknown): LiveSnapshot {
  if (
    !record(value) ||
    !timestamp(value.fetchedAt) ||
    !text(value.source) ||
    !text(value.sourceUrl) ||
    !/^https:\/\//.test(value.sourceUrl) ||
    !Array.isArray(value.devices) ||
    !Array.isArray(value.observations) ||
    !strings(value.warnings) ||
    !text(value.status) ||
    !['ok', 'archived', 'error'].includes(value.status) ||
    !record(value.llm) ||
    typeof value.llm.configured !== 'boolean' ||
    !text(value.llm.model) ||
    (value.error !== undefined && !text(value.error)) ||
    (value.archiveSourceDate !== undefined &&
      (!text(value.archiveSourceDate) || !/^\d{4}-\d{2}-\d{2}$/.test(value.archiveSourceDate)))
  )
    throw new Error('실제 관측 응답을 확인할 수 없어요.');
  const devices = value.devices.map(readDevice);
  const observations = value.observations.map(readLiveObservation);
  const selected = value.selected === null ? null : readLiveObservation(value.selected);
  let site: LiveSnapshot['site'];
  if (value.site !== undefined) {
    if (
      !record(value.site) ||
      !text(value.site.id) ||
      !text(value.site.name) ||
      !finite(value.site.latitude) ||
      Math.abs(value.site.latitude) > 90 ||
      !finite(value.site.longitude) ||
      Math.abs(value.site.longitude) > 180
    )
      throw new Error('덕장 위치 정보를 확인할 수 없어요.');
    site = {
      id: value.site.id,
      name: value.site.name,
      latitude: value.site.latitude,
      longitude: value.site.longitude,
    };
  }
  if (selected && !devices.some((device) => device.id === selected.device.id)) {
    throw new Error('선택한 관측기를 목록에서 찾을 수 없어요.');
  }
  const weather = readWeather(value.weather);
  const assessment = value.assessment === undefined ? null : readAssessment(value.assessment);
  const selectionReason =
    typeof value.selectionReason === 'string' && SELECTION_REASONS.includes(value.selectionReason)
      ? (value.selectionReason as SelectionReason)
      : undefined;
  return {
    fetchedAt: value.fetchedAt,
    source: value.source,
    sourceUrl: value.sourceUrl,
    devices,
    observations,
    selected,
    warnings: [...value.warnings],
    status: value.status as LiveSnapshot['status'],
    ...(value.archiveSourceDate === undefined
      ? {}
      : { archiveSourceDate: value.archiveSourceDate as string }),
    ...(value.error === undefined ? {} : { error: value.error as string }),
    llm: { configured: value.llm.configured, model: value.llm.model },
    ...(site ? { site } : {}),
    ...(weather ? { weather } : {}),
    ...(selectionReason ? { selectionReason } : {}),
    ...(assessment ? { assessment } : {}),
  };
}
