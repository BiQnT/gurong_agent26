import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import Database from 'better-sqlite3';
import type { LiveObservation, LiveSnapshot } from '../src/lib/live.ts';
import { readChatReply } from '../src/lib/chat.ts';
import { createLiveChat, localExplanation, type LiveChatRequest } from './chat.ts';
import { ClaudeCliError, type AgentAsk, type ClaudeFailure } from './claude-cli.ts';
import type { BridgeConfig } from './eum.ts';
import { cleanupFakes, makeFakeClaude, readFixture } from './fixtures/fake-claude.ts';
import { usageLog } from './usage.ts';

const tempDirs: string[] = [];
function tempDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chat-claude-'));
  tempDirs.push(dir);
  return join(dir, 'haepung.db');
}
after(() => {
  cleanupFakes();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const SECRETS = { eum: 'test-eum-secret-xyz', openai: 'test-openai-secret-xyz' };
const observation: LiveObservation = {
  device: {
    id: '1',
    name: '구룡포 해안 관측기',
    address: '구룡포',
    latitude: 35.98,
    longitude: 129.55,
  },
  temperature: 4.2,
  humidity: 61,
  windSpeed: 3.1,
  observedAt: '2026-10-04T09:00:00+09:00',
  observedAtRaw: '2026-10-04 09:00:00',
  ageMinutes: 5,
  status: 'current',
  issues: [],
  distanceM: 320,
};
const snapshot: LiveSnapshot = {
  fetchedAt: '2026-10-04T00:05:00Z',
  source: 'E-UM 실시간 관측',
  sourceUrl: 'https://pohang-eum.kr',
  devices: [observation.device],
  observations: [observation],
  selected: observation,
  warnings: [],
  status: 'ok',
  llm: { configured: true, model: 'claude · sonnet' },
};
const request: LiveChatRequest = {
  message: '오늘 관측 상태를 설명해 줘',
  siteId: 'site-1',
  history: [{ role: 'user', content: '이전 질문' }],
};
const live = () => new AbortController().signal;

function bridge(
  claude: NonNullable<BridgeConfig['claude']>,
  extra: Partial<BridgeConfig> = {},
): BridgeConfig {
  return {
    eumServiceKey: SECRETS.eum,
    openaiApiKey: SECRETS.openai,
    openaiModel: 'test-model',
    llmBaseUrl: 'https://api.openai.com/v1',
    timezoneOffset: '+09:00',
    staleAfterMinutes: 30,
    projectRoot: process.cwd(),
    llmProvider: 'claude',
    claude,
    ...extra,
  };
}

const answer = (result: string) => readFixture('claude-result-success.json', { result });

test('claude answers are returned as provider claude without touching the observation', async () => {
  const fake = makeFakeClaude({
    stdout: answer('E-UM 관측값을 확인했어요. 건조 적합 여부는 판정할 수 없어요.'),
  });
  const before = structuredClone(snapshot);
  // ask 를 넘기지 않으면 설정(llmProvider: claude)만으로 claude 제공자가 연결된다.
  const reply = await createLiveChat(bridge(fake.config))(request, snapshot, live());
  assert.equal(reply.provider, 'claude');
  assert.equal(reply.content, 'E-UM 관측값을 확인했어요. 건조 적합 여부는 판정할 수 없어요.');
  assert.equal(reply.providerNotice, undefined);
  assert.deepEqual(reply.observation, before.selected);
  assert.equal(reply.sourceFetchedAt, snapshot.fetchedAt);
  assert.deepEqual(snapshot, before);
  assert.equal(reply.assessment, undefined);

  // OpenAI 경로와 같은 근거 맥락이 시스템 프롬프트로 가고, 비밀값은 가지 않는다.
  const [call] = fake.calls();
  const system = call.argv[call.argv.indexOf('--system-prompt') + 1];
  assert.match(system, /OBSERVATION_CONTEXT/);
  assert.match(system, /구룡포 해안 관측기/);
  assert.match(system, /"assessment":"판정 불가"/);
  assert.ok(
    !JSON.stringify(call).includes(SECRETS.eum) && !JSON.stringify(call).includes(SECRETS.openai),
  );
  assert.match(call.stdin, /\[사용자\] 이전 질문/);
  assert.match(call.stdin, /지금 질문:\n오늘 관측 상태를 설명해 줘$/);
  // 화면 쪽 응답 검사기가 claude 제공자를 알아본다.
  const parsed = readChatReply({
    content: reply.content,
    suggestions: reply.suggestions,
    provider: reply.provider,
  });
  assert.equal(parsed.provider, 'claude');
});

test('verdict-like or malformed claude answers fall back to the local explanation', async () => {
  for (const [text, notice] of [
    ['지금 널어도 괜찮습니다.', /확인되지 않은 판정/],
    ['오늘은 건조에 적합합니다.', /확인되지 않은 판정/],
    ['가'.repeat(4001), /형식/],
    ['', /형식/],
  ] as const) {
    const fake = makeFakeClaude({ stdout: answer(text) });
    const reply = await createLiveChat(bridge(fake.config))(request, snapshot, live());
    assert.equal(reply.provider, 'local', text.slice(0, 20));
    assert.match(reply.providerNotice ?? '', notice);
    assert.match(reply.content, /E-UM의 구룡포 해안 관측기 관측값을 확인했어요/);
    assert.ok(!reply.content.includes('괜찮습니다'));
    assert.deepEqual(reply.observation, observation);
  }
});

test('every claude failure kind falls back with its own Korean notice and no raw reason', async () => {
  const notices: [ClaudeFailure, RegExp][] = [
    ['auth', /인증에 실패/],
    ['limit', /요청 한도/],
    ['busy', /요청이 많아/],
    ['timeout', /응답이 늦어/],
    ['failed', /연결 또는 응답 확인에 실패/],
    ['aborted', /연결 또는 응답 확인에 실패/],
  ];
  for (const [kind, notice] of notices) {
    const ask: AgentAsk = async () => {
      throw new ClaudeCliError(kind, 'raw reason with sk-ant-secret-token');
    };
    const reply = await createLiveChat(bridge(makeFakeClaude({}).config), undefined, ask)(
      request,
      snapshot,
      live(),
    );
    assert.equal(reply.provider, 'local', kind);
    assert.match(reply.providerNotice ?? '', notice, kind);
    assert.ok(!JSON.stringify(reply).includes('sk-ant-secret-token'), kind);
    assert.deepEqual(reply.observation, observation);
  }
  // 예상하지 못한 예외도 같은 방식으로 대체된다.
  const reply = await createLiveChat(bridge(makeFakeClaude({}).config), undefined, async () => {
    throw new Error('unexpected');
  })(request, snapshot, live());
  assert.equal(reply.provider, 'local');

  // 실제 실행 파일을 거친 로그인 실패
  const fake = makeFakeClaude({
    stdout: readFixture('claude-result-not-logged-in.json'),
    exitCode: 1,
  });
  const auth = await createLiveChat(bridge(fake.config))(request, snapshot, live());
  assert.equal(auth.provider, 'local');
  assert.match(auth.providerNotice ?? '', /인증에 실패/);
  assert.ok(!JSON.stringify(auth).includes('Please run /login'));
});

test('a cancelled client stops claude and is charged for the time it ran', async () => {
  const databasePath = tempDatabase();
  const usage = usageLog(databasePath);
  const fake = makeFakeClaude({ sleepMs: 20000 }, { timeoutMs: 30000 });
  const controller = new AbortController();
  const pending = createLiveChat(bridge(fake.config, { databasePath }))(
    request,
    snapshot,
    controller.signal,
  );
  await fake.waitForCall();
  controller.abort();
  const started = Date.now();
  await assert.rejects(pending, { name: 'AbortError' });
  // 끝까지 기다리지 않고 멈춘다 (동시 실행 자리를 바로 돌려준다).
  assert.ok(Date.now() - started < 10000);
  // 취소로 비용 기록을 피할 수 없다. 돈 시간만큼 메시지당 상한(0.5)을 나눠 센다.
  const spent = usage.spentLast24h();
  assert.ok(spent > 0 && spent < 0.5 * (10000 / 30000), String(spent));
});

test('cost is recorded in the shared usage log and the daily budget switches to the fallback', async () => {
  const databasePath = tempDatabase();
  const usage = usageLog(databasePath);
  const fake = makeFakeClaude({ stdout: answer('관측값을 확인했어요.') }, { dailyBudgetUsd: 1 });
  const chat = createLiveChat(bridge(fake.config, { databasePath }));

  const first = await chat(request, snapshot, live());
  assert.equal(first.provider, 'claude');
  assert.equal(usage.spentLast24h(), 0.000978);

  // 이미 한도를 넘겼다면 claude 를 부르지 않고 대체 설명을 준다.
  usage.record('claude', 2);
  const calls = fake.calls().length;
  const blocked = await chat(request, snapshot, live());
  assert.equal(blocked.provider, 'local');
  assert.match(blocked.providerNotice ?? '', /24시간 AI 사용 한도/);
  assert.deepEqual(blocked.observation, observation);
  assert.equal(fake.calls().length, calls);
});

test('a failed run counts its reported cost, and a timeout counts the per-message cap', async () => {
  const databasePath = tempDatabase();
  const usage = usageLog(databasePath);
  const limited = makeFakeClaude({
    stdout: readFixture('claude-result-max-budget.json'),
    exitCode: 1,
  });
  const reply = await createLiveChat(bridge(limited.config, { databasePath }))(
    request,
    snapshot,
    live(),
  );
  assert.equal(reply.provider, 'local');
  assert.match(reply.providerNotice ?? '', /요청 한도/);
  assert.equal(usage.spentLast24h(), 0.003812);

  const slow = makeFakeClaude({ sleepMs: 20000 }, { timeoutMs: 300 });
  const timedOut = await createLiveChat(bridge(slow.config, { databasePath }))(
    request,
    snapshot,
    live(),
  );
  assert.match(timedOut.providerNotice ?? '', /응답이 늦어/);
  assert.equal(usage.spentLast24h(), 0.003812 + 0.5);
});

test('an unreadable usage log blocks claude with a fallback instead of failing the chat', async () => {
  const databasePath = tempDatabase();
  const fake = makeFakeClaude({ stdout: answer('관측값을 확인했어요.') });
  const chat = createLiveChat(bridge(fake.config, { databasePath }));
  const other = new Database(databasePath);
  other.exec('DROP TABLE llm_usage');
  other.close();
  const reply = await chat(request, snapshot, live());
  assert.equal(reply.provider, 'local');
  assert.match(reply.providerNotice ?? '', /사용량을 확인하지 못해/);
  assert.equal(fake.calls().length, 0);
});

test('the usage log sums only the last 24 hours and ignores empty costs', () => {
  const databasePath = tempDatabase();
  const usage = usageLog(databasePath);
  usage.record('claude', 0);
  usage.record('claude', -1);
  usage.record('claude', 0.25);
  assert.equal(usage.spentLast24h(), 0.25);
  const other = new Database(databasePath);
  other
    .prepare('INSERT INTO llm_usage (at, provider, cost_usd) VALUES (?, ?, ?)')
    .run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), 'claude', 7);
  other.close();
  assert.equal(usage.spentLast24h(), 0.25);
  assert.equal(usageLog(databasePath), usage);
});

test('the OpenAI-compatible provider stays the default and never starts claude', async () => {
  const fake = makeFakeClaude({ stdout: answer('claude 가 불리면 안 된다') });
  let fetched = 0;
  const reply = await createLiveChat(
    bridge(fake.config, { llmProvider: 'openai', databasePath: tempDatabase() }),
    async () => {
      fetched++;
      return Response.json({
        choices: [{ message: { role: 'assistant', content: '관측값을 확인했어요.' } }],
      });
    },
  )(request, snapshot, live());
  assert.equal(fetched, 1);
  assert.equal(reply.provider, 'openai');
  assert.equal(fake.calls().length, 0);
});

test('the AI only gets the time left before the 45 s route deadline, then the local explanation', async () => {
  const fake = makeFakeClaude({ sleepMs: 20000 }, { timeoutMs: 30000 });
  const started = Date.now();
  // 관측·자외선에 시간을 다 쓰고 3.5초만 남은 상황
  const reply = await createLiveChat(bridge(fake.config))(
    request,
    snapshot,
    live(),
    Date.now() + 3500,
  );
  assert.equal(reply.provider, 'local');
  assert.match(reply.providerNotice ?? '', /응답이 늦어/);
  assert.ok(Date.now() - started < 8000);
});

test('the KMA fallback reason is told only when the server chose KMA because E-UM had nothing recent', () => {
  const kmaObservation = {
    ...observation,
    device: {
      ...observation.device,
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      provider: 'kma' as const,
    },
  };
  const chosen = { ...snapshot, selected: kmaObservation, devices: [kmaObservation.device] };
  assert.match(
    localExplanation(
      {
        ...chosen,
        warnings: [
          '덕장 1km 안 E-UM 관측기의 최근 값이 없어 기상청 구룡포 AWS(약 690m) 관측값을 대신 보여드려요.',
        ],
      },
      undefined,
    ),
    /E-UM 관측기의 최근 값이 없어 기상청 구룡포 AWS/,
  );
  const picked = localExplanation({ ...chosen, warnings: [] }, undefined);
  assert.match(picked, /^기상청 구룡포 AWS 관측값을 확인했어요/);
  assert.ok(!picked.includes('최근 값이 없어'));
});
