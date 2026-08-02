import type { Snapshot } from "./eum";

/**
 * 데모용 시나리오 주입.
 *
 * **왜 필요한가**: 이 에이전트는 위험할 때만 방송한다. 그런데 발표 당일 바람이
 * 안 불면 방송 경로를 하나도 못 보여준다. 실제로 2026-08-03 실측이 풍속 0m/s,
 * 자외선 0.3 이었다.
 *
 * **가짜 데이터가 아니다**: 장비 목록·좌표·스피커는 전부 E-UM 실호출 값 그대로다.
 * 기상 수치만 갈아끼우고, 응답과 화면에 `simulated` 를 반드시 표시한다.
 * 소방 훈련이 진짜 화재가 아닌 것과 같다 — 감추면 허위 기재지만 밝히면 시연이다.
 *
 * 기본값은 항상 실측이다. `?scenario=` 를 명시해야만 켜진다.
 */

/**
 * 시나리오가 채워야 하는 기상 필드. 넷 다 필수다.
 *
 * 하나라도 빠지면 `applyScenario` 가 `winsp: undefined` 인 스냅샷을 만들고,
 * 그건 판정에서 조용한 '안전' 으로 떨어진다. 타입으로 막는다.
 */
type ScenarioAir = { winsp: number; windir: number; temp: number; humi: number };

type ScenarioDef = {
  label: string;
  description: string;
  air: ScenarioAir;
  uv: { uvIndex: number };
};

// `satisfies` 라야 키 리터럴이 살아남아 ScenarioName 이 유니온으로 좁혀진다.
// `Record<string, …>` 로 주석을 달면 ScenarioName 이 string 으로 넓어진다.
export const SCENARIOS = {
  storm: {
    label: "강풍 (강풍경보 수준)",
    description: "2020년 태풍 마이삭 내습 시 구룡포 관측 수준을 상정한 값",
    air: { winsp: 22.4, windir: 275.1, temp: 21.3, humi: 88.0 },
    uv: { uvIndex: 1.2 },
  },
  gale: {
    label: "강풍주의보 수준",
    description: "강풍주의보 발령 직후를 상정한 값",
    air: { winsp: 15.6, windir: 268.0, temp: 24.0, humi: 74.0 },
    uv: { uvIndex: 3.0 },
  },
  heatwave: {
    label: "폭염 + 강한 자외선",
    description: "한여름 정오 방파제 체류 위험을 상정한 값",
    air: { winsp: 2.1, windir: 130.0, temp: 35.8, humi: 62.0 },
    uv: { uvIndex: 9.4 },
  },
} as const satisfies Record<string, ScenarioDef>;

export type ScenarioName = keyof typeof SCENARIOS;

export function isScenario(name: string | null | undefined): name is ScenarioName {
  return Boolean(name && name in SCENARIOS);
}

/** 기상·자외선 수치만 시나리오 값으로 갈아끼운다. 장비 정보는 실측 그대로 둔다. */
export function applyScenario(snap: Snapshot, name: ScenarioName): Snapshot {
  const s = SCENARIOS[name];
  const baseAir =
    "error" in snap.air
      ? { logDateTime: snap.fetchedAt, devId: 1, pm10: 0, pm25: 0 }
      : snap.air;

  return {
    ...snap,
    // ScenarioAir 가 4개 필드를 모두 강제하므로 결손이 생길 수 없다.
    air: { ...baseAir, ...s.air } as Snapshot["air"],
    uv: { dateTime: snap.fetchedAt, uvIndex: s.uv.uvIndex },
  };
}

export type SimulationInfo = {
  scenario: ScenarioName;
  label: string;
  description: string;
  notice: string;
};

export function simulationInfo(name: ScenarioName): SimulationInfo {
  return {
    scenario: name,
    label: SCENARIOS[name].label,
    description: SCENARIOS[name].description,
    notice:
      "시연용 가상 기상값입니다. 장비 목록과 좌표는 E-UM 실호출 값 그대로이며, " +
      "기온·풍속·자외선만 대체했습니다.",
  };
}
