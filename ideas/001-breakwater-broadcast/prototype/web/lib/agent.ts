import { GoogleGenAI, Type, type Content, type FunctionDeclaration } from "@google/genai";
import { readEnv } from "./env";
import { hasCoords, snapshot, zoneOf, type Device, type Snapshot } from "./eum";
import { assessRisk, LEVEL_LABEL, shouldBroadcast, type Assessment } from "./risk";
import { applyScenario, simulationInfo, type ScenarioName, type SimulationInfo } from "./scenario";

/**
 * 방파제 안내방송 에이전트.
 *
 * **경계**: 위험을 낼지 말지는 `risk.ts` 의 규칙이 정한다. LLM 은 그 판정을
 * 툴로 읽어서 (1) 방송 문안을 쓰고 (2) 사람 말로 설명하는 일만 한다.
 * 이 경계를 두는 이유는 경보 여부를 LLM 이 정하면 환각이 안전 판단에 끼어들고,
 * 심사에서 "왜 그 시점에 경보가 나갔는지" 설명할 수 없게 되기 때문이다.
 *
 * Gemini 가 죽어도 화면은 살아야 하므로 규칙 기반 폴백 문안을 갖고 있다.
 */

/** 무료 키에서 쓸 수 있는 순서대로. 앞이 실패하면 다음으로 넘어간다. */
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const MAX_TURNS = 6;

export type Broadcast = {
  zone: "north" | "south" | "all";
  korean: string;
  english: string;
  targetSpeakers: { id: number; name: string }[];
  /** 좌표가 없어 지도에 못 찍는 스피커. 정직하게 드러낸다. */
  speakersWithoutCoords: string[];
};

export type AgentResult = {
  answer: string;
  assessment: Assessment;
  broadcast: Broadcast | null;
  /** LLM 없이 규칙만으로 만든 결과인가 */
  fallback: boolean;
  fallbackReason?: string;
  modelUsed?: string;
  toolCalls: string[];
  /** 시연용 시나리오가 적용됐으면 그 정보. 실측이면 null. */
  simulation: SimulationInfo | null;
};

// --- 툴 구현 (전부 서버에서 실행된다) -----------------------------------

function speakersFor(snap: Snapshot, zone: string): Device[] {
  const all = snap.devices.speakers ?? [];
  if (zone === "all") return all;
  return all.filter((s) => zoneOf(s) === zone);
}

function buildBroadcast(
  snap: Snapshot,
  zone: "north" | "south" | "all",
  korean: string,
  english: string,
): Broadcast {
  const targets = speakersFor(snap, zone);
  return {
    zone,
    korean: korean.trim(),
    english: english.trim(),
    targetSpeakers: targets.filter(hasCoords).map((s) => ({ id: s.id, name: s.name })),
    speakersWithoutCoords: targets.filter((s) => !hasCoords(s)).map((s) => s.name),
  };
}

const DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "getSnapshot",
    description:
      "구룡포 방파제의 현재 상황을 가져온다. 기온·습도·풍속·풍향(INT_S01_004), 자외선지수(INT_S06_005), " +
      "AI CCTV 이상행동 검출 현황(INT_S06_006), 스피커·CCTV 장비 목록(INT_S06_001).",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "assessRisk",
    description:
      "현재 상황의 위험 등급을 규칙으로 판정한다. 기상청 강풍 특보·자외선지수 단계·폭염 특보 기준을 쓴다. " +
      "safe/caution/warning/danger 중 하나와 근거 목록, 그리고 이 판정이 못 보는 한계를 돌려준다. " +
      "위험 여부는 반드시 이 툴로 확인하고, 네가 직접 판단하지 마라.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "listSpeakers",
    description: "방송을 내보낼 수 있는 스피커 목록. zone 으로 남/북 방파제를 고를 수 있다.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        zone: {
          type: Type.STRING,
          description: "north(북방파제) / south(남방파제) / all(전체) 중 하나",
        },
      },
      required: ["zone"],
    },
  },
  {
    name: "draftBroadcast",
    description:
      "작성한 방송 문안을 실제 스피커에 묶어 확정한다. 한국어와 영어를 모두 넣어야 한다. " +
      "assessRisk 결과가 warning 또는 danger 일 때만 호출하라. safe/caution 에서는 방송하지 않는다.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        zone: { type: Type.STRING, description: "north / south / all" },
        korean: {
          type: Type.STRING,
          description: "한국어 방송 문안. 실제로 스피커로 읽힐 문장. 2~3문장.",
        },
        english: {
          type: Type.STRING,
          description: "영어 방송 문안. 외국인 관광객 대상. 2~3문장.",
        },
      },
      required: ["zone", "korean", "english"],
    },
  },
];

const SYSTEM = `너는 경상북도 포항시 구룡포 방파제의 안내방송 담당 공무원을 돕는 에이전트다.

지켜야 할 것:
- 위험 여부는 반드시 assessRisk 툴로 확인한다. 네가 수치를 보고 직접 판단하지 마라.
- assessRisk 가 warning 또는 danger 일 때만 draftBroadcast 를 호출한다.
  safe 나 caution 이면 방송하지 말고, 왜 방송이 필요 없는지 설명한다.
- 방송 문안은 실제로 스피커로 읽힐 문장이다. 짧고 명확하게, 존댓말로 쓴다.
  무엇이 위험한지와 무엇을 해야 하는지를 담는다.
- 답변에는 판정 근거(어떤 수치가 어떤 기준을 넘었는지)를 반드시 포함한다.
- assessRisk 가 돌려주는 limitations(이 판정이 못 보는 것)를 숨기지 말고 알린다.
  특히 AI CCTV 이상행동 검출이 가동되지 않아 지금 방파제에 사람이 있는지 모른다는 점.
- 데이터에 없는 것을 지어내지 마라. 파고나 조위는 우리에게 없다.`;

// --- 폴백 ---------------------------------------------------------------

function fallbackBroadcastText(a: Assessment): { korean: string; english: string } {
  const top = a.reasons[0];
  if (!top) {
    return {
      korean: "현재 기상 조건은 양호합니다. 안전에 유의하시기 바랍니다.",
      english: "Weather conditions are currently normal. Please stay safe.",
    };
  }
  if (top.metric === "wind") {
    return {
      korean:
        `안내 말씀드립니다. 현재 방파제 구간에 강한 바람이 불고 있습니다. ` +
        `테트라포드 위는 미끄러워 매우 위험하오니 즉시 내려와 주시기 바랍니다.`,
      english:
        `Attention. Strong winds at the breakwater. ` +
        `The tetrapods are slippery and dangerous. Please step away immediately.`,
    };
  }
  if (top.metric === "uv") {
    return {
      korean:
        `안내 말씀드립니다. 현재 자외선이 매우 강합니다. ` +
        `장시간 노출을 피하시고 그늘에서 휴식하시기 바랍니다.`,
      english:
        `Attention. UV levels are very high. ` +
        `Please avoid prolonged exposure and rest in the shade.`,
    };
  }
  return {
    korean:
      `안내 말씀드립니다. 현재 기온이 매우 높습니다. ` +
      `충분한 수분을 섭취하시고 장시간 체류를 피해 주시기 바랍니다.`,
    english:
      `Attention. Temperatures are very high. ` +
      `Please stay hydrated and avoid staying outdoors for long periods.`,
  };
}

function fallbackResult(
  snap: Snapshot,
  a: Assessment,
  reason: string,
  simulation: SimulationInfo | null,
): AgentResult {
  const need = shouldBroadcast(a);
  const text = fallbackBroadcastText(a);
  const lines = [
    `현재 위험 등급: ${LEVEL_LABEL[a.level]}(${a.level})`,
    ...(a.reasons.length
      ? a.reasons.map((r) => `- ${r.message} [기준 출처: ${r.source}]`)
      : ["- 임계값을 넘어선 지표가 없습니다."]),
    "",
    need ? "방송을 권고합니다." : "방송이 필요한 등급이 아닙니다.",
    "",
    "이 판정의 한계:",
    ...a.limitations.map((l) => `- ${l}`),
  ];
  return {
    answer: lines.join("\n"),
    assessment: a,
    broadcast: need ? buildBroadcast(snap, "all", text.korean, text.english) : null,
    fallback: true,
    fallbackReason: reason,
    toolCalls: [],
    simulation,
  };
}

// --- 방송 문안 생성 (결정적) --------------------------------------------

/**
 * 방송이 필요한 등급이면 **반드시** 문안을 만든다.
 *
 * 원래는 모델이 draftBroadcast 툴을 부르게 했는데, 실측해보니 danger 판정을
 * 내리고도 "북/남 방파제 모두에 내보내시겠습니까?" 하고 되물으며 끝냈다.
 * 대화형으로는 자연스럽지만 한 번의 질의로 방송 문안이 나와야 하는 화면에서는
 * 실패다. 그래서 문안 생성을 모델의 선택에 맡기지 않고 별도의 구조화 출력
 * 호출로 강제한다. 모델은 문장을 쓰고, 어느 스피커에 묶을지는 코드가 정한다.
 */
async function generateBroadcast(
  ai: GoogleGenAI,
  model: string,
  snap: Snapshot,
  a: Assessment,
): Promise<Broadcast> {
  const facts = a.reasons.map((r) => `- ${r.message} (기준 출처: ${r.source})`).join("\n");
  const prompt =
    `구룡포 방파제에 내보낼 안내방송 문안을 작성한다.\n\n` +
    `현재 위험 등급: ${LEVEL_LABEL[a.level]}\n판정 근거:\n${facts}\n\n` +
    `조건: 실제로 스피커로 읽힐 문장이다. 한국어는 존댓말로 2~3문장. ` +
    `영어는 외국인 관광객 대상 2~3문장. 무엇이 위험하고 무엇을 해야 하는지를 담아라. ` +
    `근거에 없는 사실(파고, 조위, 사람 수 등)을 지어내지 마라.`;

  try {
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            zone: { type: Type.STRING, description: "north / south / all" },
            korean: { type: Type.STRING },
            english: { type: Type.STRING },
          },
          required: ["zone", "korean", "english"],
        },
      },
    });
    const parsed = JSON.parse(res.text ?? "{}") as {
      zone?: string;
      korean?: string;
      english?: string;
    };
    const zone = (["north", "south", "all"].includes(parsed.zone ?? "") ? parsed.zone : "all") as
      | "north"
      | "south"
      | "all";
    if (parsed.korean && parsed.english) {
      return buildBroadcast(snap, zone, parsed.korean, parsed.english);
    }
  } catch {
    // 구조화 호출이 실패하면 규칙 기반 문안으로 간다.
  }
  const text = fallbackBroadcastText(a);
  return buildBroadcast(snap, "all", text.korean, text.english);
}

// --- 에이전트 루프 ------------------------------------------------------

export async function runAgent(
  question: string,
  scenario?: ScenarioName,
): Promise<AgentResult> {
  const live = await snapshot();
  const snap = scenario ? applyScenario(live, scenario) : live;
  const simulation = scenario ? simulationInfo(scenario) : null;
  const assessment = assessRisk(snap);

  const apiKey = readEnv("GEMINI_API_KEY");
  if (!apiKey) {
    return fallbackResult(snap, assessment, "GEMINI_API_KEY 가 없다", simulation);
  }

  const ai = new GoogleGenAI({ apiKey });
  const toolCalls: string[] = [];
  let broadcast: Broadcast | null = null;

  // 툴 실행기. 전부 이미 받아둔 스냅샷/판정 위에서 동작하므로 재호출이 없다.
  const invoke = (name: string, args: Record<string, unknown>): Record<string, unknown> => {
    toolCalls.push(name);
    switch (name) {
      case "getSnapshot":
        return {
          fetchedAt: snap.fetchedAt,
          air: snap.air,
          uv: snap.uv,
          abnormal:
            "error" in snap.abnormal
              ? snap.abnormal
              : { total: snap.abnormal.total, detectorLive: snap.abnormal.detectorLive },
          deviceCounts: {
            speakers: snap.devices.speakers?.length ?? 0,
            aiCctvs: snap.devices.ai_cctvs?.length ?? 0,
            uvSensors: snap.devices.uv_devices?.length ?? 0,
          },
        };
      case "assessRisk":
        return {
          level: assessment.level,
          levelLabel: LEVEL_LABEL[assessment.level],
          shouldBroadcast: shouldBroadcast(assessment),
          reasons: assessment.reasons,
          limitations: assessment.limitations,
        };
      case "listSpeakers": {
        const zone = String(args.zone ?? "all");
        return { zone, speakers: speakersFor(snap, zone).map((s) => ({ id: s.id, name: s.name })) };
      }
      case "draftBroadcast": {
        if (!shouldBroadcast(assessment)) {
          return {
            rejected: true,
            reason: `위험 등급이 ${assessment.level} 이라 방송하지 않는다. warning 이상에서만 방송한다.`,
          };
        }
        const zoneArg = String(args.zone ?? "all");
        const zone = (["north", "south", "all"].includes(zoneArg) ? zoneArg : "all") as
          | "north"
          | "south"
          | "all";
        broadcast = buildBroadcast(snap, zone, String(args.korean ?? ""), String(args.english ?? ""));
        return { accepted: true, ...broadcast };
      }
      default:
        return { error: `알 수 없는 툴: ${name}` };
    }
  };

  const contents: Content[] = [{ role: "user", parts: [{ text: question }] }];
  let lastError = "";

  for (const model of MODELS) {
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const res = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: SYSTEM,
            tools: [{ functionDeclarations: DECLARATIONS }],
          },
        });

        const calls = res.functionCalls ?? [];
        if (calls.length === 0) {
          // 모델이 draftBroadcast 를 안 불렀어도 필요한 등급이면 문안을 만든다.
          if (!broadcast && shouldBroadcast(assessment)) {
            broadcast = await generateBroadcast(ai, model, snap, assessment);
          }
          return {
            answer: res.text ?? "(모델이 빈 응답을 돌려줬다)",
            assessment,
            broadcast,
            fallback: false,
            modelUsed: model,
            toolCalls,
            simulation,
          };
        }

        // 모델이 요청한 툴을 실행하고 결과를 대화에 되돌린다.
        contents.push({
          role: "model",
          parts: calls.map((c) => ({ functionCall: c })),
        });
        contents.push({
          role: "user",
          parts: calls.map((c) => ({
            functionResponse: {
              name: c.name ?? "",
              response: invoke(c.name ?? "", c.args ?? {}),
            },
          })),
        });
      }

      // 툴만 계속 부르고 답을 안 낸 경우
      lastError = `${model} 이 ${MAX_TURNS}턴 안에 최종 답변을 내지 않았다`;
    } catch (e) {
      lastError = `${model}: ${(e as Error).message}`;
      // 다음 모델로 넘어간다 (모델명 404, rate limit 등)
    }
  }

  const fb = fallbackResult(snap, assessment, lastError || "Gemini 호출 실패", simulation);
  return { ...fb, broadcast: broadcast ?? fb.broadcast, toolCalls };
}
