import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createLiveChat } from './chat.ts';
import { contextOf, toolAsk } from './test-helpers/tool-ask.ts';
import type { BridgeConfig } from './eum.ts';
import { createUvIndexSource, readUvIndex, uvStage, type UvReading } from './sources/eum-uv.ts';
import type { LiveSnapshot } from '../src/lib/live.ts';

const FETCHED_AT = '2026-08-06T03:00:00.000Z';

test('the recorded INT_S06_005 response parses into a dated UV reading with the KMA stage', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../research/api-tests/raw/INT_S06_005.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(readUvIndex(raw.response, '+09:00', FETCHED_AT), {
    uvIndex: 5.2,
    // 원문 "2026-08-06 11:59:05" 에는 시간대가 없어 +09:00 으로 읽는다.
    observedAt: '2026-08-06T02:59:05.000Z',
    stage: '보통',
    fetchedAt: FETCHED_AT,
  });
  const data = (overrides: Record<string, unknown>) => ({
    status: 'success',
    data: { dateTime: '2026-08-06 11:59:05', uvIndex: 5.2, ...overrides },
  });
  assert.equal(readUvIndex(data({ uvIndex: '7.4' }), '+09:00', FETCHED_AT)?.stage, '높음');
  for (const payload of [
    { status: 'fail', data: { dateTime: '2026-08-06 11:59:05', uvIndex: 5 } },
    data({ uvIndex: 8.68e31 }),
    data({ uvIndex: -1 }),
    data({ uvIndex: null }),
    data({ uvIndex: '' }),
    data({ dateTime: undefined }),
    data({ dateTime: '2026-02-30 10:00:00' }),
    data({ dateTime: '2026-08-06 25:00:00' }),
    // 조회 시각보다 미래
    data({ dateTime: '2026-08-06 13:00:00' }),
    // 조회 시각보다 1시간 넘게 지난 값 (멈춘 센서)
    data({ dateTime: '2026-08-06 10:59:59' }),
    data({ dateTime: '2026-08-04 11:59:05' }),
    { status: 'success', data: [] },
    null,
  ])
    assert.equal(readUvIndex(payload, '+09:00', FETCHED_AT), null, JSON.stringify(payload));
});

test('UV stages follow the KMA scale with rounded decimal readings', () => {
  for (const [value, stage] of [
    [0, '낮음'],
    [2, '낮음'],
    [2.4, '낮음'],
    [2.5, '보통'],
    [3, '보통'],
    [5, '보통'],
    [5.49, '보통'],
    [6, '높음'],
    [7, '높음'],
    [7.5, '매우높음'],
    [8, '매우높음'],
    [10, '매우높음'],
    [10.5, '위험'],
    [11, '위험'],
    [15, '위험'],
  ] as const)
    assert.equal(uvStage(value), stage, String(value));
});

test('the UV source encodes the key once, caches for 10 minutes and returns null on failure', async () => {
  let clock = Date.parse(FETCHED_AT);
  const urls: string[] = [];
  let signal: AbortSignal | null | undefined;
  let reply: () => Response = () =>
    Response.json({
      id: '1',
      status: 'success',
      data: { dateTime: '2026-08-06 11:59:05', uvIndex: 5.2 },
    });
  const fetcher: typeof fetch = async (input, init) => {
    urls.push(String(input));
    signal = init?.signal;
    return reply();
  };
  const source = createUvIndexSource(
    { eumServiceKey: 'a+b/c==', timezoneOffset: '+09:00' },
    fetcher,
    () => clock,
  );
  const [first, concurrent] = await Promise.all([source(), source()]);
  assert.equal(first?.uvIndex, 5.2);
  assert.equal(concurrent, first);
  assert.equal(urls.length, 1);
  assert.equal(
    urls[0],
    'https://genix.pohang-eum.kr/dpg/sensor/latest/uvIndex?serviceKey=a%2Bb%2Fc%3D%3D',
  );
  assert.ok(signal instanceof AbortSignal);
  clock += 9 * 60 * 1000;
  await source();
  assert.equal(urls.length, 1);
  clock += 2 * 60 * 1000;
  reply = () => new Response('raw failure a+b/c==', { status: 500 });
  assert.equal(await source(), null);
  assert.equal(urls.length, 2);
  reply = () => {
    throw new TypeError(`fetch failed ${urls[0]}`);
  };
  clock += 61 * 1000;
  assert.equal(await source(), null);
  assert.equal(urls.length, 3);

  let called = false;
  const keyless = createUvIndexSource({ eumServiceKey: '', timezoneOffset: '+09:00' }, async () => {
    called = true;
    return Response.json({});
  });
  assert.equal(await keyless(), null);
  assert.equal(called, false);
});

const snapshot: LiveSnapshot = {
  fetchedAt: '2026-10-04T00:05:00Z',
  source: 'E-UM 실시간 관측',
  sourceUrl: 'https://pohang-eum.kr',
  devices: [],
  observations: [],
  selected: null,
  warnings: [],
  status: 'ok',
  llm: { configured: true, model: 'test' },
};
const config: BridgeConfig = {
  eumServiceKey: 'test-eum-secret',
  openaiApiKey: 'test-openai-secret',
  openaiModel: 'test-model',
  llmBaseUrl: 'https://api.openai.com/v1',
  timezoneOffset: '+09:00',
  staleAfterMinutes: 30,
  projectRoot: process.cwd(),
};
const request = { message: '오늘 작업할 때 주의할 점은?', siteId: 'site-1', history: [] };
const context = (system: string) => contextOf(system).current as Record<string, unknown>;

async function openaiSystem(uvIndex?: () => Promise<UvReading | null>): Promise<string> {
  let system = '';
  const fetcher: typeof fetch = async (_input, init) => {
    system = JSON.parse(String(init?.body)).messages[0].content;
    return Response.json({ choices: [{ message: { role: 'assistant', content: '확인했어요.' } }] });
  };
  const reply = await createLiveChat(
    config,
    fetcher,
    undefined,
    uvIndex,
  )(request, snapshot, new AbortController().signal);
  assert.equal(reply.provider, 'openai');
  return system;
}

test('the current-conditions grounding carries the UV reading, or null when it is unavailable', async () => {
  const reading: UvReading = {
    uvIndex: 7.4,
    observedAt: '2026-10-04T02:59:05.000Z',
    stage: '높음',
    fetchedAt: '2026-10-04T03:00:00.000Z',
  };
  const withUv = await openaiSystem(async () => reading);
  // 시각은 한국 시간 문자열로 바꿔 넘긴다 (02:59 UTC = 11:59 KST).
  assert.deepEqual(context(withUv).uv, {
    uvIndex: 7.4,
    stage: '높음',
    observedAt: '10.04 11:59 KST',
  });
  assert.match(withUv, /uv 는 근로자의 햇빛 노출 조언에만/);

  // 실제 E-UM 조회가 실패하는 소스
  const failing = createUvIndexSource(config, async () => new Response('', { status: 502 }));
  assert.equal(context(await openaiSystem(failing)).uv, null);
  assert.equal(context(await openaiSystem()).uv, null);
  assert.equal(
    context(
      await openaiSystem(async () => {
        throw new Error('unexpected');
      }),
    ).uv,
    null,
  );

  // claude 경로는 현재 관측 도구를 부를 때 같은 값을 받는다.
  const seen: Parameters<typeof toolAsk>[2] = {};
  const reply = await createLiveChat(
    {
      ...config,
      llmProvider: 'claude',
      claude: {
        bin: 'claude',
        workdir: process.cwd(),
        authMode: 'subscription',
        maxBudgetUsd: 0.5,
        dailyBudgetUsd: 10,
        timeoutMs: 1000,
        maxConcurrency: 1,
      },
    },
    undefined,
    toolAsk([['get_current_conditions']], '확인했어요.', seen),
    async () => reading,
  )(request, snapshot, new AbortController().signal);
  assert.equal(reply.provider, 'claude');
  assert.deepEqual((seen.results![0].result as Record<string, unknown>).uv, context(withUv).uv);
  assert.ok(!seen.system!.includes(config.eumServiceKey));
});
