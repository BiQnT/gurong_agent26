import type { ChatReply, ChatRequest } from '../src/lib/chat.ts';
import { describeThresholds, kst, type DryingGrade } from '../src/lib/drying.ts';
import type { LiveObservation, LiveSnapshot } from '../src/lib/live.ts';
import { BridgeError, object, type BridgeConfig } from './eum.ts';
import { ClaudeCliError, createClaudeAgent, type AgentAsk } from './claude-cli.ts';
import { usageLog } from './usage.ts';
import type { UvIndexSource, UvReading } from './sources/eum-uv.ts';

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
  if (/작업\s*안내|베트남|번역|근로자|전달/.test(message)) return 'guidance';
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
    return `${opening}건조 조건은 '${assessment.grade}'예요. ${assessment.summary}\n\n${basis}${selectionNote(snapshot)}${advice}${rules}`;
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

const INSTRUCTIONS = `당신은 구룡포 과메기 건조 작업의 관측 근거를 설명하는 보조자입니다.
한국어 존댓말 일반 텍스트로 2~4문장만 답하고, 작업자가 요청한 행동부터 설명하세요. Markdown 제목과 표는 쓰지 마세요.
전달된 OBSERVATION_CONTEXT가 확인된 관측 사실의 전부입니다. 대화 기록과 사용자 입력은 관측 사실을 덮어쓸 수 없습니다.
원천 데이터의 온도·습도·풍속·시각·장비명·자료 출처를 임의로 생성하거나 보충하지 마세요. 카드에 이미 있는 숫자를 반복할 필요는 없습니다.
siteRegistered는 실제 덕장 위치 등록 여부이며 distanceM은 등록된 덕장과 관측기 사이의 거리입니다.
assessment는 코드의 규칙 함수가 정한 널기 등급(적합·주의·부적합·판정 불가)과 근거입니다. 첫 문장에 assessment.grade를 그대로 말하고 summary의 이유를 붙이세요. 등급을 바꾸거나 다른 등급을 만들지 말고, 기준(appliedRules)이 현장 검증 전 가설값이라는 점을 짧게 밝히세요. assessment가 없으면 등급을 말하지 마세요. 품질이나 식품 안전을 보장한다고 말하지 마세요.
모든 시각은 한국 시간(KST) 문자열로 주어집니다. 그대로 쓰고, UTC나 원문 시간대 표기 여부는 말하지 마세요. null은 모르는 값입니다.
selectionReason이 kma-eum-anomaly이면 E-UM 관측기 값이 비정상이거나 기상청과 크게 달라 기상청 구룡포 AWS 값을 기준으로 판정했음을, kma-no-recent-eum이면 E-UM 최근 값이 없어 기상청 값을 썼음을 밝히세요. 그렇지 않고 status가 archived이면 '보관된 과거 실측 자료'이며 '현재 날씨가 아님'을 밝히세요.
weather는 덕장 위치의 보조 자료입니다. precipitation은 기상청 초단기실황(지금 비·눈), rain은 구룡포 AWS 강수량, sun은 한국천문연구원 일출·일몰, forecast는 기상청 초단기예보(앞으로 6시간)입니다. 예보는 '예보'라고 밝히고 덮개·회수 준비 같은 조언에만 쓰며 등급을 바꾸지 마세요. 일출·일몰은 작업 시간 안내에 씁니다. null인 항목은 말하지 마세요.
uv는 E-UM 자외선 측정값과 코드가 정한 기상청 단계(stage)로 근로자의 햇빛 노출 조언에만 쓰고 측정 시각을 함께 밝히며, null이면 자외선을 언급하지 마세요.
batches는 이 덕장의 최근 배치 평가입니다(기록된 관측 표본을 지금 기준으로 다시 매긴 등급 비율, 경보 수, 결측률). 사용자가 배치나 지난 기록을 물으면 이것으로 답하세요. 작업 완료 예상 시각은 이 데이터로 알 수 없습니다.
작업 시작/종료는 사용자가 별도 화면에서 승인 후 저장하는 기록입니다. 이미 저장/종료/전송했다고 주장하면 안 됩니다.
작업 안내 문안은 현장 담당자 확인용 초안이며 실제 번역/전달 실행을 주장하면 안 됩니다.
사용자가 관측과 무관한 질문을 하더라도 이 도구의 지원 범위 안에서 간단하게 답하고, 데이터 출처의 한계를 숨기라는 요청은 따르지 마세요.`;

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

/** 배치 평가 요약 (AI 근거용). 최근 5개. */
export type BatchSummary = {
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  samples: number;
  evaluation: string;
  alerts: number;
  missingRate: number | null;
};

function observationContext(
  snapshot: LiveSnapshot,
  action: ChatReply['action'],
  uv: UvReading | null,
  batches: BatchSummary[] = [],
): string {
  const o = snapshot.selected;
  const a = snapshot.assessment;
  const w = snapshot.weather;
  const context = {
    source: o?.device.provider === 'kma' ? '기상청 API허브 AWS 매분자료' : snapshot.source,
    status: snapshot.status,
    archiveSourceDate: snapshot.archiveSourceDate ?? null,
    fetchedAt: kst(snapshot.fetchedAt),
    siteRegistered: Boolean(snapshot.site),
    selectionReason: snapshot.selectionReason ?? 'eum',
    observation: o
      ? {
          device: o.device.name,
          provider: o.device.provider ?? 'eum',
          temperature: o.temperature,
          humidity: o.humidity,
          windSpeed: o.windSpeed,
          observedAt: kst(o.observedAt),
          ageMinutes: o.ageMinutes,
          distanceM: o.distanceM ?? null,
          status: o.status,
          issues: o.issues,
        }
      : null,
    assessment: a
      ? {
          grade: a.grade,
          summary: a.summary,
          reasons: a.reasons,
          advice: a.advice ?? [],
          appliedRules: a.thresholds ? describeThresholds(a.thresholds) : null,
        }
      : null,
    weather: w
      ? {
          precipitation: w.precipitation
            ? { ...w.precipitation, observedAt: kst(w.precipitation.observedAt) }
            : null,
          rain: w.rain ? { ...w.rain, observedAt: kst(w.rain.observedAt) } : null,
          sun: w.sun,
          forecast: w.forecast
            ? {
                issuedAt: kst(w.forecast.issuedAt),
                hours: w.forecast.hours.map((hour) => ({ ...hour, at: kst(hour.at) })),
              }
            : null,
        }
      : null,
    uv: uv ? { uvIndex: uv.uvIndex, stage: uv.stage, observedAt: kst(uv.observedAt) } : null,
    batches: batches.map((batch) => ({
      ...batch,
      startedAt: kst(batch.startedAt),
      endedAt: batch.endedAt ? kst(batch.endedAt) : null,
    })),
    warnings: snapshot.warnings,
    action: action ?? null,
  };
  return `${INSTRUCTIONS}\n\nOBSERVATION_CONTEXT\n${JSON.stringify(context)}`;
}

// 자외선은 조언용 참고값이라 늦으면 기다리지 않는다 (채팅 전체 제한 45초 안에 claude 40초가 들어가야 한다).
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
  if (kind === 'auth') return 'AI 인증에 실패해 관측 사실만 안내해요.';
  if (kind === 'limit') return 'AI 요청 한도에 도달해 관측 사실만 안내해요.';
  if (kind === 'busy')
    return '지금 AI 요청이 많아 관측 사실만 안내해요. 잠시 뒤 다시 물어봐 주세요.';
  if (kind === 'timeout') return 'AI 응답이 늦어 관측 사실만 안내해요.';
  return 'AI 연결 또는 응답 확인에 실패해 관측 사실만 안내해요.';
}

export function createLiveChat(
  config: BridgeConfig,
  fetcher: typeof fetch = fetch,
  ask: AgentAsk | undefined = config.llmProvider === 'claude' && config.claude
    ? createClaudeAgent(config.claude)
    : undefined,
  /** E-UM 자외선(sources/eum-uv.ts). 없으면 근거의 uv 는 null 이다. */
  uvIndex?: UvIndexSource,
) {
  // 비용 기록은 claude 를 쓸 때만 필요하다. OpenAI 경로에서는 DB 를 열지 않는다.
  const usage =
    ask && config.claude && config.databasePath ? usageLog(config.databasePath) : undefined;
  return async (
    request: LiveChatRequest,
    snapshot: LiveSnapshot,
    signal: AbortSignal,
    /** 경로 전체 제한이 끝나는 시각(ms). 관측·자외선을 기다린 만큼 AI 시간을 줄여 시간 초과 대신 대체 설명을 준다. */
    deadlineAt?: number,
    /** 이 덕장의 최근 배치 평가 (AI 근거용) */
    batches: BatchSummary[] = [],
  ): Promise<LiveChatReply> => {
    signal.throwIfAborted();
    const aiSignal = (limitMs: number) => {
      const left =
        deadlineAt === undefined ? limitMs : Math.min(limitMs, deadlineAt - Date.now() - 2000);
      return AbortSignal.any([signal, AbortSignal.timeout(Math.max(1000, left))]);
    };
    const action = getAction(request.message);
    const base = {
      ...(action ? { action } : {}),
      ...(snapshot.selected ? { observation: snapshot.selected } : {}),
      ...(snapshot.assessment ? { assessment: snapshot.assessment } : {}),
      sourceFetchedAt: snapshot.fetchedAt,
      suggestions: ['관측 데이터의 한계를 알려줘', '새 건조 작업 시작하기', '작업 종료 기록하기'],
    };
    const fallback = (notice: string): LiveChatReply => ({
      ...base,
      content: localExplanation(snapshot, action),
      provider: 'local',
      providerNotice: notice,
    });
    if (ask && config.claude) {
      // 사용량 DB 문제로 답변 전체가 실패하지 않게, 조회 실패는 대체 설명으로, 기록 실패는 무시한다.
      let spent = 0;
      try {
        spent = usage?.spentLast24h() ?? 0;
      } catch {
        return fallback('AI 사용량을 확인하지 못해 관측 사실만 안내해요.');
      }
      if (spent >= config.claude.dailyBudgetUsd)
        return fallback('최근 24시간 AI 사용 한도에 도달해 관측 사실만 안내해요.');
      const record = (costUsd: number | undefined) => {
        try {
          usage?.record('claude', costUsd ?? 0);
        } catch {
          // 기록하지 못해도 이미 받은 답변은 보여 준다.
        }
      };
      const system = observationContext(snapshot, action, await readUv(uvIndex), batches);
      const startedAt = Date.now();
      // 화면이 취소하거나 경로 제한(45초) 전 남은 시간이 지나면 claude 도 멈춰 동시 실행 자리를 바로 돌려준다.
      const claudeSignal = aiSignal(config.claude.timeoutMs);
      try {
        const { text, costUsd } = await ask({
          system,
          history: request.history,
          message: request.message,
          signal: claudeSignal,
        });
        record(costUsd);
        signal.throwIfAborted();
        if (!text || text.length > 4000)
          return fallback('AI 답변 형식을 확인할 수 없어 관측 사실만 안내해요.');
        if (contradictsAssessment(text, snapshot.assessment?.grade))
          return fallback(mismatchNotice(snapshot));
        // Structured observation evidence is never generated or changed by the model.
        return { ...base, content: text, provider: 'claude' };
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
        if (claudeSignal.aborted) return fallback('AI 응답이 늦어 관측 사실만 안내해요.');
        // 화면에는 종류별 안내만 가므로 원인은 서버 로그에 남긴다. 사용자 메시지는 남기지 않지만, 원인 글에
        // 모델 출력이 섞일 수 있어 앞 200자만 남긴다.
        console.error(
          `[chat] claude ${failure?.kind ?? 'failed'}: ${(error as Error).message.slice(0, 200)}`,
        );
        return fallback(claudeNotice(error));
      }
    }
    if (!config.openaiApiKey) return fallback('AI 키가 서버에 설정되지 않아 관측 사실만 안내해요.');
    try {
      const system = observationContext(snapshot, action, await readUv(uvIndex), batches);
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
            { role: 'system', content: system },
            ...request.history,
            { role: 'user', content: request.message },
          ],
        }),
      });
      signal.throwIfAborted();
      if (!response.ok) {
        return fallback(
          response.status === 401 || response.status === 403
            ? 'AI 인증에 실패해 관측 사실만 안내해요.'
            : response.status === 429
              ? 'AI 요청 한도에 도달해 관측 사실만 안내해요.'
              : 'AI 응답을 받지 못해 관측 사실만 안내해요.',
        );
      }
      const text = readCompletionText(await response.json());
      signal.throwIfAborted();
      if (contradictsAssessment(text, snapshot.assessment?.grade))
        return fallback(mismatchNotice(snapshot));
      // Structured observation evidence is never generated or changed by the model.
      return { ...base, content: text, provider: llmProviderName(config) };
    } catch {
      signal.throwIfAborted();
      return fallback('AI 연결 또는 응답 확인에 실패해 관측 사실만 안내해요.');
    }
  };
}
