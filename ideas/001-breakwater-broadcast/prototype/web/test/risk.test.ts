import { describe, expect, it } from "vitest";
import {
  ageMinutes,
  assessRisk,
  isUsable,
  shouldBroadcast,
  temperatureReason,
  uvReason,
  windReason,
} from "../lib/risk";
import type { Snapshot } from "../lib/eum";

describe("windReason — 기상청 강풍 특보 경계", () => {
  it("13.9 m/s 는 주의보 미만이라 사유가 없다", () => {
    expect(windReason(13.9)).toBeNull();
  });

  it("14 m/s 정확히 주의보 기준이면 warning", () => {
    const r = windReason(14);
    expect(r?.level).toBe("warning");
    expect(r?.threshold).toBe(14);
    expect(r?.source).toContain("기상청");
  });

  it("20.9 m/s 는 아직 경보 미만이라 warning 유지", () => {
    expect(windReason(20.9)?.level).toBe("warning");
  });

  it("21 m/s 정확히 경보 기준이면 danger", () => {
    const r = windReason(21);
    expect(r?.level).toBe("danger");
    expect(r?.threshold).toBe(21);
  });
});

describe("uvReason — 기상청 자외선지수 단계", () => {
  it("5 는 '보통' 이라 사유가 없다", () => {
    expect(uvReason(5)).toBeNull();
  });

  it("6 은 '높음' 이라 caution", () => {
    expect(uvReason(6)?.level).toBe("caution");
  });

  it("8 은 '매우높음' 이지만 caution 에 머문다 — 여름 정오마다 방송하지 않기 위해", () => {
    const r = uvReason(8);
    expect(r?.level).toBe("caution");
    expect(r?.levelRationale).toContain("일상적");
  });

  it("11 은 '위험' 이라 warning 까지만 올라간다 (풍속과 달리 누적 노출 위험)", () => {
    const r = uvReason(11);
    expect(r?.level).toBe("warning");
    expect(r?.levelRationale).toContain("누적");
  });
});

describe("temperatureReason — 기상청 폭염 특보 경계", () => {
  it("32.9℃ 는 주의보 미만", () => {
    expect(temperatureReason(32.9)).toBeNull();
  });

  it("33℃ 는 폭염주의보 기준이라 caution", () => {
    expect(temperatureReason(33)?.level).toBe("caution");
  });

  it("35℃ 는 폭염경보 기준이라 warning", () => {
    expect(temperatureReason(35)?.level).toBe("warning");
  });
});

describe("결손 값 방어 — 안전 판정에서 제일 위험한 실패", () => {
  it.each([undefined, null, NaN, "abc", Infinity])(
    "%s 는 판정에 쓸 수 없다",
    (bad) => {
      expect(isUsable(bad)).toBe(false);
    },
  );

  it.each([undefined, null, NaN, "abc"])(
    "풍속이 %s 면 '임계 미만'이 아니라 사유 없음으로 떨어진다",
    (bad) => {
      expect(windReason(bad)).toBeNull();
    },
  );

  it("풍속이 결손이면 assessRisk 가 한계로 남긴다 — 조용한 '안전' 방지", () => {
    const snap = snapshotWith({ winsp: null as unknown as number }, 1);
    const a = assessRisk(snap);
    expect(a.level).toBe("safe");
    expect(a.limitations.some((l) => l.includes("풍속 값이 결손"))).toBe(true);
  });
});

describe("ageMinutes — API 마다 타임존이 다르다", () => {
  it("UTC 문자열을 UTC 로 해석한다", () => {
    const utc = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19).replace("T", " ");
    const age = ageMinutes(utc, "utc");
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(4.5);
    expect(age!).toBeLessThan(6);
  });

  it("같은 문자열도 타임존을 잘못 잡으면 9시간 어긋난다 — 구분이 필요한 이유", () => {
    const s = new Date().toISOString().slice(0, 19).replace("T", " ");
    // KST 로 태그하면 그 순간이 9시간 앞이므로 경과 시간이 9시간 더 크게 나온다.
    expect(ageMinutes(s, "kst")! - ageMinutes(s, "utc")!).toBeCloseTo(540, 0);
  });

  it("해석 불가능하면 null", () => {
    expect(ageMinutes("어제", "utc")).toBeNull();
    expect(ageMinutes(undefined, "utc")).toBeNull();
  });
});

/** 지금 시각 기준 UTC 문자열. 신선도 검사에 걸리지 않게 한다. */
function freshUtc(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function snapshotWith(air: Partial<{ winsp: number; temp: number }>, uvIndex: number): Snapshot {
  return {
    fetchedAt: new Date().toISOString(),
    devices: { uv_devices: [], speakers: [], ai_cctvs: [] },
    air: {
      logDateTime: freshUtc(),
      devId: 1,
      temp: "temp" in air ? (air.temp as number) : 20,
      humi: 60,
      winsp: "winsp" in air ? (air.winsp as number) : 0,
      windir: 180,
      pm10: 10,
      pm25: 10,
    },
    uv: { dateTime: freshUtc(), uvIndex },
    abnormal: { south: [], north: [], total: 0, detectorLive: false },
  };
}

describe("assessRisk — 종합 판정", () => {
  it("전부 임계 미만이면 safe 이고 사유가 비어 있다", () => {
    const a = assessRisk(snapshotWith({ winsp: 2, temp: 20 }, 1));
    expect(a.level).toBe("safe");
    expect(a.reasons).toHaveLength(0);
  });

  it("가장 높은 사유가 최종 등급이 된다 (풍속 danger + 자외선 caution → danger)", () => {
    const a = assessRisk(snapshotWith({ winsp: 22, temp: 20 }, 6));
    expect(a.level).toBe("danger");
    expect(a.reasons.map((r) => r.metric).sort()).toEqual(["uv", "wind"]);
  });

  it("모든 사유에 임계값 출처와 등급 판단 근거가 붙어 있다", () => {
    const a = assessRisk(snapshotWith({ winsp: 22, temp: 36 }, 11));
    expect(a.reasons.length).toBeGreaterThan(0);
    for (const r of a.reasons) {
      expect(r.source.length).toBeGreaterThan(0);
      expect(r.levelRationale.length).toBeGreaterThan(0);
      expect(typeof r.threshold).toBe("number");
    }
  });

  it("이상행동 검출이 죽어 있으면 한계로 명시한다", () => {
    const a = assessRisk(snapshotWith({ winsp: 2 }, 1));
    expect(a.limitations.some((l) => l.includes("이상행동"))).toBe(true);
  });

  it("기상 데이터가 없으면 판정 불가를 한계로 남긴다", () => {
    const broken: Snapshot = { ...snapshotWith({}, 1), air: { error: "boom" } };
    const a = assessRisk(broken);
    expect(a.limitations.some((l) => l.includes("기상"))).toBe(true);
  });

  it("측정 시각이 오래되면 신뢰하지 말라고 남긴다 — 센서가 멈춰도 API 는 200 을 준다", () => {
    const stale = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
    const snap = snapshotWith({ winsp: 2 }, 1);
    const a = assessRisk({
      ...snap,
      air: { ...(snap.air as Record<string, unknown>), logDateTime: stale } as Snapshot["air"],
    });
    expect(a.limitations.some((l) => l.includes("분 전 값"))).toBe(true);
  });
});

describe("shouldBroadcast", () => {
  it("safe 와 caution 에서는 방송하지 않는다", () => {
    expect(shouldBroadcast(assessRisk(snapshotWith({ winsp: 2 }, 1)))).toBe(false);
    expect(shouldBroadcast(assessRisk(snapshotWith({ winsp: 2 }, 8)))).toBe(false);
  });

  it("warning 이상에서 방송을 권고한다", () => {
    expect(shouldBroadcast(assessRisk(snapshotWith({ winsp: 15 }, 1)))).toBe(true);
    expect(shouldBroadcast(assessRisk(snapshotWith({ winsp: 25 }, 1)))).toBe(true);
  });
});
