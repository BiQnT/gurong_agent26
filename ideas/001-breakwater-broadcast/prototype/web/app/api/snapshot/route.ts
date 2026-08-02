import { snapshot } from "@/lib/eum";

/** E-UM 값은 실시간이라 절대 캐시하지 않는다. */
export const dynamic = "force-dynamic";

/**
 * GET /api/snapshot — 구룡포 방파제 현재 상황.
 *
 * 서버 전용이다. EUM_SERVICE_KEY 는 이 안에서만 쓰이고 응답 본문에 들어가지 않는다.
 */
export async function GET() {
  try {
    return Response.json(await snapshot());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
