export type LiveDevice = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  /** 자료를 준 기관. 없으면 E-UM. 기상청 AWS 는 E-UM 관측기가 오래됐거나 이상할 때 대신 쓴다 */
  provider?: 'eum' | 'kma';
};

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
};

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

function readDevice(value: unknown): LiveDevice {
  if (
    !record(value) ||
    !text(value.id) ||
    !text(value.name) ||
    typeof value.address !== 'string' ||
    !finite(value.latitude) ||
    Math.abs(value.latitude) > 90 ||
    !finite(value.longitude) ||
    Math.abs(value.longitude) > 180
  )
    throw new Error('관측기 정보를 확인할 수 없어요.');
  return {
    id: value.id,
    name: value.name,
    address: value.address,
    latitude: value.latitude,
    longitude: value.longitude,
    ...(value.provider === 'kma' || value.provider === 'eum' ? { provider: value.provider } : {}),
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
  return precipitation || rain || sun ? { precipitation, rain, sun } : undefined;
}

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
  };
}
