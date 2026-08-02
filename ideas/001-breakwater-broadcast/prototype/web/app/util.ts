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

/**
 * E-UM 시각 문자열을 화면용 KST 표기로 바꾼다.
 *
 * **API 마다 타임존이 다르다.** INT_S01_004(기상)의 `logDateTime` 은 UTC 이고
 * INT_S06_005(자외선)의 `dateTime` 은 KST 다. 실측으로 확인했다. 가공 없이
 * 그대로 띄우면 새벽에 관제 화면을 보는 사람이 9시간 전 데이터로 오해한다.
 */
export function toKst(timestamp: string | undefined, tz: "utc" | "kst"): string {
  if (!timestamp) return "—";
  const offset = tz === "utc" ? "Z" : "+09:00";
  const t = Date.parse(`${timestamp.trim().replace(" ", "T")}${offset}`);
  if (Number.isNaN(t)) return timestamp;
  const kst = new Date(t).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "short",
    timeStyle: "medium",
  });
  const mins = Math.round((Date.now() - t) / 60_000);
  const ago = mins < 1 ? "방금" : mins < 60 ? `${mins}분 전` : `${Math.round(mins / 60)}시간 전`;
  return `${kst} (${ago})`;
}
