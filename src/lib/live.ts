export type LiveDevice = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
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
  };
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
  };
}
