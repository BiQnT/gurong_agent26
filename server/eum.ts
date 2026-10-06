import type { LiveDevice, LiveObservation, LiveSnapshot } from '../src/lib/live.ts';
import type { ClaudeConfig } from './claude-cli.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const EUM_BASE = 'https://genix.pohang-eum.kr';
const DEVICE_PATH = '/dpg/atmosphere/devices';
const REALTIME_PATH = '/dpg/atmosphere/devices/realtime';
const SINGLE_PATH = '/dpg/atmosphere/device/realtime';

export type BridgeConfig = {
  eumServiceKey: string;
  /** 채팅 설명을 만들 제공자. claude: claude CLI, openai(또는 생략): OpenAI 호환 HTTP API */
  llmProvider?: 'claude' | 'openai';
  claude?: ClaudeConfig;
  /** 설정하면 계정·작업 자료를 파일 대신 이 SQLite DB 에 저장한다 (VM 의 공유 DB). */
  databasePath?: string;
  /** 원격에서 들어와도 되는 화면 주소(스킴·호스트·포트 전체). 예: https://dev.35-192-216-232.sslip.io */
  publicOrigins?: string[];
  /** TLS 프록시(Caddy) 뒤에서 세션 쿠키에 Secure 를 붙인다. */
  cookieSecure?: boolean;
  /** dev 서버 앞의 공용 암호 "아이디:비밀번호". 설정하면 dev(Vite) 의 모든 요청에 Basic 인증. */
  devBasicAuth?: string;
  /** 암호 없이 연 dev. 화면에 필요한 파일만 준다 (DEV_OPEN=1) */
  devOpen?: boolean;
  /** 기상청 API허브 인증키 (A1~A8, B1~B3) */
  kmaAuthKey?: string;
  /** 공공데이터포털 인증키 (B4~B6) */
  dataGoKrKey?: string;
  openaiApiKey: string;
  openaiModel: string;
  /** OpenAI-compatible base URL, e.g. https://opencode.ai/zen/v1 */
  llmBaseUrl: string;
  timezoneOffset: string;
  staleAfterMinutes: number;
  projectRoot: string;
};

/** 화면과 헬스체크에 보이는 AI 설정 상태. claude CLI 는 키 대신 서버 로그인·토큰을 쓰므로 선택만으로 설정된 것으로 본다. */
export function llmStatus(config: BridgeConfig): { configured: boolean; model: string } {
  if (config.llmProvider === 'claude' && config.claude)
    return {
      configured: true,
      model: config.claude.model ? `claude · ${config.claude.model}` : 'claude (CLI 기본 모델)',
    };
  return { configured: !!config.openaiApiKey, model: config.openaiModel };
}

export class BridgeError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.code = code;
  }
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function number(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// Sensor/data-error bounds only; these are not drying or food-safety criteria.
function boundedNumber(value: unknown, minimum: number, maximum: number): number | null {
  const numeric = number(value);
  return numeric !== null && numeric >= minimum && numeric <= maximum ? numeric : null;
}

function parseObservationTimestamp(value: string): number {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Date.parse accepts some nonexistent dates by rolling into the next month.
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return NaN;
  return Date.parse(value);
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeDevice(value: unknown): LiveDevice | null {
  if (!object(value)) return null;
  const id = typeof value.id === 'number' || typeof value.id === 'string' ? String(value.id) : '';
  const latitude = number(value.latitude);
  const longitude = number(value.longitude);
  if (
    !id ||
    latitude === null ||
    longitude === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const name = cleanText(value.nickname) ?? cleanText(value.name) ?? `대기환경 관측기 ${id}`;
  return { id, name, address: cleanText(value.address) ?? '', latitude, longitude };
}

// E-UM 원문 시각("2026-10-04 14:00:33")에는 시간대 표기가 없지만 한국 시간이다.
// 2026-10-04T05:01:00Z(14:01 KST)에 부른 단건 관측이 "14:00:33" 이었다 (research/api-tests/2026-10-04-eum-key.md).
// UTC 였다면 9시간 뒤 미래 시각이 된다. 이 값으로 읽을 때는 확인된 사실이라 확인 사항으로 남기지 않는다.
export const EUM_SOURCE_OFFSET = '+09:00';

export function normalizeObservation(
  device: LiveDevice,
  value: unknown,
  now: number,
  timezoneOffset: string,
  staleAfterMinutes: number,
): LiveObservation {
  const row = object(value) ? value : {};
  const issues: string[] = [];
  const temperature = boundedNumber(row.temp, -80, 60);
  const humidity = boundedNumber(row.humi, 0, 100);
  const windSpeed = boundedNumber(row.winsp, 0, 100);
  const observedAtRaw = cleanText(row.logDateTime);
  let observedAt: string | null = null;
  let ageMinutes: number | null = null;
  if (observedAtRaw) {
    let normalized = observedAtRaw.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)) {
      normalized += timezoneOffset;
      if (timezoneOffset !== EUM_SOURCE_OFFSET)
        issues.push(
          `원천 수집 시각에 시간대가 없어 ${timezoneOffset}으로 해석했어요. 시간대 확인이 필요해요.`,
        );
    }
    const parsed = parseObservationTimestamp(normalized);
    if (Number.isFinite(parsed)) {
      observedAt = new Date(parsed).toISOString();
      if (parsed <= now) ageMinutes = Math.floor((now - parsed) / 60000);
      else issues.push('수집 시각이 조회 시각보다 미래여서 경과 시간을 확인할 수 없어요.');
    }
  }
  if (!observedAt) issues.push('유효한 수집 시각이 없어 현재 관측값인지 확인할 수 없어요.');
  if (temperature === null)
    issues.push('온도 관측값이 없거나 데이터 확인 범위(-80~60°C)를 벗어났어요.');
  if (humidity === null) issues.push('습도 관측값이 없거나 유효 범위를 벗어났어요.');
  if (windSpeed === null)
    issues.push('풍속 관측값이 없거나 데이터 확인 범위(0~100m/s)를 벗어났어요.');
  const incomplete = [temperature, humidity, windSpeed, observedAt, ageMinutes].some(
    (item) => item === null,
  );
  const status = incomplete ? 'invalid' : ageMinutes! > staleAfterMinutes ? 'stale' : 'current';
  if (status === 'stale')
    issues.push(
      `수집 후 ${ageMinutes}분이 지났어요. 화면 갱신 기준 ${staleAfterMinutes}분을 초과한 과거 관측값이에요.`,
    );
  return {
    device,
    temperature,
    humidity,
    windSpeed,
    observedAt,
    observedAtRaw,
    ageMinutes,
    status,
    issues,
  };
}

export function selectObservation(
  observations: LiveObservation[],
  deviceId?: string,
): LiveObservation | null {
  if (deviceId)
    return observations.find((observation) => observation.device.id === deviceId) ?? null;
  return (
    [...observations].sort((a, b) => {
      if (a.status === 'invalid' && b.status !== 'invalid') return 1;
      if (a.status !== 'invalid' && b.status === 'invalid') return -1;
      return Date.parse(b.observedAt ?? '1970-01-01') - Date.parse(a.observedAt ?? '1970-01-01');
    })[0] ?? null
  );
}

export function createObservationService(config: BridgeConfig, fetcher: typeof fetch = fetch) {
  type CachedData = {
    fetchedAt: string;
    devices: LiveDevice[];
    rows: Map<string, unknown>;
    warnings: string[];
    status: 'ok' | 'archived';
    archiveSourceDate?: string;
  };
  let cache: { storedAt: number; data: CachedData } | null = null;

  async function readArchivedDevices(): Promise<LiveDevice[]> {
    const payload: unknown = JSON.parse(
      await readFile(join(config.projectRoot, 'research/api-tests/raw/INT_S01_001.json'), 'utf8'),
    );
    if (!object(payload) || !object(payload.response) || !Array.isArray(payload.response.data))
      throw new Error('Invalid archived device metadata');
    const devices = payload.response.data
      .map(normalizeDevice)
      .filter((device): device is LiveDevice => device !== null);
    if (!devices.length) throw new Error('No archived device metadata');
    return devices;
  }

  async function eum(path: string, signal: AbortSignal, id?: string): Promise<unknown> {
    if (!config.eumServiceKey)
      throw new BridgeError(503, 'EUM_KEY_MISSING', 'E-UM 인증키가 서버에 설정되지 않았어요.');
    const url = new URL(path, EUM_BASE);
    url.searchParams.set('serviceKey', config.eumServiceKey);
    if (id) url.searchParams.set('id', id);
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
        redirect: 'error',
      });
    } catch {
      signal.throwIfAborted();
      throw new BridgeError(
        502,
        'EUM_UNREACHABLE',
        'E-UM 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
      );
    }
    if (!response.ok)
      throw new BridgeError(
        502,
        response.status === 401 || response.status === 403 ? 'EUM_UNAUTHORIZED' : 'EUM_HTTP_ERROR',
        response.status === 401 || response.status === 403
          ? `E-UM 인증이 거절됐어요. (HTTP ${response.status})`
          : `E-UM 서버가 관측 요청을 처리하지 못했어요. (HTTP ${response.status})`,
      );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BridgeError(502, 'EUM_INVALID_JSON', 'E-UM 응답을 읽을 수 없어요.');
    }
    if (!object(payload) || payload.status !== 'success' || payload.data === undefined) {
      throw new BridgeError(502, 'EUM_REJECTED', 'E-UM 인증 또는 응답 상태를 확인할 수 없어요.');
    }
    return payload.data;
  }

  async function readLive(signal: AbortSignal): Promise<CachedData> {
    const warnings: string[] = [];
    let devices: LiveDevice[];
    try {
      const result = await eum(DEVICE_PATH, signal);
      if (!Array.isArray(result))
        throw new BridgeError(
          502,
          'EUM_DEVICES_INVALID',
          'E-UM 관측기 목록 형식이 올바르지 않아요.',
        );
      devices = result
        .map(normalizeDevice)
        .filter((device): device is LiveDevice => device !== null);
      if (!devices.length)
        throw new BridgeError(
          502,
          'EUM_NO_DEVICES',
          'E-UM에서 사용할 수 있는 관측기를 찾지 못했어요.',
        );
    } catch (error) {
      signal.throwIfAborted();
      try {
        devices = await readArchivedDevices();
      } catch {
        throw error;
      }
      // Device metadata and sensor readings have independently scoped API permissions.
      warnings.push(
        '관측기 목록 API를 가져오지 못해 보관된 실제 관측소 정보를 사용해요. 관측값은 실시간 API에서 별도로 조회해요.',
      );
    }
    const rows = new Map<string, unknown>();
    let observationError: BridgeError | undefined;
    try {
      const realtime = await eum(REALTIME_PATH, signal);
      if (!Array.isArray(realtime)) throw new Error('invalid');
      for (const row of realtime) {
        if (object(row) && (typeof row.devId === 'number' || typeof row.devId === 'string'))
          rows.set(String(row.devId), row);
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof BridgeError) observationError = error;
      warnings.push('전체 관측 조회가 실패해 관측기별 API로 다시 확인했어요.');
    }
    const missing = devices.filter((device) => !rows.has(device.id));
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, missing.length) }, async () => {
        while (cursor < missing.length) {
          const device = missing[cursor++];
          try {
            const row = await eum(SINGLE_PATH, signal, device.id);
            if (object(row) && String(row.devId) === device.id) rows.set(device.id, row);
          } catch (error) {
            signal.throwIfAborted();
            if (error instanceof BridgeError) observationError ??= error;
          }
        }
      }),
    );
    if (!rows.size)
      throw (
        observationError ??
        new BridgeError(
          502,
          'EUM_NO_OBSERVATIONS',
          'E-UM에서 관측값을 받지 못했어요. 샘플 데이터로 대체하지 않았어요.',
        )
      );
    if (rows.size < devices.length)
      warnings.push(`${devices.length - rows.size}개 관측기의 데이터를 받지 못했어요.`);
    return { fetchedAt: new Date().toISOString(), devices, rows, warnings, status: 'ok' };
  }

  async function readArchive(reason: string): Promise<CachedData> {
    try {
      const [devices, observationFile] = await Promise.all([
        readArchivedDevices(),
        readFile(join(config.projectRoot, 'research/api-tests/raw/INT_S01_003.json'), 'utf8'),
      ]);
      const observationPayload: unknown = JSON.parse(observationFile);
      if (
        !object(observationPayload) ||
        !object(observationPayload.response) ||
        !Array.isArray(observationPayload.response.data)
      )
        throw new Error('invalid');
      const rows = new Map<string, unknown>();
      const dates: string[] = [];
      for (const row of observationPayload.response.data) {
        if (object(row) && (typeof row.devId === 'number' || typeof row.devId === 'string')) {
          rows.set(String(row.devId), row);
          if (typeof row.logDateTime === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.logDateTime))
            dates.push(row.logDateTime.slice(0, 10));
        }
      }
      if (!devices.length || !rows.size) throw new Error('empty');
      return {
        fetchedAt: new Date().toISOString(),
        devices,
        rows,
        status: 'archived',
        archiveSourceDate: dates.sort().at(-1),
        warnings: [
          reason,
          '실시간 조회가 실패해 이전에 실제 E-UM API에서 수집한 보관 자료를 표시해요. 현재 날씨를 나타내지 않아요.',
        ],
      };
    } catch {
      throw new BridgeError(502, 'EUM_UNAVAILABLE', `${reason} 보관된 실측 자료도 읽지 못했어요.`);
    }
  }

  async function readUpstream(signal: AbortSignal): Promise<CachedData> {
    if (cache && Date.now() - cache.storedAt < 30000) return cache.data;
    let data: CachedData;
    try {
      data = await readLive(signal);
    } catch (error) {
      signal.throwIfAborted();
      data = await readArchive(
        error instanceof BridgeError ? error.message : 'E-UM 실시간 조회에 실패했어요.',
      );
    }
    signal.throwIfAborted();
    cache = { storedAt: Date.now(), data };
    return data;
  }

  return {
    async snapshot(signal: AbortSignal, deviceId?: string): Promise<LiveSnapshot> {
      signal.throwIfAborted();
      const data = await readUpstream(signal);
      signal.throwIfAborted();
      if (deviceId && !data.devices.some((device) => device.id === deviceId)) {
        throw new BridgeError(
          400,
          'UNKNOWN_DEVICE',
          '선택한 관측기를 E-UM 목록에서 찾을 수 없어요.',
        );
      }
      const observations = data.devices.map((device) =>
        normalizeObservation(
          device,
          data.rows.get(device.id),
          Date.now(),
          config.timezoneOffset,
          config.staleAfterMinutes,
        ),
      );
      if (data.status === 'archived') {
        for (const observation of observations) {
          if (observation.status !== 'invalid') observation.status = 'stale';
          observation.issues.push('보관된 과거 실측 자료예요. 현재 환경 판단에 사용할 수 없어요.');
        }
      }
      const warnings = [...data.warnings];
      if (
        observations.some((observation) =>
          observation.issues.some((issue) => issue.includes('시간대가 없어')),
        )
      ) {
        warnings.push(
          `시간대가 없는 원천 시각은 ${config.timezoneOffset}으로 해석했어요. 장비별 시간대 확인 전에는 경과 시간이 달라질 수 있어요.`,
        );
      }
      warnings.push(
        '관측기 위치는 실제 E-UM 정보예요. 실제 덕장 좌표와 검증된 건조 판정 기준이 없어 건조 적합 여부를 판정하지 않아요.',
      );
      return {
        fetchedAt: data.fetchedAt,
        source: data.status === 'archived' ? 'E-UM 보관된 실측' : '포항 E-UM · 대기환경 관측 API',
        sourceUrl: `${EUM_BASE}${REALTIME_PATH}`,
        devices: data.devices,
        observations,
        selected: selectObservation(observations, deviceId),
        warnings,
        status: data.status,
        ...(data.archiveSourceDate ? { archiveSourceDate: data.archiveSourceDate } : {}),
        llm: llmStatus(config),
      };
    },
  };
}
