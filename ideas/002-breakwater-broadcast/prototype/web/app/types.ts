import type { AgentResult } from "@/lib/agent";
import type { Assessment } from "@/lib/risk";
import type { RiskLevel } from "@/lib/risk";
import type { SimulationInfo } from "@/lib/scenario";
import { SCENARIOS } from "@/lib/scenario";
import type { Snapshot } from "@/lib/eum";

/**
 * 화면이 쓰는 타입.
 *
 * `lib/*` 에서 **타입만** 가져온다. 값을 가져오면 `lib/env.ts` 의 `node:fs` 가
 * 클라이언트 번들로 딸려 들어간다 (`server-only` 가 빌드를 깨뜨려 알려준다).
 *
 * 예외는 `SCENARIOS` 하나다. `lib/scenario.ts` 는 타입 외에 아무것도 import 하지
 * 않아서 클라이언트에서 값으로 써도 안전하다.
 */

/** 에이전트 응답. 서버 타입을 그대로 쓴다 — 손으로 베끼면 언젠가 어긋난다. */
export type AgentResponse = AgentResult;

export type AssessResponse = Assessment & {
  levelLabel: string;
  shouldBroadcast: boolean;
  simulation: SimulationInfo | null;
  snapshot: Snapshot;
};

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  safe: "안전",
  caution: "주의",
  warning: "경고",
  danger: "위험",
};

/** 등급별 배지 색. Tailwind 클래스라 문자열로 둔다. */
export const LEVEL_STYLE: Record<RiskLevel, string> = {
  safe: "bg-emerald-100 text-emerald-900 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  caution:
    "bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  warning:
    "bg-orange-100 text-orange-900 ring-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800",
  danger: "bg-red-100 text-red-900 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800",
};

/**
 * 시나리오 선택 목록. **`SCENARIOS` 에서 유도한다.**
 *
 * 손으로 적어두면 `lib/scenario.ts` 에 시나리오를 추가해도 화면에 안 뜬다.
 */
export const SCENARIO_OPTIONS = [
  { value: "", label: "실측 (E-UM 실시간)" },
  ...Object.entries(SCENARIOS).map(([value, s]) => ({ value, label: `시연: ${s.label}` })),
];
