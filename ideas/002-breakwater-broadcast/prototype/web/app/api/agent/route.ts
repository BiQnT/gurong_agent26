import { runAgent } from "@/lib/agent";
import { isScenario } from "@/lib/scenario";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent — 자연어 질의를 받아 위험 판정과 방송 문안을 돌려준다.
 *
 * body: { "q": "지금 방송 내보내야 하나?", "scenario": "storm" }
 *
 * 위험 판정은 규칙이 하고 LLM 은 문안 작성과 설명만 한다. Gemini 가 실패하면
 * 규칙 기반 폴백으로 응답하고 `fallback: true` 로 그 사실을 알린다.
 * `scenario` 는 시연용이며, 쓰면 응답의 `simulation` 에 그 사실이 남는다.
 */
export async function POST(request: Request) {
  let question: string;
  let scenario: string | undefined;
  try {
    const body = (await request.json()) as { q?: unknown; scenario?: unknown };
    question = typeof body.q === "string" ? body.q.trim() : "";
    scenario = typeof body.scenario === "string" ? body.scenario : undefined;
  } catch {
    return Response.json(
      { error: 'JSON 본문이 필요하다. 예: {"q":"지금 방송 내보내야 하나?"}' },
      { status: 400 },
    );
  }

  if (!question) {
    return Response.json({ error: "q 가 비어 있다" }, { status: 400 });
  }

  try {
    return Response.json(await runAgent(question, isScenario(scenario) ? scenario : undefined));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
