import type { ChatReply, ChatRequest } from '../src/lib/chat.ts';
import {
  describeThresholds,
  DRYING_THRESHOLDS,
  gradeIs,
  kst,
  type DryingGrade,
} from '../src/lib/drying.ts';
import type { HistorySummary } from '../src/lib/analysis.ts';
import type { LiveObservation, LiveSnapshot } from '../src/lib/live.ts';
import type { OperationsData } from '../src/lib/operations.ts';
import type { Team } from '../src/lib/workspace.ts';
import {
  createAgentTools,
  TOOL_NAMES,
  type ToolCard,
  type ToolContext,
  type WeatherHistorySource,
} from './agent-tools.ts';
import {
  addEvidence,
  addLooseNumbers,
  addTextEvidence,
  currentSentences,
  emptyEvidence,
  promisesSafety,
  ungroundedNumbers,
  type Evidence,
  type Unit,
} from './answer-checks.ts';
import { BridgeError, object, type BridgeConfig } from './eum.ts';
import { ClaudeCliError, createClaudeAgent, type AgentAsk } from './claude-cli.ts';
import { contextSystemPrompt, PROMPT_TEXT, toolSystemPrompt } from './prompts.ts';
import {
  createToolServer,
  type ToolCall,
  type ToolDefinition,
  type ToolServer,
  type ToolSession,
} from './tool-server.ts';
import { usageLog } from './usage.ts';
import type { UvIndexSource, UvReading } from './sources/eum-uv.ts';

// AI 도우미 채팅 (ADR 0011). claude 는 읽기 전용 도구로 필요한 자료만 보고 설명을 쓴다.
// 서버는 AI 가 실제로 부른 도구로 화면 카드를 정하고, 답을 검사한 뒤 내보낸다. 지시문: server/prompts/*.md

export type LiveChatRequest = ChatRequest & { deviceId?: string };
export type LiveChatReply = ChatReply & {
  observation?: LiveObservation;
  provider: 'openai' | 'compatible' | 'claude' | 'local';
  providerNotice?: string;
  sourceFetchedAt: string;
};

export function llmProviderName(config: BridgeConfig): 'openai' | 'compatible' {
  return /\/\/([^/]*\.)?openai\.com/i.test(config.llmBaseUrl) ? 'openai' : 'compatible';
}

export function readChatRequest(value: unknown): LiveChatRequest {
  if (
    !object(value) ||
    typeof value.message !== 'string' ||
    !value.message.trim() ||
    value.message.length > 6000 ||
    typeof value.siteId !== 'string' ||
    value.siteId.length > 160 ||
    !Array.isArray(value.history) ||
    value.history.length > 40 ||
    (value.deviceId !== undefined &&
      (typeof value.deviceId !== 'string' || !/^[\w-]{1,80}$/.test(value.deviceId)))
  ) {
    throw new BridgeError(
      400,
      'INVALID_REQUEST',
      '요청 내용을 확인해 주세요. 메시지는 6,000자 이내로 입력할 수 있어요.',
    );
  }
  const history: ChatRequest['history'] = [];
  for (const entry of value.history) {
    if (
      !object(entry) ||
      typeof entry.role !== 'string' ||
      !['user', 'assistant'].includes(entry.role) ||
      typeof entry.content !== 'string' ||
      entry.content.length > 6000
    ) {
      throw new BridgeError(400, 'INVALID_HISTORY', '이전 대화 형식이 올바르지 않아요.');
    }
    history.push({ role: entry.role as 'user' | 'assistant', content: entry.content });
  }
  return {
    message: value.message.trim(),
    siteId: value.siteId,
    history: history.slice(-12),
    ...(typeof value.deviceId === 'string' ? { deviceId: value.deviceId } : {}),
  };
}

export function getAction(message: string): ChatReply['action'] {
  // "근로자 몇 명?"처럼 근로자를 묻기만 하는 말은 안내 작성이 아니다. 안내·전달·번역을 하려는 말만 고른다.
  if (
    /작업\s*안내|번역|전달|(?:근로자|베트남)[^?？]*(?:안내|알려\s*(?:줘|주|달)|보내|말해\s*(?:줘|주))/.test(
      message,
    )
  )
    return 'guidance';
  if (/기준|방법|어떻게|설명|신뢰|관측기|데이터|거리|사용법|이유/.test(message)) return undefined;
  if (
    /회수했|거뒀|거두었|(종료|완료|마무리|끝).*(작업|건조|기록|배치)|(작업|건조|배치).*(종료|완료|마무리|끝)/.test(
      message,
    )
  )
    return 'end-batch';
  if (/널었|(시작|새로운|새|등록).*(작업|건조|배치)|(작업|건조|배치).*(시작|등록)/.test(message))
    return 'start-batch';
  return undefined;
}

/** "꽁치 300마리 널었어"에서 원물과 마리 수를 읽어 시작 창에 미리 채운다. AI 가 아니라 이 규칙만 쓴다. */
export function startPrefill(message: string): ChatReply['prefill'] {
  const fish = /꽁치/.test(message) ? '꽁치' : /청어/.test(message) ? '청어' : undefined;
  const count = /(\d[\d,]*)\s*마리/.exec(message)?.[1].replaceAll(',', '');
  const quantity =
    count && Number(count) > 0 && Number(count) <= 1_000_000 ? Number(count) : undefined;
  return fish || quantity
    ? { ...(fish ? { fish } : {}), ...(quantity ? { quantity } : {}) }
    : undefined;
}

/** 서버가 E-UM 대신 기상청 AWS 를 고른 경우 (사용자가 직접 고른 것과 구분한다). */
const kmaFallback = (snapshot: LiveSnapshot) =>
  snapshot.selected?.device.provider === 'kma' &&
  (snapshot.selectionReason === 'kma-no-recent-eum' ||
    snapshot.selectionReason === 'kma-eum-anomaly');

/** 기상청 값을 쓴 이유 한 문장. */
function selectionNote(snapshot: LiveSnapshot): string {
  if (snapshot.selectionReason === 'kma-eum-anomaly')
    return ' E-UM 관측기 값이 비정상이거나 기상청과 크게 달라 기상청 구룡포 AWS 값을 기준으로 판단했어요.';
  if (snapshot.selectionReason === 'kma-no-recent-eum')
    return ' E-UM 관측기의 최근 값이 없어 기상청 구룡포 AWS 값을 기준으로 판단했어요.';
  return '';
}

export function localExplanation(snapshot: LiveSnapshot, action: ChatReply['action']): string {
  const observation = snapshot.selected;
  const assessment = snapshot.assessment;
  const opening =
    action === 'start-batch'
      ? '새 작업의 원물, 수량과 시작 시점을 확인한 뒤 저장해 주세요. '
      : action === 'end-batch'
        ? '종료할 작업과 종료 시점, 현장 메모를 확인한 뒤 저장해 주세요. '
        : action === 'guidance'
          ? '작업 안내에서 전달할 내용을 확인할 수 있어요. '
          : '';
  const kma = observation?.device.provider === 'kma';
  const source = kma
    ? kmaFallback(snapshot)
      ? `E-UM 관측기의 최근 값이 없어 ${observation.device.name} 관측값을 확인했어요.`
      : `${observation.device.name} 관측값을 확인했어요.`
    : snapshot.status === 'archived'
      ? `${snapshot.archiveSourceDate ?? '이전'}에 관측된 E-UM 보관 실측 자료를 보여드려요. 현재 날씨가 아니에요.`
      : observation
        ? `E-UM의 ${observation.device.name} 관측값을 확인했어요.`
        : '선택한 관측기의 데이터를 확인할 수 없어요.';
  const freshness =
    (kma || snapshot.status !== 'archived') && observation?.status === 'stale'
      ? ' 수집 시각이 오래되어 현재 환경과 다를 수 있어요.'
      : observation?.status === 'invalid'
        ? ' 관측 항목이나 수집 시각이 불완전해요.'
        : '';
  if (assessment) {
    // 규칙 함수의 등급을 그대로 옮긴다 (AI 없이도 같은 결과).
    const basis =
      assessment.grade === '판정 불가'
        ? assessment.reasons.join(' ')
        : `근거: 기온 ${assessment.temperature}°C · 습도 ${assessment.humidity}% · 풍속 ${assessment.windSpeed}m/s, ${kst(assessment.observedAt)} 측정(${assessment.ageMinutes}분 전), ${assessment.deviceName} · 덕장에서 ${assessment.distanceM}m.`;
    const advice = assessment.advice?.length ? `\n${assessment.advice.join(' ')}` : '';
    const rules = assessment.thresholds
      ? `\n\n적용 기준은 현장 검증 전 가설값이에요. ${describeThresholds(assessment.thresholds)}`
      : '';
    return `${opening}건조 조건은 ${gradeIs(assessment.grade)}. ${assessment.summary}\n\n${basis}${selectionNote(snapshot)}${advice}${rules}`;
  }
  return `${opening}${source}${freshness}\n\n${snapshot.site ? '등록한 덕장 위치를 기준으로 관측소와의 거리를 확인할 수 있어요.' : '덕장 위치를 등록하면 그 위치 기준으로 건조 등급을 알려 드려요.'}`;
}

/** Reads an OpenAI-compatible chat completions response. */
export function readCompletionText(value: unknown): string {
  if (!object(value) || !Array.isArray(value.choices)) {
    throw new BridgeError(502, 'LLM_INCOMPLETE', 'AI가 답변 생성을 완료하지 못했어요.');
  }
  const parts: string[] = [];
  for (const choice of value.choices) {
    if (!object(choice) || !object(choice.message)) continue;
    const content = choice.message.content;
    if (typeof content === 'string') parts.push(content);
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (object(part) && typeof part.text === 'string') parts.push(part.text);
      }
    }
  }
  const content = parts.join('\n').trim();
  if (!content || content.length > 4000)
    throw new BridgeError(502, 'LLM_INVALID_TEXT', 'AI 답변 형식을 확인할 수 없어요.');
  return content;
}

/** A conservative backstop for explicit verdicts; structured evidence stays authoritative. */
export function hasUnsupportedVerdict(content: string): boolean {
  const text = content.replace(/[*_`]/g, '');
  return [
    /(?:적합|부적합|안전)(?:합니다|해요|하다|해\s*보|한\s*(?:상태|환경|조건)|하다고|으로\s*판정)/,
    /(?:판정|등급|건조\s*상태)\s*(?:은|는|이|가|:)?\s*["'“「]?\s*(?:적합|부적합|주의)(?:["'”」]?\s*(?:입니다|이에요|예요|에요|로|입니다|등급)|\s*$)/,
    /건조(?:가|는|를)?\s*가능(?:합니다|해요|하다|한\s*(?:상태|조건|날씨|환경))/,
    /(?:널어도|건조해도|말려도)\s*(?:괜찮|좋|됩니다|돼요|안전)/,
  ].some((pattern) => pattern.test(text));
}

/** 문장 속 등급 주장만 뽑는다. "부적합 조건은 아니지만", "적합 기준보다" 같은 언급은 주장이 아니다. */
function claimedGrades(text: string): DryingGrade[] {
  const claims = new Set<DryingGrade>();
  const grade = String.raw`(적합|주의|부적합|판정\s*불가)`;
  const ending = String.raw`(?:입니다|이에요|예요|에요|이며|이고|으로\s*판정|로\s*판정|\s*등급|\s*단계)`;
  // "등급은 '주의'예요", "판정: 부적합입니다", "건조 조건은 적합이에요"
  for (const match of text.matchAll(
    new RegExp(
      String.raw`(?:등급|판정|건조\s*조건|널기)\s*(?:은|는|이|가|:)?\s*["'“‘「]?\s*${grade}\s*["'”’」]?\s*${ending}`,
      'g',
    ),
  ))
    claims.add(normalize(match[1]));
  // "지금은 부적합입니다", "'적합'이에요" 처럼 등급 단어가 바로 서술되는 경우
  for (const match of text.matchAll(
    new RegExp(
      String.raw`(?<![가-힣])["'“‘「]?${grade}["'”’」]?\s*(?:등급\s*)?(?:입니다|이에요|예요|에요)`,
      'g',
    ),
  ))
    claims.add(normalize(match[1]));
  // "적합합니다/적합해요" (뒤에 부정이 없을 때), "부적합합니다"
  if (/(?<!부)적합(?:합니다|해요)(?!\s*(?:않|아니))/.test(text)) claims.add('적합');
  if (/부적합(?:합니다|해요)/.test(text)) claims.add('부적합');
  return [...claims];
}
const normalize = (value: string): DryingGrade =>
  (value.replace(/\s+/g, ' ') === '판정 불가' ? '판정 불가' : value) as DryingGrade;

/**
 * AI 답변이 규칙 판정과 어긋나는가. 다른 등급을 주장하거나, 부적합·판정 불가인데 널어도 된다고 하거나,
 * 안전을 보장하면 규칙 문장으로 바꾼다 (기획서: 생성형 AI 출력은 코드가 재검사).
 */
export function contradictsAssessment(content: string, grade: DryingGrade | undefined): boolean {
  if (!grade) return hasUnsupportedVerdict(content);
  const text = content.replace(/[*_`]/g, '');
  if (claimedGrades(text).some((claim) => claim !== grade)) return true;
  if (
    (grade === '부적합' || grade === '판정 불가') &&
    /(?:널어도|건조해도|말려도)\s*(?:괜찮|좋|됩니다|돼요)|(?:널기|말리기|건조하기)\s*(?:에\s*)?(?:좋|딱)/.test(
      text,
    )
  )
    return true;
  // "안전을 보장하지는 않아요" 같은 부정은 괜찮다.
  return /안전(?:합니다|해요)|안전을\s*보장(?:합니다|해요|해\s*드려요|할\s*수\s*있)/.test(text);
}

// 자외선은 조언용 참고값이라 늦으면 기다리지 않는다 (도구 하나가 채팅 시간을 오래 잡지 않게).
// 조회는 뒤에서 이어져 다음 질문부터 캐시로 쓰인다.
const UV_WAIT_MS = 3000;
async function readUv(source: UvIndexSource | undefined): Promise<UvReading | null> {
  if (!source) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      source().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(resolve, UV_WAIT_MS, null);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const mismatchNotice = (snapshot: LiveSnapshot) =>
  snapshot.assessment
    ? 'AI 답변이 규칙 판정과 달라 규칙 문장으로 바꿨어요.'
    : 'AI 답변에 확인되지 않은 판정이 포함되어 관측 사실만 안내해요.';

function claudeNotice(error: unknown): string {
  const kind = error instanceof ClaudeCliError ? error.kind : 'failed';
  if (kind === 'auth') return 'AI 인증에 실패해 자료 요약만 안내해요.';
  if (kind === 'limit') return 'AI 요청 한도에 도달해 자료 요약만 안내해요.';
  if (kind === 'busy')
    return '지금 AI 요청이 많아 자료 요약만 안내해요. 잠시 뒤 다시 물어봐 주세요.';
  if (kind === 'timeout') return 'AI 응답이 늦어 자료 요약만 안내해요.';
  return 'AI 연결 또는 응답 확인에 실패해 자료 요약만 안내해요.';
}

/** 채팅 요청 하나의 덕장 자료. 도구가 필요할 때 읽는다 (테스트는 생략할 수 있다). */
export type ChatData = {
  site?: ToolContext['site'];
  team?: () => Promise<Team>;
  operations?: () => Promise<OperationsData | null>;
};

export type LiveChatOptions = {
  /** claude 가 부를 도구 서버. 없으면 처음 쓸 때 루프백에 하나 연다 */
  toolServer?: ToolServer;
  /** 기상청 등 외부 과거 관측. 없으면 과거 분석은 배치 기록만 쓴다 */
  history?: WeatherHistorySource;
  now?: () => number;
};

// AI 를 못 쓸 때 질문 종류를 가늠하는 말. 답을 만들지 않고, 어떤 자료 요약을 보여 줄지만 고른다.
const ASKS_BATCHES = /배치|건조\s*기록|작업\s*기록|이번\s*작업|지난\s*작업/;
const ASKS_SITE = /팀|인원|몇\s*명|근로자|직원|초대|덕장\s*(?:이름|주소|정보|위치)/;
const ASKS_FORECAST = /예보|언제|이따|나중|오후|저녁|밤|내일|비\s*와|비\s*오/;
const ASKS_CONDITIONS =
  /널|말리|말려|말릴|건조|날씨|기온|온도|습도|바람|풍속|비\s*와|비가|눈이|강수|등급|적합|관측|예보/;

/** 다른 때를 다루는 도구 (과거·예보·배치). 이 도구를 함께 부른 답은 과거형 문장을 현재로 보지 않는다. */
const OTHER_TIME_TOOLS = new Set<string>([
  TOOL_NAMES.history,
  TOOL_NAMES.compare,
  TOOL_NAMES.forecast,
  TOOL_NAMES.batches,
]);

function suggestionsFor(used: Set<string>): string[] {
  if (used.has(TOOL_NAMES.compare))
    return ['지난 7일 건조 조건 분석해줘', '지금 널어도 될까?', '진행 중인 배치 어때?'];
  if (used.has(TOOL_NAMES.history))
    return ['작년 같은 기간과 비교해줘', '지금 널어도 될까?', '앞으로 몇 시간 예보는?'];
  if (used.has(TOOL_NAMES.batches))
    return ['지난 배치들과 비교해줘', '지금 널어도 될까?', '지난 7일 건조 조건 분석해줘'];
  if (used.has(TOOL_NAMES.current) || used.has(TOOL_NAMES.forecast))
    return ['언제 널면 좋을까?', '지난 7일 건조 조건 분석해줘', '진행 중인 배치 어때?'];
  return ['지금 널어도 될까?', '지난 7일 건조 조건 분석해줘', '우리 팀 현황 알려줘'];
}

/**
 * 성공한 도구 호출의 카드를 응답 필드로 옮긴다. 같은 종류가 여러 번이면 마지막 것을 쓰고,
 * 기간 요약은 같은 기간·출처를 하나로 합쳐 마지막 두 개까지 쓴다.
 */
function cardsFrom(calls: ToolCall[], snapshot: LiveSnapshot): Partial<LiveChatReply> {
  const cards = calls.filter((call) => call.ok && call.card).map((call) => call.card as ToolCard);
  const reply: Partial<LiveChatReply> = {};
  const sources: string[] = [];
  if (cards.some((card) => card.kind === 'current')) {
    if (snapshot.assessment) reply.assessment = snapshot.assessment;
    if (snapshot.selected) {
      reply.observation = snapshot.selected;
      sources.push(
        `현재 관측: ${snapshot.selected.device.name} · ${kst(snapshot.selected.observedAt)}`,
      );
    }
  }
  const byPeriod = new Map<string, HistorySummary>();
  for (const card of cards)
    if (card.kind === 'history')
      for (const item of card.data) {
        const key = `${item.from}|${item.to}|${item.source}`;
        byPeriod.delete(key);
        byPeriod.set(key, item);
      }
  const history = [...byPeriod.values()].slice(-2);
  if (history.length) {
    reply.history = history;
    for (const item of history)
      sources.push(
        `과거 관측: ${item.source} · ${item.from}~${item.to} · 결측 ${item.missingRate}%`,
      );
  }
  const forecast = cards.findLast((card) => card.kind === 'forecast');
  if (forecast?.kind === 'forecast') {
    reply.forecast = forecast.data;
    sources.push(`예보: ${forecast.data.source} · ${kst(forecast.data.issuedAt)} 발표`);
  }
  const batches = cards.findLast((card) => card.kind === 'batches');
  if (batches?.kind === 'batches') {
    reply.batches = batches.data;
    sources.push(`배치 기록 ${batches.data.length}개`);
  }
  if (sources.length) reply.sources = sources;
  return reply;
}

/** 검사에 걸린 답 대신 보여 줄, 도구가 만든 요약 문장. */
function toolSummaries(calls: ToolCall[]): string {
  return calls
    .filter((call) => call.ok)
    .map((call) =>
      object(call.result) && typeof call.result.summary === 'string' ? call.result.summary : '',
    )
    .filter(Boolean)
    .join('\n\n');
}

type Verdict = { ok: true } | { ok: false; reason: 'grade' | 'numbers' };

/**
 * AI 답 검사.
 * - 현재 시점 문장이 규칙 등급과 다른 등급을 말하거나, 현재 관측을 보지 않고 지금 널어도 된다고 하거나,
 *   품질·안전을 보장하면 grade
 * - 측정 숫자(°C·%·m/s·mm)가 같은 단위의 근거(도구 결과·기준·지시문·대화)에 없으면 numbers
 */
export function checkAnswer(input: {
  text: string;
  grade: DryingGrade | undefined;
  usedTools: Set<string>;
  evidence: Evidence;
}): Verdict {
  const usedCurrent = input.usedTools.has(TOOL_NAMES.current);
  const otherTimes = [...input.usedTools].some((name) => OTHER_TIME_TOOLS.has(name));
  const current = currentSentences(input.text, { current: usedCurrent, otherTimes }).join(' ');
  if (usedCurrent ? contradictsAssessment(current, input.grade) : hasUnsupportedVerdict(current))
    return { ok: false, reason: 'grade' };
  if (promisesSafety(input.text)) return { ok: false, reason: 'grade' };
  if (ungroundedNumbers(input.text, input.evidence).length) return { ok: false, reason: 'numbers' };
  return { ok: true };
}

/** 어떤 답에서든 근거가 되는 숫자: 판정 기준값과 지시문(과메기 상식)에 단위와 함께 적힌 값. */
const BASE_EVIDENCE = addTextEvidence(addEvidence(emptyEvidence(), DRYING_THRESHOLDS), PROMPT_TEXT);
/** claude 가 프로세스를 멈추는 데 걸리는 최대 시간(SIGTERM 뒤 SIGKILL 5초) + 대체 답을 만들 여유 */
const STOP_MARGIN_MS = 8000;

/** 도구를 AI 없이 바로 실행해 호출 기록 모양으로 돌려준다 (대체 답·OpenAI 경로). */
async function runDirect(tool: ToolDefinition, signal: AbortSignal): Promise<ToolCall> {
  try {
    const { content, card } = await tool.run({}, signal);
    return { name: tool.name, input: {}, ok: true, result: content, card, ms: 0 };
  } catch {
    return { name: tool.name, input: {}, ok: false, ms: 0 };
  }
}

export function createLiveChat(
  config: BridgeConfig,
  fetcher: typeof fetch = fetch,
  ask: AgentAsk | undefined = config.llmProvider === 'claude' && config.claude
    ? createClaudeAgent(config.claude)
    : undefined,
  /** E-UM 자외선(sources/eum-uv.ts). 없으면 현재 관측 도구의 uv 는 null 이다. */
  uvIndex?: UvIndexSource,
  options: LiveChatOptions = {},
) {
  const now = options.now ?? Date.now;
  // 비용 기록은 claude 를 쓸 때만 필요하다. OpenAI 경로에서는 DB 를 열지 않는다.
  const usage =
    ask && config.claude && config.databasePath ? usageLog(config.databasePath) : undefined;
  let toolServer = options.toolServer;
  return async (
    request: LiveChatRequest,
    snapshot: LiveSnapshot,
    signal: AbortSignal,
    /** 경로 전체 제한이 끝나는 시각(ms). 관측을 기다린 만큼 AI 시간을 줄여 시간 초과 대신 대체 답을 준다. */
    deadlineAt?: number,
    data: ChatData = {},
  ): Promise<LiveChatReply> => {
    signal.throwIfAborted();
    const aiSignal = (limitMs: number) => {
      const left =
        deadlineAt === undefined
          ? limitMs
          : Math.min(limitMs, deadlineAt - Date.now() - STOP_MARGIN_MS);
      return AbortSignal.any([signal, AbortSignal.timeout(Math.max(1000, left))]);
    };
    const action = getAction(request.message);
    const prefill = action === 'start-batch' ? startPrefill(request.message) : undefined;
    const site = data.site ?? {
      name: snapshot.site?.name ?? '등록된 덕장',
      address: '',
      createdAt: '',
      latitude: snapshot.site?.latitude ?? 0,
      longitude: snapshot.site?.longitude ?? 0,
    };
    const tools = createAgentTools({
      snapshot,
      site,
      uv: () => readUv(uvIndex),
      team:
        data.team ??
        (async () => {
          throw new Error('팀 정보가 없다');
        }),
      operations: data.operations ?? (async () => null),
      history: options.history,
      now,
    });
    const tool = (name: string) => tools.find((item) => item.name === name)!;
    const runtime = { now: now(), siteName: site.name, siteRegistered: Boolean(snapshot.site) };
    const base = {
      ...(action ? { action } : {}),
      ...(prefill ? { prefill } : {}),
      sourceFetchedAt: snapshot.fetchedAt,
    };
    const evidenceFrom = (results: unknown[]) => {
      const evidence = addEvidence(emptyEvidence(), results);
      for (const unit of Object.keys(evidence) as Unit[])
        evidence[unit].push(...BASE_EVIDENCE[unit]);
      addLooseNumbers(evidence, request.message);
      for (const entry of request.history)
        if (entry.role === 'user') addLooseNumbers(evidence, entry.content);
        else addTextEvidence(evidence, entry.content);
      return evidence;
    };

    /**
     * AI 없이 줄 답. 질문 종류를 말로 가늠해 그 자료의 코드 요약만 보여 준다.
     * 지금 날씨를 묻지 않았으면 널기 등급을 꺼내지 않는다.
     */
    const offline = async (notice: string): Promise<LiveChatReply> => {
      const reply = (content: string, calls: ToolCall[] = []): LiveChatReply => ({
        ...base,
        ...cardsFrom(calls, snapshot),
        content,
        suggestions: suggestionsFor(new Set()),
        provider: 'local',
        providerNotice: notice,
      });
      if (ASKS_BATCHES.test(request.message)) {
        const call = await runDirect(tool(TOOL_NAMES.batches), signal);
        const summary = toolSummaries([call]);
        if (summary) return reply(summary, [call]);
      }
      if (ASKS_SITE.test(request.message)) {
        const call = await runDirect(tool(TOOL_NAMES.site), signal);
        const summary = toolSummaries([call]);
        if (summary) return reply(summary);
        if (!ASKS_CONDITIONS.test(request.message))
          return reply('지금은 덕장·팀 정보를 읽지 못했어요. 잠시 뒤 다시 물어봐 주세요.');
      }
      if (ASKS_CONDITIONS.test(request.message) || action === 'start-batch')
        return reply(localExplanation(snapshot, action), [currentCall]);
      return reply(
        action
          ? localExplanation(snapshot, action).split('\n')[0]
          : '지금은 AI가 답하지 못해 자세한 설명을 드릴 수 없어요. 잠시 뒤 다시 물어봐 주세요.',
      );
    };
    /** 현재 상태 카드만 붙이는 가짜 호출 (규칙 문장으로 바꿀 때) */
    const currentCall: ToolCall = {
      name: TOOL_NAMES.current,
      input: {},
      ok: true,
      card: { kind: 'current' },
      ms: 0,
    };

    /**
     * 검사를 통과한 답을 응답으로 만들고, 걸리면 바꾼다.
     * - 현재 상태만 본 답의 등급이 틀리면 규칙 문장
     * - 다른 때를 함께 본 답이 걸리면 그 도구들의 요약 (summariesAllowed 일 때)
     * - 그 밖에는 질문 종류에 맞는 대체 답
     */
    const finish = async (
      text: string,
      provider: LiveChatReply['provider'],
      calls: ToolCall[],
      summariesAllowed: boolean,
    ): Promise<LiveChatReply> => {
      if (!text || text.length > 4000)
        return offline('AI 답변 형식을 확인할 수 없어 자료 요약만 안내해요.');
      const usedTools = new Set(calls.filter((call) => call.ok).map((call) => call.name));
      const verdict = checkAnswer({
        text,
        grade: snapshot.assessment?.grade,
        usedTools,
        evidence: evidenceFrom(calls.filter((call) => call.ok).map((call) => call.result)),
      });
      const replace = (content: string, shown: ToolCall[], notice: string): LiveChatReply => ({
        ...base,
        ...cardsFrom(shown, snapshot),
        content,
        suggestions: suggestionsFor(usedTools),
        provider: 'local',
        providerNotice: notice,
      });
      if (verdict.ok)
        return {
          ...base,
          ...cardsFrom(calls, snapshot),
          content: text,
          suggestions: suggestionsFor(usedTools),
          provider,
        };
      const otherTimes = [...usedTools].some((name) => OTHER_TIME_TOOLS.has(name));
      if (verdict.reason === 'grade' && usedTools.has(TOOL_NAMES.current) && !otherTimes)
        return replace(localExplanation(snapshot, action), calls, mismatchNotice(snapshot));
      const summary = summariesAllowed ? toolSummaries(calls) : '';
      const notice =
        verdict.reason === 'grade'
          ? 'AI 답변이 규칙 판정과 달라 자료 요약으로 바꿨어요.'
          : 'AI 답변에 자료에서 확인되지 않은 숫자가 있어 자료 요약으로 바꿨어요.';
      if (summary) return replace(summary, calls, notice);
      return offline(
        verdict.reason === 'grade'
          ? mismatchNotice(snapshot)
          : 'AI 답변에 자료에서 확인되지 않은 숫자가 있어 자료 요약만 안내해요.',
      );
    };

    if (ask && config.claude) {
      // 사용량 DB 문제로 답변 전체가 실패하지 않게, 조회 실패는 대체 답으로, 기록 실패는 무시한다.
      let spent = 0;
      try {
        spent = usage?.spentLast24h() ?? 0;
      } catch {
        return offline('AI 사용량을 확인하지 못해 자료 요약만 안내해요.');
      }
      if (spent >= config.claude.dailyBudgetUsd)
        return offline('최근 24시간 AI 사용 한도에 도달해 자료 요약만 안내해요.');
      const record = (costUsd: number | undefined) => {
        try {
          usage?.record('claude', costUsd ?? 0);
        } catch {
          // 기록하지 못해도 이미 받은 답변은 보여 준다.
        }
      };
      const startedAt = Date.now();
      // 화면이 취소하거나 경로 제한 전 남은 시간이 지나면 claude 도 멈춰 동시 실행 자리를 바로 돌려준다.
      const claudeSignal = aiSignal(config.claude.timeoutMs);
      toolServer ??= createToolServer();
      let session: ToolSession | undefined;
      try {
        session = await toolServer.open(tools, claudeSignal, config.claude.timeoutMs + 5000);
        const { text, costUsd } = await ask({
          system: toolSystemPrompt(runtime),
          history: request.history,
          message: request.message,
          signal: claudeSignal,
          tools: { url: session.url, token: session.token },
        });
        record(costUsd);
        signal.throwIfAborted();
        return await finish(text, 'claude', [...session.calls], true);
      } catch (error) {
        const failure = error instanceof ClaudeCliError ? error : undefined;
        // claude 가 비용을 알려 준 실패(예: 메시지당 상한 초과)는 그 값을 센다. 시간 초과·취소는 비용을 알 수
        // 없어, 돈 시간만큼 메시지당 상한을 나눠 센다 (제한 시간을 다 쓰면 상한 전체). 세지 않으면 취소를
        // 반복해 하루 한도를 피해 갈 수 있다.
        const unknownCost = failure?.kind === 'timeout' || failure?.kind === 'aborted';
        const elapsed = Math.min(1, (Date.now() - startedAt) / config.claude.timeoutMs);
        record(
          failure?.costUsd ?? (unknownCost ? config.claude.maxBudgetUsd * elapsed : undefined),
        );
        signal.throwIfAborted();
        if (claudeSignal.aborted) return offline('AI 응답이 늦어 자료 요약만 안내해요.');
        // 화면에는 종류별 안내만 가므로 원인은 서버 로그에 남긴다. 사용자 메시지는 남기지 않지만, 원인 글에
        // 모델 출력이 섞일 수 있어 앞 200자만 남긴다.
        console.error(
          `[chat] claude ${failure?.kind ?? 'failed'}: ${(error as Error).message.slice(0, 200)}`,
        );
        return offline(claudeNotice(error));
      } finally {
        session?.close();
      }
    }
    if (!config.openaiApiKey) return offline('AI 키가 서버에 설정되지 않아 자료 요약만 안내해요.');
    try {
      // 도구가 없는 제공자에는 지금 관측·덕장·배치·예보를 미리 담아 준다. 과거 기간 분석은 하지 않는다.
      const prepared = await Promise.all(
        [TOOL_NAMES.current, TOOL_NAMES.site, TOOL_NAMES.batches, TOOL_NAMES.forecast].map((name) =>
          runDirect(tool(name), signal),
        ),
      );
      const [current, overview, batches, forecast] = prepared;
      const context = {
        current: current.ok ? current.result : null,
        site: overview.ok ? overview.result : null,
        batches: batches.ok ? batches.result : null,
        forecast: forecast.ok ? forecast.result : null,
      };
      const response = await fetcher(`${config.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        signal: aiSignal(25000),
        body: JSON.stringify({
          model: config.openaiModel,
          stream: false,
          max_tokens: 600,
          messages: [
            { role: 'system', content: contextSystemPrompt(runtime, context) },
            ...request.history,
            { role: 'user', content: request.message },
          ],
        }),
      });
      signal.throwIfAborted();
      if (!response.ok) {
        return offline(
          response.status === 401 || response.status === 403
            ? 'AI 인증에 실패해 자료 요약만 안내해요.'
            : response.status === 429
              ? 'AI 요청 한도에 도달해 자료 요약만 안내해요.'
              : 'AI 응답을 받지 못해 자료 요약만 안내해요.',
        );
      }
      const text = readCompletionText(await response.json());
      signal.throwIfAborted();
      // 미리 담은 자료는 질문과 상관없이 모두 들어 있으므로, 카드는 질문 종류로 고른다.
      const asked = (call: ToolCall) =>
        call === current
          ? ASKS_CONDITIONS.test(request.message) || action === 'start-batch'
          : call === batches
            ? ASKS_BATCHES.test(request.message)
            : call === forecast
              ? ASKS_FORECAST.test(request.message)
              : true;
      const shown = prepared.map((call) => (asked(call) ? call : { ...call, card: undefined }));
      return await finish(text, llmProviderName(config), shown, false);
    } catch {
      signal.throwIfAborted();
      return offline('AI 연결 또는 응답 확인에 실패해 자료 요약만 안내해요.');
    }
  };
}
