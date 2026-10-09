import {
  forecastOutlook,
  kstDate,
  kstMidnight,
  summarizeHistory,
  type BatchDigest,
  type ForecastOutlook,
  type HistorySample,
  type HistorySummary,
} from '../src/lib/analysis.ts';
import { describeThresholds, gradeIs, kst } from '../src/lib/drying.ts';
import { distanceMeters } from '../src/lib/geo.ts';
import type { LiveSnapshot } from '../src/lib/live.ts';
import type { OperationsData } from '../src/lib/operations.ts';
import type { Team } from '../src/lib/workspace.ts';
import { batchHistorySamples, digestBatches } from './assessment.ts';
import type { UvReading } from './sources/eum-uv.ts';
import type { ToolDefinition } from './tool-server.ts';

// AI 도우미가 부르는 읽기 전용 도구 6개 (ADR 0011). 모두 한 덕장 범위이고, 숫자는 코드가 계산한다.
// 도구 결과의 summary 는 코드가 만든 문장이라, AI 답이 검사에 걸리면 이 문장으로 대신 답한다.

/** 외부 과거 관측 (기상청 AWS 등). 없거나 실패하면 null 이고, 그때는 우리 DB 배치 표본을 쓴다. */
export type WeatherHistory = {
  samples: HistorySample[];
  source: string;
  station: string;
  latitude: number;
  longitude: number;
  sampleMinutes: number;
};
export type WeatherHistorySource = (
  range: { from: string; to: string },
  signal: AbortSignal,
) => Promise<WeatherHistory | null>;

export type ToolContext = {
  /** 덕장 기준으로 고르고 규칙 판정을 붙인 관측 (채팅 요청 때 이미 받아 둔 것) */
  snapshot: LiveSnapshot;
  site: { name: string; address: string; createdAt: string; latitude: number; longitude: number };
  uv: () => Promise<UvReading | null>;
  team: () => Promise<Team>;
  operations: () => Promise<OperationsData | null>;
  history?: WeatherHistorySource;
  now: () => number;
};

/**
 * 도구가 성공했을 때 화면 카드로 보낼 자료. AI 에게 주는 결과는 시각을 KST 글로 바꾸지만,
 * 카드는 화면이 시간대를 다루도록 ISO 시각 그대로 둔다.
 */
export type ToolCard =
  | { kind: 'current' }
  | { kind: 'history'; data: HistorySummary }
  | { kind: 'forecast'; data: ForecastOutlook }
  | { kind: 'batches'; data: BatchDigest[] };

export const TOOL_NAMES = {
  current: 'get_current_conditions',
  site: 'get_site_overview',
  batches: 'get_batches',
  history: 'get_weather_history',
  compare: 'compare_periods',
  forecast: 'get_forecast_outlook',
} as const;

/** 한 번에 조회할 수 있는 과거 기간 (일). 길면 주 단위로 묶는다. */
export const MAX_HISTORY_DAYS = 120;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const noInput = { type: 'object', properties: {}, additionalProperties: false };

function readRange(input: Record<string, unknown>, now: number): { from: string; to: string } {
  const { from, to } = input;
  const today = kstDate(now);
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE.test(from) || !DATE.test(to))
    throw new Error('from 과 to 는 YYYY-MM-DD 형식의 날짜여야 해요.');
  // 2월 30일처럼 없는 날짜는 다른 날로 넘어가므로 되돌려 확인한다.
  if (kstDate(kstMidnight(from)) !== from || kstDate(kstMidnight(to)) !== to)
    throw new Error('없는 날짜예요.');
  if (from > to) throw new Error('from 이 to 보다 늦어요.');
  if (from > today)
    throw new Error(`미래 날짜예요. 오늘은 ${today} 이에요. 앞으로의 날씨는 예보 도구를 쓰세요.`);
  const end = to > today ? today : to;
  const days = Math.round((kstMidnight(end) - kstMidnight(from)) / 86_400_000) + 1;
  if (days > MAX_HISTORY_DAYS)
    throw new Error(`한 번에 ${MAX_HISTORY_DAYS}일까지 조회할 수 있어요. 기간을 나눠 주세요.`);
  return { from, to: end };
}

function currentConditions(snapshot: LiveSnapshot, uv: UvReading | null) {
  const o = snapshot.selected;
  const a = snapshot.assessment;
  const w = snapshot.weather;
  return {
    summary: a
      ? `현재 규칙 판정은 ${gradeIs(a.grade)}. ${a.summary}`
      : '덕장 기준 판정을 만들 수 없어요.',
    source: o?.device.provider === 'kma' ? '기상청 API허브 AWS 매분자료' : snapshot.source,
    status: snapshot.status,
    archiveSourceDate: snapshot.archiveSourceDate ?? null,
    fetchedAt: kst(snapshot.fetchedAt),
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
        }
      : null,
    uv: uv ? { uvIndex: uv.uvIndex, stage: uv.stage, observedAt: kst(uv.observedAt) } : null,
    warnings: snapshot.warnings,
  };
}

/** AI 에게는 배치 시각을 KST 글로 준다. */
const batchForModel = (batch: BatchDigest) => ({
  ...batch,
  startedAt: kst(batch.startedAt),
  endedAt: batch.endedAt ? kst(batch.endedAt) : null,
  firstUnsuitableAt: batch.firstUnsuitableAt ? kst(batch.firstUnsuitableAt) : null,
});

/** 비교할 수 없는 조건 (신청서 US-4: 값을 추정하지 않고 비교 불가와 원인을 준다). */
const MAX_COMPARE_MISSING = 50;
const diff = (target: number | null, base: number | null) =>
  target === null || base === null ? null : Math.round((target - base) * 10) / 10;

/** 두 기간 요약의 항목별 차이 (비교 - 기준). 항목을 합친 점수는 만들지 않는다. */
export function compareHistory(
  base: HistorySummary,
  target: HistorySummary,
  notes: (string | undefined)[] = [],
) {
  const period = (item: HistorySummary) => `${item.from}~${item.to}`;
  const reasons: string[] = [];
  for (const [label, item] of [
    ['기준', base],
    ['비교', target],
  ] as const) {
    const rated =
      item.totals.gradeHours.적합 + item.totals.gradeHours.주의 + item.totals.gradeHours.부적합;
    if (!rated) reasons.push(`${label} 기간(${period(item)})에 판정할 자료가 없어요.`);
    else if (item.missingRate > MAX_COMPARE_MISSING)
      reasons.push(`${label} 기간(${period(item)})의 결측이 ${item.missingRate}%로 많아요.`);
  }
  if (base.source !== target.source || base.station !== target.station)
    reasons.push(`두 기간의 자료 출처가 달라요 (${base.station} · ${target.station}).`);
  const side = (item: HistorySummary) => ({
    period: period(item),
    source: item.source,
    station: item.station,
    distanceM: item.distanceM,
    missingRate: item.missingRate,
    temperatureMean: item.totals.temperature.mean,
    humidityMean: item.totals.humidity.mean,
    windSpeedMean: item.totals.windSpeed.mean,
    rainMm: item.rainKnown ? (item.totals.rainMm ?? 0) : null,
    suitableHours: item.totals.gradeHours.적합,
    suitableShare: item.totals.percentages.적합,
  });
  const a = side(base);
  const b = side(target);
  if (reasons.length)
    return {
      summary: `비교 불가: ${reasons.join(' ')}`,
      comparable: false,
      reasons,
      base: a,
      target: b,
      differences: null,
      notes: notes.filter(Boolean),
    };
  const differences = {
    temperatureMean: diff(b.temperatureMean, a.temperatureMean),
    humidityMean: diff(b.humidityMean, a.humidityMean),
    windSpeedMean: diff(b.windSpeedMean, a.windSpeedMean),
    rainMm: diff(b.rainMm, a.rainMm),
    suitableHours: diff(b.suitableHours, a.suitableHours),
    suitableShare: diff(b.suitableShare, a.suitableShare),
  };
  const signed = (value: number | null, unit: string) =>
    value === null ? '알 수 없음' : `${value > 0 ? '+' : ''}${value}${unit}`;
  return {
    summary:
      `${a.period} 대비 ${b.period}: 평균 기온 ${signed(differences.temperatureMean, '°C')}, ` +
      `평균 습도 ${signed(differences.humidityMean, '%p')}, 평균 풍속 ${signed(differences.windSpeedMean, 'm/s')}, ` +
      `적합 비율 ${a.suitableShare}% → ${b.suitableShare}% (${signed(differences.suitableShare, '%p')}).`,
    comparable: true,
    reasons,
    base: a,
    target: b,
    differences,
    notes: notes.filter(Boolean),
  };
}

/** 도구 목록과, 성공한 도구가 채우는 카드 목록을 만든다. 채팅 요청 하나에 한 번 만든다. */
export function createAgentTools(context: ToolContext): {
  tools: ToolDefinition[];
  cards: ToolCard[];
} {
  const { snapshot, site } = context;
  const cards: ToolCard[] = [];

  /** 기간 요약. 외부 과거 관측이 있으면 그것을, 없으면 이 덕장의 배치 기록을 쓴다. */
  async function historyFor(
    range: { from: string; to: string },
    signal: AbortSignal,
  ): Promise<{ summary: HistorySummary; note?: string }> {
    const now = context.now();
    const external = context.history
      ? await context.history(range, signal).catch(() => null)
      : null;
    if (external?.samples.length)
      return {
        summary: summarizeHistory({
          samples: external.samples,
          ...range,
          source: external.source,
          station: external.station,
          distanceM: Math.round(distanceMeters(site, external)),
          sampleMinutes: external.sampleMinutes,
          now,
        }),
      };
    const operations = await context.operations();
    return {
      summary: summarizeHistory({
        samples: operations ? batchHistorySamples(operations) : [],
        ...range,
        source: '해풍 배치 기록(30분 수집)',
        station: '덕장 1km 안 관측기',
        distanceM: null,
        sampleMinutes: 30,
        now,
      }),
      note: context.history
        ? '외부 과거 관측을 받지 못해 이 덕장의 배치 기록만 썼어요. 배치가 진행 중일 때만 쌓인 자료라 비어 있는 시간이 많을 수 있어요.'
        : '이 덕장의 배치 기록만 썼어요. 배치가 진행 중일 때만 쌓인 자료라 비어 있는 시간이 많을 수 있어요.',
    };
  }

  const tools: ToolDefinition[] = [
    {
      name: TOOL_NAMES.current,
      description:
        '지금 덕장 기준 관측(기온·습도·풍속, 측정 시각, 관측기와 거리), 규칙 함수의 현재 널기 등급과 이유, 지금 비·눈, 오늘 강수량, 일출·일몰, 자외선. "지금/오늘 널어도 돼?", "지금 날씨·바람·습도", "관측값 출처" 같은 현재 상태 질문에만 부른다.',
      inputSchema: noInput,
      run: async () => {
        const result = currentConditions(snapshot, await context.uv());
        cards.push({ kind: 'current' });
        return result;
      },
    },
    {
      name: TOOL_NAMES.site,
      description:
        '덕장 이름·주소·등록일, 가까운 관측기와 거리, 팀 인원(역할·언어별 수), 초대 대기 수, 배치 수(진행·종료·취소), 작업 안내와 답을 기다리는 근로자 질문 수. 덕장·팀·관측기 위치에 관한 질문에 부른다.',
      inputSchema: noInput,
      run: async () => {
        const [team, operations] = await Promise.all([context.team(), context.operations()]);
        const members = team.members;
        const count = (predicate: (member: (typeof members)[number]) => boolean) =>
          members.filter(predicate).length;
        const pending = team.invitations.filter((invite) => invite.status === 'pending').length;
        const batches = operations?.batches ?? [];
        const guidance = operations?.guidance ?? [];
        const waiting = guidance
          .flatMap((item) => item.replies)
          .filter((reply) => reply.kind === 'question' && !reply.answer).length;
        const devices = snapshot.observations
          .filter((item) => typeof item.distanceM === 'number')
          .sort((a, b) => (a.distanceM as number) - (b.distanceM as number))
          .slice(0, 3)
          .map((item) => ({
            name: item.device.name,
            provider: item.device.provider ?? 'eum',
            distanceM: item.distanceM,
            status: item.status,
            observedAt: kst(item.observedAt),
          }));
        const ongoing = batches.filter((batch) => batch.status === 'ongoing').length;
        return {
          summary:
            `${site.name}: 팀원 ${members.length}명(운영자 ${count((m) => m.role === 'owner')}명, 근로자 ${count((m) => m.role === 'worker')}명), ` +
            `초대 대기 ${pending}건, 진행 중인 배치 ${ongoing}개, 답을 기다리는 질문 ${waiting}건.`,
          site: { name: site.name, address: site.address, registeredAt: kst(site.createdAt) },
          nearestDevices: devices,
          team: {
            total: members.length,
            owners: count((m) => m.role === 'owner'),
            workers: count((m) => m.role === 'worker'),
            korean: count((m) => m.language === 'ko'),
            vietnamese: count((m) => m.language === 'vi'),
            pendingInvites: pending,
          },
          batches: {
            ongoing,
            completed: batches.filter((batch) => batch.status === 'completed').length,
            cancelled: batches.filter((batch) => batch.status === 'cancelled').length,
          },
          guidance: { total: guidance.length, questionsWaitingForAnswer: waiting },
        };
      },
    },
    {
      name: TOOL_NAMES.batches,
      description:
        '이 덕장의 건조 배치(작업) 기록 요약: 원물·마리 수, 시작·종료, 걸린 시간, 기온·습도·풍속 최소·최대·평균, 결측률, 표본을 지금 기준으로 다시 매긴 등급 비율, 경보 수. "이 배치 어땠어?", "지난 작업들 비교" 같은 질문에 부른다.',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['ongoing', 'completed', 'cancelled', 'all'],
            description: '진행 중(ongoing)·종료(completed)·취소(cancelled)·전체(all). 기본 all',
          },
          limit: { type: 'integer', minimum: 1, maximum: 10, description: '최대 개수. 기본 5' },
        },
        additionalProperties: false,
      },
      run: async (input) => {
        const operations = await context.operations();
        if (!operations) throw new Error('배치 기록을 읽지 못했어요.');
        const status =
          input.status === 'ongoing' || input.status === 'completed' || input.status === 'cancelled'
            ? input.status
            : undefined;
        const limit =
          typeof input.limit === 'number' && Number.isInteger(input.limit)
            ? Math.min(10, Math.max(1, input.limit))
            : 5;
        const batches = digestBatches(operations, context.now(), { status, limit });
        if (batches.length) cards.push({ kind: 'batches', data: batches });
        return {
          summary: batches.length
            ? batches.map((batch) => batch.summary).join(' ')
            : '조건에 맞는 배치 기록이 없어요.',
          batches: batches.map(batchForModel),
          note: '등급 비율은 기록된 표본을 지금 기준으로 다시 매긴 값이고, 기록에 그때의 비·눈이 없어 세 축(기온·습도·풍속)만 썼어요.',
        };
      },
    },
    {
      name: TOOL_NAMES.history,
      description: `과거 기간(from~to, KST 날짜)의 덕장 주변 관측을 일 단위(31일 이하) 또는 주 단위로 요약: 기온·습도·풍속 평균·최저·최고, 강수량, 규칙 함수로 매긴 적합·주의·부적합 시간, 그날 가장 긴 적합 구간, 결측률, 자료 출처와 덕장까지 거리. 한 번에 ${MAX_HISTORY_DAYS}일까지. "지난주/어제/작년 12월 날씨·건조 조건 분석"에 쓴다. 두 기간 비교는 compare_periods 를 쓴다. 오늘 이후는 조회할 수 없다.`,
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '시작 날짜 YYYY-MM-DD (KST)' },
          to: { type: 'string', description: '끝 날짜 YYYY-MM-DD (KST, 이 날 포함)' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
      run: async (input, signal) => {
        const { summary, note } = await historyFor(readRange(input, context.now()), signal);
        cards.push({ kind: 'history', data: summary });
        return note ? { ...summary, note } : summary;
      },
    },
    {
      name: TOOL_NAMES.compare,
      description:
        '두 과거 기간(기준 base, 비교 target)을 같은 방법으로 요약하고 항목별 차이(비교 - 기준)를 계산한다: 평균 기온·습도·풍속, 강수량, 적합 시간과 적합 비율. 합친 점수는 없다. 자료가 비거나 결측이 많거나 출처가 다르면 비교 불가와 이유를 준다. "작년 이맘때와 비교", "이번 주랑 지난주 비교"에 쓴다.',
      inputSchema: {
        type: 'object',
        properties: {
          base_from: { type: 'string', description: '기준 기간 시작 YYYY-MM-DD (KST)' },
          base_to: { type: 'string', description: '기준 기간 끝 YYYY-MM-DD (KST, 포함)' },
          target_from: { type: 'string', description: '비교 기간 시작 YYYY-MM-DD (KST)' },
          target_to: { type: 'string', description: '비교 기간 끝 YYYY-MM-DD (KST, 포함)' },
        },
        required: ['base_from', 'base_to', 'target_from', 'target_to'],
        additionalProperties: false,
      },
      run: async (input, signal) => {
        const now = context.now();
        const baseRange = readRange({ from: input.base_from, to: input.base_to }, now);
        const targetRange = readRange({ from: input.target_from, to: input.target_to }, now);
        const [base, target] = await Promise.all([
          historyFor(baseRange, signal),
          historyFor(targetRange, signal),
        ]);
        cards.push({ kind: 'history', data: base.summary });
        cards.push({ kind: 'history', data: target.summary });
        return compareHistory(base.summary, target.summary, [base.note, target.note]);
      },
    },
    {
      name: TOOL_NAMES.forecast,
      description:
        '기상청 초단기예보(앞으로 약 6시간) 시간마다 같은 규칙 함수로 매긴 예상 널기 등급과 예보 기온·습도·풍속·강수. "언제 널면 좋아?", "오후에 비 와?", "이따가 회수해야 해?" 같은 질문에 부른다. 예상 등급은 현재 등급이 아니다.',
      inputSchema: noInput,
      run: async () => {
        const forecast = snapshot.weather?.forecast;
        if (!forecast?.hours.length) throw new Error('기상청 예보를 받지 못했어요.');
        const outlook = forecastOutlook(forecast);
        cards.push({ kind: 'forecast', data: outlook });
        return {
          ...outlook,
          issuedAt: kst(outlook.issuedAt),
          hours: outlook.hours.map((hour) => ({ ...hour, at: kst(hour.at) })),
        };
      },
    },
  ];
  return { tools, cards };
}
