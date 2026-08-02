import { requireEnv } from "./env";

/**
 * E-UM 디지털트윈 포항 Open API 클라이언트 (서버 전용).
 *
 * 실호출로 검증한 API만 쓴다. 판정 근거와 요청·응답 원문은
 * `ideas/001-breakwater-broadcast/data.md`.
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
 * INT_S01_004 — 대기환경 실시간. **기상 소스는 여기다.**
 *
 * 이름은 '대기환경'인데 기온·습도·풍속·풍향이 다 들어 있다.
 * INT_S03_019(기상 이력)를 안 쓰는 이유는 날짜별로 구멍이 많아서다 (data.md).
 */
export function airRealtime(deviceId: number = 1): Promise<AirReading> {
  return get<AirReading>("/dpg/atmosphere/device/realtime", { id: deviceId });
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

export type Snapshot = {
  fetchedAt: string;
  devices: PedestrianDevices;
  air: AirReading | { error: string };
  uv: UvReading | { error: string };
  abnormal: (AbnormalEvents & { total: number; detectorLive: boolean }) | { error: string };
};

/** 위험 판정과 방송 문안 생성의 입력. 개별 API 실패가 전체를 죽이지 않는다. */
export async function snapshot(): Promise<Snapshot> {
  const devices = await pedestrianDevices();

  const [air, uv, abnormal] = await Promise.all([
    airRealtime().catch((e: Error) => ({ error: e.message })),
    uvIndex(devices.uv_devices?.[0]?.id ?? 1).catch((e: Error) => ({ error: e.message })),
    abnormalEvents()
      .then((ev) => {
        const total = abnormalTotal(ev);
        return { ...ev, total, detectorLive: total > 0 };
      })
      .catch((e: Error) => ({ error: e.message })),
  ]);

  return { fetchedAt: new Date().toISOString(), devices, air, uv, abnormal };
}
