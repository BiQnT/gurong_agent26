import type { Broadcast } from "@/lib/agent";
import type { Snapshot } from "@/lib/eum";
import type { Assessment, RiskLevel } from "@/lib/risk";
import type { SimulationInfo } from "@/lib/scenario";

/**
 * 화면이 쓰는 타입.
 *
 * **전부 `import type` 이다.** 값을 가져오면 `lib/env.ts` 의 `node:fs` 가
 * 클라이언트 번들로 딸려 들어간다. 라벨 같은 상수는 아래에 따로 둔다.
 */
export type { Assessment, Broadcast, RiskLevel, SimulationInfo, Snapshot };

export type AssessResponse = Assessment & {
  levelLabel: string;
  shouldBroadcast: boolean;
  simulation: SimulationInfo | null;
  snapshot: Snapshot;
};

export type AgentResponse = {
  answer: string;
  assessment: Assessment;
  broadcast: Broadcast | null;
  fallback: boolean;
  fallbackReason?: string;
  modelUsed?: string;
  toolCalls: string[];
  simulation: SimulationInfo | null;
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
  caution: "bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  warning: "bg-orange-100 text-orange-900 ring-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800",
  danger: "bg-red-100 text-red-900 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800",
};

export const SCENARIO_OPTIONS = [
  { value: "", label: "실측 (E-UM 실시간)" },
  { value: "gale", label: "시연: 강풍주의보" },
  { value: "storm", label: "시연: 강풍경보" },
  { value: "heatwave", label: "시연: 폭염 + 자외선" },
] as const;
