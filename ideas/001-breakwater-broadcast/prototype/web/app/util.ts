import type { Device } from "@/lib/eum";

/**
 * 좌표가 있는 장비인가 — 클라이언트용 사본.
 *
 * `lib/eum.ts` 의 `hasCoords` 와 같은 판정이지만 여기 따로 둔다. 그쪽을 값으로
 * import 하면 `lib/env.ts` 의 `node:fs` 가 클라이언트 번들로 딸려 들어간다.
 *
 * 실측상 스피커 `구룡포 남방파제 SG-10-001` 의 위경도가 빈 문자열이라 필요하다.
 */
export function hasCoordsClient(d: Device): boolean {
  return Boolean(String(d.latitude ?? "").trim() && String(d.longitude ?? "").trim());
}
