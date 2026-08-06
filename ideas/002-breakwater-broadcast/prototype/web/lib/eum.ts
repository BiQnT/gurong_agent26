import { requireEnv } from "./env";

/**
 * E-UM 디지털트윈 포항 Open API 클라이언트 (서버 전용).
 *
 * 실호출로 검증한 API만 쓴다. 판정 근거와 요청·응답 원문은
 * `ideas/002-breakwater-broadcast/data.md`.
 *
 * | API ID       | 기능                              | 판정  |
 * | ------------ | --------------------------------- | ----- |
 * | INT_S06_001  | 보행자안전 장비 목록              | 사용  |
 * | INT_S06_005  | 자외선 실시간                     | 사용  |
 * | INT_S01_004  | 대기환경 실시간 (기온·습도·풍속)  | 사용  |
 * | INT_S06_006  | 이상행동 발생수                   | 표시용 (검출 미가동) |
 */

const BASE = "https://genix.pohang-eum.kr";

export class EumError extends Error {}

/**
 * E-UM 공통 응답 껍데기. 일부 API(INT_S01_011 등)는 껍데기 없이
 * 값을 바로 돌려주므로 status 가 없을 수도 있다.
 */
type Envelope<T> = { id?: string; status?: string; data?: T };

/**
 * `GET {BASE}{path}` 호출 후 `data` 를 돌려준다.
 *
 * **serviceKey 는 인코딩하지 않는다.** 발급 시점에 이미 URL 인코딩된
 * 문자열이라 URLSearchParams 에 넣으면 퍼센트 기호가 이중 인코딩돼
 * `401 유효하지 않은 이용자 서비스 키` 가 난다. 나머지 파라미터만 인코딩한다.
 */
async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = requireEnv("EUM_SERVICE_KEY");
  const rest = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${BASE}${path}?serviceKey=${key}${rest ? `&${rest}` : ""}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      // E-UM 값은 실시간이라 캐시하지 않는다.
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new EumError(`${path} 호출 실패: ${(e as Error).message}`);
  }

  const text = await res.text();
  let body: Envelope<T> | T;
  try {
    body = JSON.parse(text);
  } catch {
    throw new EumError(`${path} 응답이 JSON 이 아니다 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new EumError(`${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const env = body as Envelope<T>;
  if (env && typeof env === "object" && "status" in env) {
    if (env.status !== "success") {
      throw new EumError(`${path} 응답 실패: ${text.slice(0, 200)}`);
    }
    return env.data as T;
  }
  // 껍데기 없이 값을 바로 주는 엔드포인트
  return body as T;
}

// --- 타입 ---------------------------------------------------------------

export type Device = {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
  address: string;
  /** AI CCTV 만 갖는다. 실측상 전부 0 이라 방향 구분에 쓸 수 없다. */
  angle?: number;
};

export type PedestrianDevices = {
  uv_devices: Device[];
  speakers: Device[];
  ai_cctvs: Device[];
};

export type UvReading = { dateTime: string; uvIndex: number };

export type AirReading = {
  logDateTime: string;
  devId: number;
  /** 기온 ℃ */
  temp: number;
  /** 습도 % */
  humi: number;
  /** 풍속 m/s — 카탈로그에는 단위가 ℃ 로 잘못 적혀 있다 */
  winsp: number;
  /** 풍향 도(°) — 카탈로그에는 단위가 % 로 잘못 적혀 있다 */
  windir: number;
  pm10: number;
  pm25: number;
  [key: string]: number | string;
};

export type AbnormalRow = {
  hour: string;
  warningFallDetectionCount: number;
  warningInsideDetectionCount: number;
  warningApproachCount: number;
  normalFallDetectionCount: number;
};

export type AbnormalEvents = { south: AbnormalRow[]; north: AbnormalRow[] };

// --- API ----------------------------------------------------------------

/** INT_S06_001 — 자외선기·스피커·AI CCTV 목록이 한 번에 온다. */
export function pedestrianDevices(): Promise<PedestrianDevices> {
  return get<PedestrianDevices>("/dpg/pedestrian/device/list");
}

/** INT_S06_005 — 자외선 실시간. 측정기가 1대뿐이라 구역별 차이는 못 본다. */
export function uvIndex(deviceId: number = 1): Promise<UvReading> {
  return get<UvReading>("/dpg/sensor/latest/uvIndex", { id: deviceId });
}

/**
 * INT_S01_004 — 대기환경 실시간(단일). **기상 소스는 이 계열이다.**
 *
 * 이름은 '대기환경'인데 기온·습도·풍속·풍향이 다 들어 있다.
 * INT_S03_019(기상 이력)를 안 쓰는 이유는 날짜별로 구멍이 많아서다 (data.md).
 */
export function airRealtime(deviceId: number = 1): Promise<AirReading> {
  return get<AirReading>("/dpg/atmosphere/device/realtime", { id: deviceId });
}

/**
 * INT_S01_001 — 대기환경 측정 장비 목록. 위경도가 함께 온다.
 *
 * E-UM 자료실에는 등록돼 있지 않고 genix 에서 직접 확인된 API 다
 * (`research/api-tests/2026-08-04-atmosphere-undocumented-apis.md`).
 */
export function airDevices(): Promise<Device[]> {
  return get<Device[]>("/dpg/atmosphere/devices");
}

/** INT_S01_003 — 대기환경 실시간 전체. 24대를 한 번에 받는다. */
export function airRealtimeAll(): Promise<AirReading[]> {
  return get<AirReading[]>("/dpg/atmosphere/devices/realtime");
}

/**
 * 측정값이 살아 있는가.
 *
 * 실측에서 두 가지 죽은 패턴이 나왔다.
 * - `devId 7`: `logDateTime` 이 빈 문자열이고 기온·풍속·습도가 전부 0
 * - `devId 5`: `logDateTime` 이 빈 문자열 (값은 있지만 언제 것인지 모른다)
 *
 * 0 을 진짜 측정값으로 받으면 "풍속 0m/s = 안전"이 되므로 반드시 걸러야 한다.
 */
export function isLiveReading(r: AirReading): boolean {
  if (!String(r.logDateTime ?? "").trim()) return false;
  // 기온·습도가 동시에 정확히 0 이면 센서가 값을 못 내고 있는 것이다.
  if (r.temp === 0 && r.humi === 0) return false;
  return true;
}

/**
 * INT_S06_006 — AI CCTV 이상행동 발생수. **위험 판정 트리거로 쓰지 않는다.**
 *
 * 필드는 방파제 안전에 정확히 맞지만(추락·구역 진입·접근) 최근 60일 전수와
 * 2025-10~2026-07 월별 표본 모두 검출 0건이고, date 파라미터가 무시된 채
 * 항상 최근 10시간이 돌아온다. 검출 기능 미가동으로 보인다.
 *
 * 화면에는 "미가동" 상태를 정직하게 표시하기 위해 계속 호출한다.
 * 값이 살아나면 `abnormalTotal()` 이 0 이 아니게 되므로 바로 알 수 있다.
 */
export function abnormalEvents(): Promise<AbnormalEvents> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
  return get<AbnormalEvents>("/dpg/aicctv/avghour/datas", { date: yesterday });
}

/**
 * 이상행동 검출 합계. 0 이면 미가동으로 본다.
 *
 * 구역 키(south/north)가 늘어나거나 `total` 같은 파생 필드가 덧붙은 객체가
 * 들어와도 견디도록 배열 값만 훑는다.
 */
export function abnormalTotal(events: Partial<AbnormalEvents> & Record<string, unknown>): number {
  let sum = 0;
  for (const rows of Object.values(events)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as AbnormalRow[]) {
      for (const [key, value] of Object.entries(row)) {
        if (key !== "hour" && typeof value === "number") sum += value;
      }
    }
  }
  return sum;
}

/** 위경도가 빈 문자열인 장비를 걸러낸다. 실측상 스피커 SG-10-001 이 그렇다. */
export function hasCoords(d: Device): boolean {
  return Boolean(d.latitude?.trim() && d.longitude?.trim());
}

/** 장비명 앞부분으로 남/북 방파제를 가른다. 이상행동 API 의 south/north 와 맞춘다. */
export function zoneOf(d: Device): "north" | "south" | "unknown" {
  if (d.name?.includes("북방파제")) return "north";
  if (d.name?.includes("남방파제")) return "south";
  return "unknown";
}

export type Zone = "north" | "south";
export const ZONES: Zone[] = ["north", "south"];
export const ZONE_LABEL: Record<Zone, string> = { north: "북방파제", south: "남방파제" };

/** 좌표 비교용 키. E-UM 이 문자열로 주므로 소수 5자리에서 맞춘다. */
function coordKey(d: { latitude?: string | number; longitude?: string | number }): string | null {
  const lat = Number(d.latitude);
  const lon = Number(d.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/**
 * 대기환경 측정기를 남/북 방파제로 가른다.
 *
 * **실측 발견**: AI CCTV 15대가 **전부** 대기환경 측정기와 같은 좌표에 있다.
 * 북방파제 4개소(장비 id 6·7·11·16), 남방파제 4개소(10·14·15·17).
 * 즉 방파제 구역별 실측 풍속을 얻을 수 있다 — 초기 설계에서 "관측소가 1대라
 * 구역을 못 가른다"고 본 것은 `INT_S01_004` 를 id=1 하나로만 부른 탓이었다.
 *
 * 좌표 일치로 잇기 때문에 E-UM 이 장비를 옮기면 자동으로 따라간다.
 */
export function airByZone(
  airDevices: Device[],
  readings: AirReading[],
  cctvs: Device[],
): Record<Zone, AirReading[]> {
  const zoneByCoord = new Map<string, Zone>();
  for (const c of cctvs) {
    const k = coordKey(c);
    const z = zoneOf(c);
    if (k && (z === "north" || z === "south")) zoneByCoord.set(k, z);
  }

  const zoneByDevId = new Map<number, Zone>();
  for (const a of airDevices) {
    const k = coordKey(a);
    const z = k ? zoneByCoord.get(k) : undefined;
    if (z) zoneByDevId.set(a.id, z);
  }

  const out: Record<Zone, AirReading[]> = { north: [], south: [] };
  for (const r of readings) {
    const z = zoneByDevId.get(r.devId);
    if (z && isLiveReading(r)) out[z].push(r);
  }
  return out;
}

export type Snapshot = {
  fetchedAt: string;
  devices: PedestrianDevices;
  /** 대표 기상값 (구역 무관). 하위 호환과 요약 표시에 쓴다. */
  air: AirReading | { error: string };
  /** 구역별 대기환경 실측. 방파제에 붙은 측정기만 담긴다. */
  airZones: Record<Zone, AirReading[]> | { error: string };
  uv: UvReading | { error: string };
  abnormal: (AbnormalEvents & { total: number; detectorLive: boolean }) | { error: string };
};

/**
 * 위험 판정과 방송 문안 생성의 입력.
 *
 * 기상·자외선·이상행동은 개별 실패를 `{error}` 로 격리해서 하나가 죽어도
 * 나머지로 판정한다. 못 본 것은 `assessRisk` 가 limitations 에 남긴다.
 *
 * **장비 목록(`pedestrianDevices`)만은 격리하지 않는다.** 스피커를 모르면
 * 방송 대상을 정할 수 없어 이 서비스가 성립하지 않기 때문이다. 실패하면
 * 요청 전체가 502 로 떨어진다.
 */
export async function snapshot(): Promise<Snapshot> {
  const devices = await pedestrianDevices();

  const [zoneResult, air, uv, abnormal] = await Promise.all([
    Promise.all([airDevices(), airRealtimeAll()])
      .then(([list, readings]) => airByZone(list, readings, devices.ai_cctvs ?? []))
      .catch((e: Error) => ({ error: e.message })),
    airRealtime().catch((e: Error) => ({ error: e.message })),
    uvIndex(devices.uv_devices?.[0]?.id ?? 1).catch((e: Error) => ({ error: e.message })),
    abnormalEvents()
      .then((ev) => {
        const total = abnormalTotal(ev);
        return { ...ev, total, detectorLive: total > 0 };
      })
      .catch((e: Error) => ({ error: e.message })),
  ]);

  return { fetchedAt: new Date().toISOString(), devices, air, airZones: zoneResult, uv, abnormal };
}
