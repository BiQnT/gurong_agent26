import { describe, expect, it } from "vitest";
import {
  assessRisk,
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

describe("uvReason — 기상청 자외선지수 단계 경계", () => {
  it("5 는 '보통' 이라 사유가 없다", () => {
    expect(uvReason(5)).toBeNull();
  });

  it("6 은 '높음' 이라 caution", () => {
    expect(uvReason(6)?.level).toBe("caution");
  });

  it("8 은 '매우높음' 이라 warning", () => {
    expect(uvReason(8)?.level).toBe("warning");
  });

  it("11 은 '위험' 이라 danger", () => {
    expect(uvReason(11)?.level).toBe("danger");
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

function snapshotWith(air: Partial<{ winsp: number; temp: number }>, uvIndex: number): Snapshot {
  return {
    fetchedAt: new Date().toISOString(),
    devices: { uv_devices: [], speakers: [], ai_cctvs: [] },
    air: {
      logDateTime: "2026-08-03 00:00:00",
      devId: 1,
      temp: air.temp ?? 20,
      humi: 60,
      winsp: air.winsp ?? 0,
      windir: 180,
      pm10: 10,
      pm25: 10,
    },
    uv: { dateTime: "2026-08-03 00:00:00", uvIndex },
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

  it("모든 사유에 출처가 붙어 있다 — 근거 없는 임계값을 막는 회귀 테스트", () => {
    const a = assessRisk(snapshotWith({ winsp: 22, temp: 36 }, 11));
    expect(a.reasons.length).toBeGreaterThan(0);
    for (const r of a.reasons) {
      expect(r.source.length).toBeGreaterThan(0);
      expect(typeof r.threshold).toBe("number");
    }
  });

  it("이상행동 검출이 죽어 있으면 한계로 명시한다", () => {
    const a = assessRisk(snapshotWith({ winsp: 2 }, 1));
    expect(a.limitations.some((l) => l.includes("이상행동"))).toBe(true);
  });

  it("기상 데이터가 없으면 판정 불가를 한계로 남긴다", () => {
    const snap = snapshotWith({}, 1);
    const broken: Snapshot = { ...snap, air: { error: "boom" } };
    const a = assessRisk(broken);
    expect(a.limitations.some((l) => l.includes("기상"))).toBe(true);
  });
});

describe("shouldBroadcast", () => {
  it("safe 와 caution 에서는 방송하지 않는다", () => {
    expect(shouldBroadcast(assessRisk(snapshotWith({ winsp: 2 }, 1)))).toBe(false);
    expect(shouldBroadcast(assessRisk(snapshotWith({ winsp: 2 }, 6)))).toBe(false);
  });

  it("warning 이상에서 방송을 권고한다", () => {
    expect(shouldBroadcast(assessRisk(snapshotWith({ winsp: 15 }, 1)))).toBe(true);
    expect(shouldBroadcast(assessRisk(snapshotWith({ winsp: 25 }, 1)))).toBe(true);
  });
});
