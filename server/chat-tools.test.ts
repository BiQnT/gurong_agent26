import assert from 'node:assert/strict';
import test from 'node:test';
import { readChatReply } from '../src/lib/chat.ts';
import { assessDrying } from '../src/lib/drying.ts';
import type { LiveObservation, LiveSnapshot } from '../src/lib/live.ts';
import type { Batch, OperationsData } from '../src/lib/operations.ts';
import type { Team } from '../src/lib/workspace.ts';
import { createLiveChat, type ChatData, type LiveChatRequest } from './chat.ts';
import type { AgentAsk } from './claude-cli.ts';
import type { BridgeConfig } from './eum.ts';
import { toolAsk, type ToolResult } from './test-helpers/tool-ask.ts';

// AI 가 도구로 자료를 골라 보고, 서버가 부른 도구로 카드를 정하는 흐름 (ADR 0011).

const NOW = Date.parse('2026-10-09T13:00:00+09:00');
const observation: LiveObservation = {
  device: {
    id: '1',
    name: '구룡포 주상절리',
    address: '구룡포',
    latitude: 35.98,
    longitude: 129.55,
  },
  temperature: 16.9,
  humidity: 72.7,
  windSpeed: 0.1,
  observedAt: '2026-10-09T12:55:00+09:00',
  observedAtRaw: '2026-10-09 12:55:00',
  ageMinutes: 5,
  status: 'current',
  issues: [],
  distanceM: 266,
};
const snapshot: LiveSnapshot = {
  fetchedAt: '2026-10-09T04:00:00Z',
  source: 'E-UM 실시간 관측',
  sourceUrl: 'https://pohang-eum.kr',
  devices: [observation.device],
  observations: [observation],
  selected: observation,
  warnings: [],
  status: 'ok',
  llm: { configured: true, model: 'claude' },
  site: { id: 'site-1', name: 'QA-C 덕장', latitude: 35.981, longitude: 129.548 },
  weather: {
    precipitation: { type: '없음', rain1hMm: 0, observedAt: '2026-10-09T03:00:00Z' },
    rain: null,
    sun: { date: '2026-10-09', sunrise: '06:24', sunset: '17:56' },
    forecast: {
      issuedAt: '2026-10-09T03:30:00Z',
      hours: [
        {
          at: '2026-10-09T05:00:00Z',
          temperature: 9,
          humidity: 55,
          windSpeed: 3,
          precipitation: '없음',
          rain: null,
        },
        {
          at: '2026-10-09T06:00:00Z',
          temperature: 9,
          humidity: 88,
          windSpeed: 3,
          precipitation: '비',
          rain: '1mm',
        },
      ],
    },
  },
};
const graded: LiveSnapshot = {
  ...snapshot,
  assessment: assessDrying(observation, snapshot.weather),
};
const request = (message: string): LiveChatRequest => ({ message, siteId: 'site-1', history: [] });
const live = () => new AbortController().signal;

const sample = (iso: string, humidity: number) => ({
  at: iso,
  observedAt: iso,
  sourceDeviceId: '1',
  sourceDeviceName: '구룡포 주상절리',
  temperature: 6,
  humidity,
  wind: 3,
  distanceM: 266,
  alert: false,
});
const batch: Batch = {
  id: 'b1',
  name: '꽁치 1차',
  fish: '꽁치',
  quantity: 500,
  status: 'ongoing',
  startedAt: '2026-10-08T09:15:00.000Z',
  note: '',
  observations: [
    sample('2026-10-08T10:00:00.000Z', 50),
    sample('2026-10-08T10:30:00.000Z', 50),
    sample('2026-10-08T11:00:00.000Z', 90),
  ],
  logs: [],
};
const operations: OperationsData = { batches: [batch], guidance: [] };
// 다른 브랜치가 초대에 필드를 더해도 이 시험 자료는 그대로 쓸 수 있게 타입 단언으로 둔다.
const team = {
  members: [
    {
      id: 'u1',
      name: '운영자',
      email: 'owner@example.com',
      role: 'owner',
      language: 'ko',
      joinedAt: '2026-10-01T00:00:00Z',
    },
    {
      id: 'u2',
      name: 'Lan',
      email: 'lan@example.com',
      role: 'worker',
      language: 'vi',
      joinedAt: '2026-10-02T00:00:00Z',
    },
    {
      id: 'u3',
      name: '민수',
      email: 'ms@example.com',
      role: 'worker',
      language: 'ko',
      joinedAt: '2026-10-03T00:00:00Z',
    },
  ],
  invitations: [
    {
      id: 'i1',
      siteId: 'site-1',
      language: 'vi',
      status: 'pending',
      createdAt: '2026-10-05T00:00:00Z',
      expiresAt: '2026-10-12T00:00:00Z',
    },
  ],
} as Team;
const data: ChatData = {
  site: {
    name: 'QA-C 덕장',
    address: '구룡포읍 병포리',
    createdAt: '2026-10-01T00:00:00Z',
    latitude: 35.981,
    longitude: 129.548,
  },
  team: async () => team,
  operations: async () => operations,
};
const config: BridgeConfig = {
  eumServiceKey: 'test-eum',
  openaiApiKey: '',
  openaiModel: 'test',
  llmBaseUrl: 'https://api.openai.com/v1',
  timezoneOffset: '+09:00',
  staleAfterMinutes: 30,
  projectRoot: process.cwd(),
  llmProvider: 'claude',
  claude: {
    bin: 'claude',
    workdir: process.cwd(),
    authMode: 'subscription',
    maxBudgetUsd: 0.5,
    dailyBudgetUsd: 10,
    timeoutMs: 5000,
    maxConcurrency: 2,
  },
};
const chat = (ask: AgentAsk, options = {}) =>
  createLiveChat(config, undefined, ask, undefined, { now: () => NOW, ...options });

test('a team question gets a team answer: no drying card, no emails, counts by role and language', async () => {
  const seen: Parameters<typeof toolAsk>[2] = {};
  const reply = await chat(
    toolAsk([['get_site_overview']], '팀원은 세 분이에요. 운영자 한 분, 근로자 두 분이에요.', seen),
  )(request('지금 우리 팀에는 몇명이 있어?'), graded, live(), undefined, data);
  assert.equal(reply.provider, 'claude');
  assert.equal(reply.assessment, undefined);
  assert.equal(reply.observation, undefined);
  const result = seen.results![0].result as Record<string, Record<string, unknown>>;
  assert.deepEqual(result.team, {
    total: 3,
    owners: 1,
    workers: 2,
    korean: 2,
    vietnamese: 1,
    pendingInvites: 1,
  });
  assert.equal(result.batches.ongoing, 1);
  assert.equal(result.site.address, '구룡포읍 병포리');
  assert.ok(!JSON.stringify(result).includes('@example.com'));
  assert.ok(!JSON.stringify(result).includes('35.981'));
  // 시스템 프롬프트에는 오늘 날짜가 들어가 "어제", "지난주"를 풀 수 있다.
  assert.match(seen.system!, /지금 시각: 2026-10-09 \(금\) 13:00 KST/);
  assert.match(seen.system!, /덕장: QA-C 덕장/);
});

test('a batch question shows batch cards; the AI sees KST times and the screen gets ISO times', async () => {
  const seen: Parameters<typeof toolAsk>[2] = {};
  const reply = await chat(
    toolAsk(
      [['get_batches', { status: 'ongoing' }]],
      '꽁치 1차는 표본 3개 중 적합이 67%예요.',
      seen,
    ),
  )(request('이 배치 지금까지 어땠어?'), graded, live(), undefined, data);
  assert.equal(reply.provider, 'claude');
  assert.equal(reply.assessment, undefined);
  assert.equal(reply.batches?.length, 1);
  assert.equal(reply.batches![0].startedAt, '2026-10-08T09:15:00.000Z');
  assert.deepEqual(reply.batches![0].percentages, { 적합: 67, 주의: 0, 부적합: 33 });
  const model = (seen.results![0].result as { batches: { startedAt: string }[] }).batches[0];
  assert.equal(model.startedAt, '10.08 18:15 KST');
  // 화면 검사기가 카드를 받아들인다.
  const parsed = readChatReply(JSON.parse(JSON.stringify(reply)));
  assert.equal(parsed.batches?.[0].name, '꽁치 1차');
  assert.deepEqual(parsed.sources, ['배치 기록 1개']);
});

test('history comes from the external source when it answers, otherwise from batch records with a note', async () => {
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    at: new Date(Date.parse('2026-10-08T00:00:00+09:00') + h * 3_600_000).toISOString(),
    temperature: 8,
    humidity: h < 12 ? 50 : 70,
    windSpeed: 3,
    rainMm: 0,
  }));
  const asked: { from: string; to: string }[] = [];
  const seen: Parameters<typeof toolAsk>[2] = {};
  const reply = await chat(
    toolAsk(
      [['get_weather_history', { from: '2026-10-08', to: '2026-10-08' }]],
      (results: ToolResult[]) =>
        `어제는 적합 ${(results[0].result as { totals: { gradeHours: { 적합: number } } }).totals.gradeHours.적합}시간이었어요.`,
      seen,
    ),
    {
      history: async (range: { from: string; to: string }) => {
        asked.push(range);
        return {
          samples: hourly,
          source: '기상청 구룡포 AWS 시간자료',
          station: '기상청 구룡포 AWS',
          latitude: 35.9831,
          longitude: 129.5475,
          sampleMinutes: 60,
        };
      },
    },
  )(request('어제 날씨 어땠어?'), graded, live(), undefined, data);
  assert.deepEqual(asked, [{ from: '2026-10-08', to: '2026-10-08' }]);
  assert.equal(reply.provider, 'claude');
  assert.equal(reply.content, '어제는 적합 12시간이었어요.');
  assert.equal(reply.history?.[0].source, '기상청 구룡포 AWS 시간자료');
  assert.equal(reply.history?.[0].rows[0].bestWindow, '0~12시');
  assert.equal(reply.assessment, undefined);
  assert.match(
    reply.sources![0],
    /과거 관측: 기상청 구룡포 AWS 시간자료 · 2026-10-08~2026-10-08 · 결측 0%/,
  );

  // 외부 자료가 없으면 배치 기록으로, 한계를 note 로 알린다.
  const fallbackSeen: Parameters<typeof toolAsk>[2] = {};
  const fromRecords = await chat(
    toolAsk(
      [['get_weather_history', { from: '2026-10-08', to: '2026-10-08' }]],
      '배치 기록으로 보면 그래요.',
      fallbackSeen,
    ),
    { history: async () => null },
  )(request('어제 날씨 어땠어?'), graded, live(), undefined, data);
  const result = fallbackSeen.results![0].result as {
    source: string;
    samples: number;
    note: string;
  };
  assert.equal(result.source, '해풍 배치 기록(30분 수집)');
  assert.equal(result.samples, 3);
  assert.match(result.note, /배치가 진행 중일 때만/);
  assert.equal(fromRecords.history?.[0].samples, 3);
});

test('history inputs are checked: future dates, reversed or too long ranges come back as tool errors', async () => {
  const seen: Parameters<typeof toolAsk>[2] = {};
  await chat(
    toolAsk(
      [
        ['get_weather_history', { from: '2026-10-10', to: '2026-10-11' }],
        ['get_weather_history', { from: '2026-10-08', to: '2026-10-01' }],
        ['get_weather_history', { from: '2026-01-01', to: '2026-06-01' }],
        ['get_weather_history', { from: '2026-02-30', to: '2026-03-01' }],
        ['get_weather_history', { from: 'last week' }],
      ],
      '자료를 찾지 못했어요.',
      seen,
    ),
  )(request('내일 날씨 분석해줘'), graded, live(), undefined, data);
  assert.ok(seen.results!.every((item) => item.isError));
  const errors = seen.results!.map((item) => String(item.result));
  assert.match(errors[0], /미래 날짜예요\. 오늘은 2026-10-09/);
  assert.match(errors[1], /from 이 to 보다 늦어요/);
  assert.match(errors[2], /120일까지/);
  assert.match(errors[3], /없는 날짜/);
  assert.match(errors[4], /YYYY-MM-DD/);
});

test('forecast questions get the forecast card with expected grades, not the current verdict', async () => {
  const reply = await chat(
    toolAsk(
      [['get_forecast_outlook']],
      '예보로는 14시가 적합으로 예상돼요. 15시에는 비 예보가 있어요.',
    ),
  )(request('언제 널면 좋을까?'), graded, live(), undefined, data);
  assert.equal(reply.provider, 'claude');
  assert.deepEqual(
    reply.forecast?.hours.map((hour) => hour.expectedGrade),
    ['적합', '부적합'],
  );
  assert.equal(reply.assessment, undefined);
});

test('an answer with numbers that no tool gave is replaced by the tools own summary', async () => {
  const reply = await chat(
    toolAsk([['get_current_conditions']], '지금 습도가 95%라 널면 안 돼요.'),
  )(request('지금 널어도 돼?'), graded, live(), undefined, data);
  assert.equal(reply.provider, 'local');
  assert.match(reply.providerNotice ?? '', /확인되지 않은 숫자/);
  assert.match(reply.content, /^현재 규칙 판정은 '부적합'이에요\./);
  assert.equal(reply.assessment?.grade, '부적합');
  // 도구 숫자를 반올림해 쓴 답은 통과한다 (72.7% → 73%).
  const ok = await chat(
    toolAsk(
      [['get_current_conditions']],
      '지금은 부적합이에요. 기온이 17도로 높고 습도도 73%예요.',
    ),
  )(request('지금 널어도 돼?'), graded, live(), undefined, data);
  assert.equal(ok.provider, 'claude');
});

test('without the AI, a team question gets the team summary and no drying card', async () => {
  const failing: AgentAsk = async () => {
    const { ClaudeCliError } = await import('./claude-cli.ts');
    throw new ClaudeCliError('busy', 'busy');
  };
  const teamReply = await chat(failing)(
    request('우리 팀 몇 명이야?'),
    graded,
    live(),
    undefined,
    data,
  );
  assert.equal(teamReply.provider, 'local');
  assert.match(teamReply.content, /팀원 3명\(운영자 1명, 근로자 2명\)/);
  assert.equal(teamReply.assessment, undefined);
  const dryReply = await chat(failing)(request('지금 널어도 돼?'), graded, live(), undefined, data);
  assert.equal(dryReply.assessment?.grade, '부적합');
  const other = await chat(failing)(request('사용법 알려줘'), graded, live(), undefined, data);
  assert.equal(other.assessment, undefined);
  assert.match(other.content, /AI가 답하지 못해/);
});

test('two periods are compared item by item, and an unusable period is reported as not comparable', async () => {
  const day = (date: string, humidity: number) =>
    Array.from({ length: 24 }, (_, h) => ({
      at: new Date(Date.parse(`${date}T00:00:00+09:00`) + h * 3_600_000).toISOString(),
      temperature: 6,
      humidity,
      windSpeed: 3,
      rainMm: 0,
    }));
  const history = async (range: { from: string; to: string }) =>
    range.from === '2026-10-01'
      ? null
      : {
          samples: range.from.startsWith('2025') ? day('2025-10-08', 70) : day('2026-10-08', 50),
          source: '기상청 구룡포 AWS 시간자료',
          station: '기상청 구룡포 AWS',
          latitude: 35.9831,
          longitude: 129.5475,
          sampleMinutes: 60,
        };
  const seen: Parameters<typeof toolAsk>[2] = {};
  const reply = await chat(
    toolAsk(
      [
        [
          'compare_periods',
          {
            base_from: '2025-10-08',
            base_to: '2025-10-08',
            target_from: '2026-10-08',
            target_to: '2026-10-08',
          },
        ],
        [
          'compare_periods',
          {
            base_from: '2026-10-01',
            base_to: '2026-10-01',
            target_from: '2026-10-08',
            target_to: '2026-10-08',
          },
        ],
      ],
      '작년 같은 날보다 습도가 20%p 낮아 적합 비율이 100%p 높았어요.',
      seen,
    ),
    { history },
  )(request('작년 이맘때와 비교해줘'), graded, live(), undefined, data);
  const [compared, blocked] = seen.results!.map((item) => item.result as Record<string, unknown>);
  assert.equal(compared.comparable, true);
  assert.deepEqual(compared.differences, {
    temperatureMean: 0,
    humidityMean: -20,
    windSpeedMean: 0,
    rainMm: 0,
    suitableHours: 24,
    suitableShare: 100,
  });
  assert.match(String(compared.summary), /적합 비율 0% → 100% \(\+100%p\)/);
  // 기준 기간에 외부 자료가 없어 배치 기록으로 요약했고, 출처가 달라 비교하지 않는다.
  assert.equal(blocked.comparable, false);
  assert.equal(blocked.differences, null);
  assert.match(String(blocked.summary), /^비교 불가: /);
  // 도구가 계산한 차이만 쓴 답은 통과하고, 카드는 마지막 두 기간 요약이다.
  assert.equal(reply.provider, 'claude');
  assert.equal(reply.history?.length, 2);
});

test('a start message pre-fills fish and count for the start dialog, read by a fixed rule', async () => {
  const { startPrefill } = await import('./chat.ts');
  assert.deepEqual(startPrefill('방금 꽁치 1,200마리 널었어'), { fish: '꽁치', quantity: 1200 });
  assert.deepEqual(startPrefill('청어 널었어'), { fish: '청어' });
  assert.equal(startPrefill('널었어'), undefined);
  const reply = await chat(toolAsk([], '확인 버튼을 눌러 기록해 주세요.'))(
    request('방금 꽁치 300마리 널었어'),
    graded,
    live(),
    undefined,
    data,
  );
  assert.equal(reply.action, 'start-batch');
  assert.deepEqual(readChatReply(JSON.parse(JSON.stringify(reply))).prefill, {
    fish: '꽁치',
    quantity: 300,
  });
});
