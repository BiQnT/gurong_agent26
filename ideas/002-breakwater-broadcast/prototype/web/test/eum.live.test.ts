import { describe, expect, it } from "vitest";
import {
  abnormalTotal,
  airRealtime,
  hasCoords,
  pedestrianDevices,
  snapshot,
  uvIndex,
  zoneOf,
} from "../lib/eum";

/**
 * **실호출 테스트다.** 목을 쓰지 않는다.
 *
 * 대회 요건이 "디지털 트윈 데이터를 최소 1개 이상 실제 호출"이고, 심사 배점
 * 25점이 실현 가능성이다. 목으로 통과하는 테스트는 그 둘 중 어느 것도 증명하지
 * 못한다. 네트워크나 E-UM 이 죽으면 이 테스트도 같이 실패해야 맞다.
 *
 * 기대값(스피커 8대 / AI CCTV 15대)은 2026-08-03 실측이다. E-UM 이 장비를
 * 추가하면 이 테스트가 깨지는데, 그때는 깨지는 것이 옳다 — 데이터가 변했다는
 * 신호이고 data.md 를 갱신해야 한다는 뜻이다.
 */

const TIMEOUT = 30_000;

describe("INT_S06_001 — 보행자안전 장비 목록", () => {
  it(
    "스피커 8대와 AI CCTV 15대를 실제로 받아온다",
    async () => {
      const devices = await pedestrianDevices();

      console.log(
        `  스피커 ${devices.speakers.length}대 / AI CCTV ${devices.ai_cctvs.length}대 / 자외선기 ${devices.uv_devices.length}대`,
      );
      for (const s of devices.speakers) console.log(`    스피커: ${s.name}`);

      expect(devices.speakers).toHaveLength(8);
      expect(devices.ai_cctvs).toHaveLength(15);
      expect(devices.uv_devices.length).toBeGreaterThanOrEqual(1);
      expect(devices.speakers.some((s) => s.name.includes("구룡포 북방파제"))).toBe(true);
      expect(devices.speakers.some((s) => s.name.includes("구룡포 남방파제"))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "좌표가 빈 장비가 있고 hasCoords 로 걸러진다 (실측: SG-10-001)",
    async () => {
      const { speakers } = await pedestrianDevices();
      const withCoords = speakers.filter(hasCoords);
      console.log(`  좌표 있는 스피커 ${withCoords.length}/${speakers.length}대`);
      expect(withCoords.length).toBeLessThan(speakers.length);
      expect(withCoords.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "장비명으로 남/북 방파제를 가를 수 있다",
    async () => {
      const { speakers } = await pedestrianDevices();
      const zones = speakers.map(zoneOf);
      expect(zones).toContain("north");
      expect(zones).toContain("south");
    },
    TIMEOUT,
  );
});

describe("INT_S01_004 — 대기환경 실시간 (기상 소스)", () => {
  it(
    "기온·습도·풍속·풍향이 숫자로 온다",
    async () => {
      const air = await airRealtime();
      console.log(
        `  ${air.logDateTime} · 기온 ${air.temp}℃ · 습도 ${air.humi}% · 풍속 ${air.winsp} · 풍향 ${air.windir}`,
      );
      expect(typeof air.temp).toBe("number");
      expect(typeof air.humi).toBe("number");
      expect(typeof air.winsp).toBe("number");
      expect(typeof air.windir).toBe("number");
      expect(air.logDateTime).toMatch(/^\d{4}-\d{2}-\d{2}/);
      // 구룡포 기온이 이 범위를 벗어나면 필드 매핑이 틀린 것이다.
      expect(air.temp).toBeGreaterThan(-30);
      expect(air.temp).toBeLessThan(50);
    },
    TIMEOUT,
  );
});

describe("INT_S06_005 — 자외선 실시간", () => {
  it(
    "측정 시각과 지수가 온다",
    async () => {
      const uv = await uvIndex();
      console.log(`  ${uv.dateTime} · 자외선지수 ${uv.uvIndex}`);
      expect(typeof uv.uvIndex).toBe("number");
      expect(uv.uvIndex).toBeGreaterThanOrEqual(0);
    },
    TIMEOUT,
  );
});

describe("snapshot — 판정 입력 묶음", () => {
  it(
    "장비·기상·자외선·이상행동을 한 번에 모은다",
    async () => {
      const snap = await snapshot();
      expect(snap.devices.speakers.length).toBeGreaterThan(0);
      expect(snap.fetchedAt).toBeTruthy();

      if ("error" in snap.abnormal) {
        console.log(`  이상행동: 호출 실패 — ${snap.abnormal.error}`);
      } else {
        console.log(
          `  이상행동 검출 합계 ${snap.abnormal.total}건 · 검출 가동 ${snap.abnormal.detectorLive}`,
        );
        // 2026-08-03 기준 미가동. 살아나면 이 로그로 즉시 알 수 있다.
        expect(snap.abnormal.total).toBe(abnormalTotal(snap.abnormal));
      }
    },
    TIMEOUT,
  );
});
