import { snapshot } from "@/lib/eum";
import { assessRisk, LEVEL_LABEL, shouldBroadcast } from "@/lib/risk";
import { applyScenario, isScenario, simulationInfo } from "@/lib/scenario";

export const dynamic = "force-dynamic";

/**
 * GET /api/assess — 규칙 기반 위험도 판정.
 *
 * LLM 을 쓰지 않는다. 임계값은 전부 기상청 공인 기준이고 각 사유에 출처가 붙는다.
 *
 * `?scenario=storm|gale|heatwave` 를 주면 시연용 기상값으로 대체한다.
 * 그때 응답의 `simulation` 이 채워진다 — 없으면 전부 실측이다.
 */
export async function GET(request: Request) {
  try {
    const name = new URL(request.url).searchParams.get("scenario");
    const live = await snapshot();
    const useScenario = isScenario(name);
    const snap = useScenario ? applyScenario(live, name) : live;
    const assessment = assessRisk(snap);

    return Response.json({
      ...assessment,
      levelLabel: LEVEL_LABEL[assessment.level],
      shouldBroadcast: shouldBroadcast(assessment),
      simulation: useScenario ? simulationInfo(name) : null,
      snapshot: snap,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
