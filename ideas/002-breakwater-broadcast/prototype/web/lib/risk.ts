import { ZONE_LABEL, ZONES, type AirReading, type Snapshot, type Zone } from "./eum";

/**
 * 규칙 기반 위험도 판정.
 *
 * **이 파일에 LLM 호출이 없다.** 경보를 낼지 말지를 LLM 이 정하면 환각이 안전
 * 판단에 끼어들고, 심사에서 "왜 그 시점에 경보가 나갔는지" 설명할 수 없게 된다.
 * LLM 은 판정 결과를 받아 방송 문안을 쓰는 일만 한다 (`agent.ts`).
 *
 * **임계값과 등급 매핑은 출처가 다르다. 섞어서 말하면 안 된다.**
 *
 * - *임계값* (14 m/s, 자외선 8, 33℃ …) 은 전부 기상청 공인 기준이다.
 *   우리가 지어낸 숫자가 없고, 공인 근거가 없는 중간 단계도 넣지 않았다.
 * - *등급 매핑* (기상청 '주의보' 를 우리 4단계 중 어디에 놓을 것인가) 은
 *   **팀 판단이다.** 기상청은 "방파제 스피커로 방송할 것인가" 를 정해주지
 *   않는다. 그래서 각 사유는 `levelRationale` 로 왜 그 등급인지를 함께 싣고,
 *   화면에도 그대로 노출한다.
 *
 * 실측 분포를 며칠 수집한 뒤 재조정하는 것이 다음 과제다.
 */

/** 낮은 순서대로. 최종 등급은 개별 사유 중 가장 높은 것을 따른다. */
export const LEVELS = ["safe", "caution", "warning", "danger"] as const;
export type RiskLevel = (typeof LEVELS)[number];

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  safe: "안전",
  caution: "주의",
  warning: "경고",
  danger: "위험",
};

export type Reason = {
  /** 어떤 지표인가 */
  metric: "wind" | "uv" | "temperature";
  level: RiskLevel;
  /** 실측값 */
  measured: number;
  unit: string;
  /** 넘어선 임계값 */
  threshold: number;
  /** 사람이 읽는 설명 */
  message: string;
  /** **임계값**의 출처. 근거 없는 숫자를 쓰지 않기 위해 필수 필드로 뒀다. */
  source: string;
  /**
   * 이 사유를 왜 그 **등급**에 놓았는가 — 팀 판단이다.
   *
   * 기상청은 특보 등급까지만 정해주고 "방파제 스피커로 방송할 것인가" 는
   * 정해주지 않는다. `shouldBroadcast()` 가 warning 이상에서만 참이므로
   * 방송 여부를 실제로 가르는 건 임계값이 아니라 이 매핑이다. 숨기면 안 된다.
   */
  levelRationale: string;
};

export type Assessment = {
  level: RiskLevel;
  reasons: Reason[];
  /** 판정이 무엇을 못 보고 있는지. 화면에 그대로 노출한다. */
  limitations: string[];
  assessedAt: string;
  /**
   * 구역별 판정. 방파제에 붙은 대기환경 측정기로 남/북을 따로 본다.
   *
   * 이게 있어야 **코드가** 어느 스피커에 방송할지 정할 수 있다. 예전에는
   * 관측소를 하나만 부르고 있어서 구역을 가를 근거가 없었고, 그 자리를 LLM 이
   * 근거 없이 메우고 있었다 (`design/agent-loop.md` 1.1).
   */
  zones: ZoneAssessment[];
};

export type ZoneAssessment = {
  zone: Zone;
  label: string;
  level: RiskLevel;
  reasons: Reason[];
  /** 이 구역에서 값을 낸 측정기 수. 0 이면 판정 근거가 없다. */
  sensorCount: number;
};

// --- 임계값 -------------------------------------------------------------

/**
 * 기상청 강풍 특보 발표 기준 (육상).
 * 주의보: 풍속 14m/s 이상 또는 순간풍속 20m/s 이상
 * 경보:   풍속 21m/s 이상 또는 순간풍속 26m/s 이상
 * 출처: 기상청 기상특보 발표기준 https://www.kma.go.kr/kma/biz/forecast03.jsp
 *
 * 해상(풍랑) 주의보도 14m/s 로 같아서 방파제에 그대로 적용할 수 있다.
 * INT_S01_004 는 순간풍속을 주지 않으므로 평균풍속 기준만 쓴다.
 */
const WIND_ADVISORY = 14; // m/s — 강풍주의보
const WIND_WARNING = 21; // m/s — 강풍경보

/**
 * 기상청 자외선지수 단계.
 * 낮음 0~2 / 보통 3~5 / 높음 6~7 / 매우높음 8~10 / 위험 11 이상
 * 출처: 기상청 생활기상정보 https://www.weather.go.kr/w/theme/daily-life/life-weather-info-index.do
 */
const UV_HIGH = 6;
const UV_VERY_HIGH = 8;
const UV_EXTREME = 11;

/**
 * 기상청 폭염 특보 발표기준 — 주의보 33℃, 경보 35℃.
 *
 * 주의: 공식 기준은 **일 최고 체감온도**가 이틀 이상 지속될 때다. 우리는
 * 순간 기온만 갖고 있어 엄밀히 같은 값이 아니다. 그래도 방파제 장시간 체류
 * 위험을 표시하는 참고선으로는 유효해서 쓰되, 이 차이를 limitations 에 적는다.
 * 출처: 기상청 기상특보 발표기준 https://www.kma.go.kr/kma/biz/forecast03.jsp
 */
const HEAT_ADVISORY = 33; // ℃
const HEAT_WARNING = 35; // ℃

// --- 판정 ---------------------------------------------------------------

function maxLevel(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>(
    (acc, l) => (LEVELS.indexOf(l) > LEVELS.indexOf(acc) ? l : acc),
    "safe",
  );
}

/**
 * 값이 판정에 쓸 수 있는 숫자인가.
 *
 * E-UM 이 200 을 주면서 필드만 null 로 비우는 경우가 있다. 그냥 `>=` 비교에
 * 태우면 null·NaN 이 "임계 미만"과 구별 없이 통과해서 **확신에 찬 '안전'**
 * 판정이 나간다. 안전 판정 코드에서 제일 나쁜 실패 형태라 앞에서 막는다.
 */
export function isUsable(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 풍속 사유. 임계 미만이거나 값이 결손이면 null. */
export function windReason(winsp: unknown): Reason | null {
  if (!isUsable(winsp)) return null;
  const base = {
    metric: "wind" as const,
    measured: winsp,
    unit: "m/s",
    source: "기상청 강풍 특보 발표기준 (육상)",
  };
  if (winsp >= WIND_WARNING) {
    return {
      ...base,
      level: "danger",
      threshold: WIND_WARNING,
      message: `풍속 ${winsp}m/s — 강풍경보 기준(${WIND_WARNING}m/s) 이상. 방파제 진입 금지 수준`,
      levelRationale:
        "강풍경보를 danger 로 둔 것은 팀 판단이다. 이 풍속에서 테트라포드 위 실족은 즉시 생명 위험이다.",
    };
  }
  if (winsp >= WIND_ADVISORY) {
    return {
      ...base,
      level: "warning",
      threshold: WIND_ADVISORY,
      message: `풍속 ${winsp}m/s — 강풍주의보 기준(${WIND_ADVISORY}m/s) 이상. 테트라포드 위 매우 위험`,
      levelRationale:
        "강풍주의보를 warning(방송)으로 둔 것은 팀 판단이다. 폭염주의보(caution)보다 높게 잡은 이유는 " +
        "낙상·추락이 즉각적인 반면 온열질환은 누적 노출이라 즉시 대피 방송의 실익이 다르기 때문이다.",
    };
  }
  return null;
}

/** 자외선 사유. 임계 미만이거나 값이 결손이면 null. */
export function uvReason(uvIndex: unknown): Reason | null {
  if (!isUsable(uvIndex)) return null;
  const base = {
    metric: "uv" as const,
    measured: uvIndex,
    unit: "",
    source: "기상청 자외선지수 단계",
  };
  if (uvIndex >= UV_EXTREME) {
    return {
      ...base,
      level: "warning",
      threshold: UV_EXTREME,
      message: `자외선지수 ${uvIndex} — '위험' 단계(${UV_EXTREME} 이상). 야외 활동 자제`,
      levelRationale:
        "'위험' 단계만 warning(방송)으로 둔 것은 팀 판단이다. 자외선은 즉각적 생명 위험이 아니라 " +
        "누적 노출 위험이므로 풍속과 같은 등급을 주지 않았다.",
    };
  }
  if (uvIndex >= UV_HIGH) {
    const veryHigh = uvIndex >= UV_VERY_HIGH;
    return {
      ...base,
      level: "caution",
      threshold: veryHigh ? UV_VERY_HIGH : UV_HIGH,
      message: veryHigh
        ? `자외선지수 ${uvIndex} — '매우높음' 단계(${UV_VERY_HIGH}~10). 장시간 체류 위험`
        : `자외선지수 ${uvIndex} — '높음' 단계(${UV_HIGH}~7). 그늘 이용 권장`,
      levelRationale:
        "'높음'·'매우높음'을 caution(무방송)으로 둔 것은 팀 판단이다. 한국 한여름 정오에는 지수 8이 " +
        "일상적이라 이 단계에서 방송하면 매일 방송이 나가 경보가 무뎌진다.",
    };
  }
  return null;
}

/** 기온 사유. 임계 미만이거나 값이 결손이면 null. */
export function temperatureReason(temp: unknown): Reason | null {
  if (!isUsable(temp)) return null;
  const base = {
    metric: "temperature" as const,
    measured: temp,
    unit: "℃",
    source: "기상청 폭염 특보 발표기준 (체감온도 기준을 순간 기온에 준용)",
  };
  if (temp >= HEAT_WARNING) {
    return {
      ...base,
      level: "warning",
      threshold: HEAT_WARNING,
      message: `기온 ${temp}℃ — 폭염경보 기준(${HEAT_WARNING}℃) 이상. 방파제 장시간 체류 위험`,
      levelRationale:
        "폭염경보를 warning(방송)으로 둔 것은 팀 판단이다. 그늘이 없는 방파제에서 이 기온은 " +
        "온열질환 위험이 실질적이다.",
    };
  }
  if (temp >= HEAT_ADVISORY) {
    return {
      ...base,
      level: "caution",
      threshold: HEAT_ADVISORY,
      message: `기온 ${temp}℃ — 폭염주의보 기준(${HEAT_ADVISORY}℃) 이상`,
      levelRationale:
        "폭염주의보를 caution(무방송)으로 둔 것은 팀 판단이다. 온열질환은 누적 노출 위험이라 " +
        "즉시 대피 방송의 실익이 낙상 위험보다 낮다.",
    };
  }
  return null;
}

/**
 * 데이터가 이보다 오래되면 판정을 신뢰하지 않는다.
 *
 * `INT_S01_004` 는 실측상 1분 주기로 갱신된다. 공공 센서망은 장비가 죽어도
 * API 가 마지막 값을 계속 되돌려주는 일이 흔한데, 그러면 며칠 묵은 풍속으로
 * 확신에 찬 '안전' 판정이 나간다. 30분이면 1분 주기 대비 충분히 넉넉하다.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

/** 몇 분 전 데이터인가. 파싱 실패하면 null. */
export function ageMinutes(timestamp: string | undefined, tz: "utc" | "kst"): number | null {
  if (!timestamp) return null;
  // E-UM 은 `2026-08-02 15:45:05` 형태로 준다. 오프셋이 없어 직접 붙여야 한다.
  const offset = tz === "utc" ? "Z" : "+09:00";
  const t = Date.parse(`${timestamp.trim().replace(" ", "T")}${offset}`);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60_000;
}

/**
 * 타임존이 안 적힌 E-UM 시각의 경과 시간. **같은 API 안에서도 타임존이 섞인다.**
 *
 * `INT_S01_003`(실시간 전체) 한 응답에서 대부분의 장비는 UTC 로 오는데
 * `devId 14·15·21` 만 KST 로 온다. 실측이다. 어느 쪽인지 필드로는 알 수 없다.
 *
 * 그래서 UTC 로 먼저 읽고, 결과가 **미래**로 나오면(=음수 경과) KST 로 다시 읽는다.
 * 측정 시각이 미래일 수는 없으니 이 판별은 안전하다. 시계 오차를 감안해
 * 2분까지는 미래를 허용한다.
 */
export function ageMinutesAuto(timestamp: string | undefined): number | null {
  const asUtc = ageMinutes(timestamp, "utc");
  if (asUtc === null) return null;
  if (asUtc >= -2) return asUtc;
  return ageMinutes(timestamp, "kst");
}

/**
 * 한 구역의 측정기들을 하나의 판정으로 모은다.
 *
 * 여러 대가 있으면 **가장 나쁜 값**을 쓴다. 평균을 내면 한 대가 강풍을 잡아도
 * 나머지에 희석돼 경보가 안 나간다. 안전 판정은 보수적이어야 한다.
 */
export function assessZone(zone: Zone, readings: AirReading[], uvIndex: unknown): ZoneAssessment {
  const live = readings.filter((r) => ageMinutesAuto(r.logDateTime) !== null);
  const reasons: Reason[] = [];

  const winds = live.map((r) => r.winsp).filter(isUsable);
  if (winds.length) {
    const w = windReason(Math.max(...winds));
    if (w) reasons.push(w);
  }

  const temps = live.map((r) => r.temp).filter(isUsable);
  if (temps.length) {
    const t = temperatureReason(Math.max(...temps));
    if (t) reasons.push(t);
  }

  // 자외선 측정기는 1대뿐이라 구역별 값이 없다. 같은 값을 양쪽에 적용한다.
  const u = uvReason(uvIndex);
  if (u) reasons.push(u);

  return {
    zone,
    label: ZONE_LABEL[zone],
    level: maxLevel(reasons.map((r) => r.level)),
    reasons,
    sensorCount: live.length,
  };
}

/** 스냅샷 하나를 위험도로 환산한다. 순수 함수 — 네트워크도 LLM 도 쓰지 않는다. */
export function assessRisk(snap: Snapshot): Assessment {
  const reasons: Reason[] = [];
  const limitations: string[] = [];

  if ("error" in snap.air) {
    limitations.push(`기상 데이터를 못 받았다 (${snap.air.error}). 풍속·기온 판정 불가.`);
  } else {
    const wind = windReason(snap.air.winsp);
    if (wind) reasons.push(wind);
    else if (!isUsable(snap.air.winsp)) {
      limitations.push("풍속 값이 결손이라(null/NaN) 강풍 판정을 하지 못했다.");
    }

    const temp = temperatureReason(snap.air.temp);
    if (temp) reasons.push(temp);
    else if (!isUsable(snap.air.temp)) {
      limitations.push("기온 값이 결손이라(null/NaN) 폭염 판정을 하지 못했다.");
    }

    // INT_S01_004 의 logDateTime 은 UTC 다 (INT_S06_005 는 KST — 두 API 가 다르다).
    const age = ageMinutes(snap.air.logDateTime, "utc");
    if (age === null) {
      limitations.push(`기상 측정 시각을 해석하지 못했다 (${snap.air.logDateTime}).`);
    } else if (age > STALE_AFTER_MS / 60_000) {
      limitations.push(
        `기상 데이터가 ${Math.round(age)}분 전 값이다. 센서가 멈췄을 수 있으니 판정을 신뢰하지 말 것.`,
      );
    }
  }

  if ("error" in snap.uv) {
    limitations.push(`자외선 데이터를 못 받았다 (${snap.uv.error}).`);
  } else {
    const uv = uvReason(snap.uv.uvIndex);
    if (uv) reasons.push(uv);
    else if (!isUsable(snap.uv.uvIndex)) {
      limitations.push("자외선 값이 결손이라(null/NaN) 자외선 판정을 하지 못했다.");
    }
    limitations.push(
      "자외선 측정기가 1대(병포리, 내륙)뿐이라 방파제 실측이 아니다. 전 구역에 같은 값을 적용했다.",
    );
  }

  if ("error" in snap.abnormal) {
    limitations.push(`이상행동 데이터를 못 받았다 (${snap.abnormal.error}).`);
  } else if (!snap.abnormal.detectorLive) {
    limitations.push(
      "AI CCTV 이상행동 검출이 가동되지 않고 있다 (INT_S06_006 검출 0건). " +
        "지금 방파제에 사람이 있는지를 판정에 반영하지 못한다.",
    );
  }

  limitations.push(
    "파고·조위가 E-UM 전체에 없어 월파 위험을 직접 보지 못한다. 풍속으로 대리한다.",
  );
  limitations.push(
    "폭염 기준은 원래 일 최고 체감온도 기준인데 순간 기온에 준용했다. 엄밀히 같은 값이 아니다.",
  );

  // --- 구역별 판정 -------------------------------------------------------
  const uvValue = "error" in snap.uv ? undefined : snap.uv.uvIndex;
  let zones: ZoneAssessment[] = [];

  if ("error" in snap.airZones) {
    limitations.push(
      `구역별 대기환경을 못 받았다 (${snap.airZones.error}). 남/북을 나눠 보지 못하고 대표값 하나로 판정했다.`,
    );
  } else {
    const byZone = snap.airZones;
    zones = ZONES.map((z) => assessZone(z, byZone[z], uvValue));
    for (const z of zones) {
      if (z.sensorCount === 0) {
        limitations.push(`${z.label}에서 값을 낸 측정기가 없다. 이 구역은 판정 근거가 없다.`);
      }
    }
  }

  // 구역 판정이 있으면 그쪽이 더 정확하다 — 더 높은 등급을 최종으로 삼는다.
  const zoneLevel = maxLevel(zones.map((z) => z.level));
  const flatLevel = maxLevel(reasons.map((r) => r.level));

  return {
    level: maxLevel([zoneLevel, flatLevel]),
    reasons,
    limitations,
    assessedAt: new Date().toISOString(),
    zones,
  };
}

/** 방송이 필요한 구역만 돌려준다. **코드가 대상을 정하는 지점이다.** */
export function zonesNeedingBroadcast(a: Assessment): Zone[] {
  const need = a.zones.filter((z) => z.level === "warning" || z.level === "danger");
  if (need.length) return need.map((z) => z.zone);
  // 구역 판정이 없는데 전체 등급이 높으면(대표값만 있는 경우) 전 구역에 보낸다.
  return shouldBroadcast(a) ? [...ZONES] : [];
}

/** 방송을 권고할 등급인가. safe/caution 에서는 방송하지 않는다. */
export function shouldBroadcast(a: Assessment): boolean {
  return a.level === "warning" || a.level === "danger";
}
