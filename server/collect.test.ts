import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { collectOnce, formatSummary, MISSING_DEVICE_ID } from './collect.ts';
import { BridgeError, createObservationService, type BridgeConfig } from './eum.ts';
import { createWorkspaceMiddleware, createWorkspaceService } from './workspace.ts';
import { runScript } from './test-helpers/run-script.ts';
import type { LiveObservation, LiveSnapshot } from '../src/lib/live.ts';
import {
  GUIDANCE_FACTS,
  getBatchReport,
  validateOperationsData,
  type OperationsData,
} from '../src/lib/operations.ts';
import type { OperationsEnvelope, Site, WorkspaceSession } from '../src/lib/workspace.ts';

const SITE = { name: '수집 덕장', address: '구룡포', latitude: 35.98, longitude: 129.55 };
const STARTED = '2026-10-04T08:00:00.000Z';
const at = (iso: string) => () => Date.parse(iso);

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'gwamegi-collect-test-'));
  const workspace = { databasePath: join(directory, 'haepung.db') };
  const middleware = createWorkspaceMiddleware(createWorkspaceService(workspace));
  const server = createServer((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    }),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const agent = () => {
    let cookie = '';
    const call = async <T>(path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      assert.equal(response.status, 200, `${method} ${path}`);
      return (await response.json()) as T;
    };
    return {
      call,
      signup: (name: string) =>
        call<WorkspaceSession>('/auth/signup', 'POST', {
          name,
          email: `${name.toLowerCase()}@example.test`,
          password: 'test-only-password-2026',
        }),
    };
  };
  return { workspace, agent };
}

/** 운영자·덕장·진행 중인 배치(와 연결된 안내)를 실제 API 로 만든다. */
async function siteWithBatch(f: Awaited<ReturnType<typeof fixture>>, withBatch = true) {
  const owner = f.agent();
  await owner.signup('Owner');
  const site = await owner.call<Site>('/sites', 'POST', SITE);
  const data: OperationsData = {
    batches: withBatch
      ? [
          {
            id: 'batch-1',
            name: '꽁치 1차',
            fish: '꽁치',
            quantity: 100,
            status: 'ongoing',
            startedAt: STARTED,
            note: '',
            observations: [],
            logs: [],
          },
        ]
      : [],
    guidance: withBatch
      ? [
          {
            id: 'guidance-1',
            batchId: 'batch-1',
            title: '널기',
            original: '간격을 두고 널어 주세요.',
            translated: 'Vui lòng treo cá.',
            language: 'vi',
            facts: { ...GUIDANCE_FACTS },
            approvedAt: STARTED,
            preparedAt: STARTED,
            channel: 'workspace',
            status: 'prepared',
            replies: [],
          },
        ]
      : [],
  };
  await owner.call<OperationsEnvelope>(`/sites/${site.id}/operations`, 'PUT', {
    data,
    revision: 0,
  });
  const operations = () => owner.call<OperationsEnvelope>(`/sites/${site.id}/operations`);
  return { owner, site, operations };
}

function reading(
  id: string,
  latitude: number,
  observedAt: string,
  ageMinutes: number,
  status: LiveObservation['status'] = 'current',
): LiveObservation {
  return {
    device: { id, name: `관측기 ${id}`, address: '구룡포', latitude, longitude: SITE.longitude },
    temperature: 4.2,
    humidity: 61,
    windSpeed: 3.1,
    observedAt,
    observedAtRaw: observedAt,
    ageMinutes,
    status,
    issues: status === 'stale' ? ['오래된 관측값이에요.'] : [],
  };
}

function snapshot(
  observations: LiveObservation[],
  status: LiveSnapshot['status'] = 'ok',
): LiveSnapshot {
  return {
    fetchedAt: '2026-10-04T09:00:00.000Z',
    source: '포항 E-UM · 대기환경 관측 API',
    sourceUrl: 'https://genix.pohang-eum.kr/dpg/atmosphere/devices/realtime',
    devices: observations.map((item) => item.device),
    observations,
    selected: observations[0] ?? null,
    warnings: [],
    status,
    llm: { configured: false, model: 'test' },
  };
}

/** 부를 때마다 정해 둔 응답을 주고 호출 횟수를 센다. */
function eum(next: () => LiveSnapshot) {
  const source = {
    calls: 0,
    snapshot: async () => {
      source.calls += 1;
      return next();
    },
  };
  return source;
}

test('a fresh observation within 1 km is recorded once per 30-minute slot and bumps the revision', async (t) => {
  const f = await fixture(t);
  const { owner, site, operations } = await siteWithBatch(f);
  // 근로자 질문이 있는 문서에서도 수집이 근로자 이력을 건드리지 않아야 한다.
  const { token } = await owner.call<{ token: string }>(`/sites/${site.id}/invitations`, 'POST', {
    language: 'vi',
  });
  const worker = f.agent();
  await worker.signup('Worker');
  await worker.call(`/invitations/${token}/accept`, 'POST', {});
  await worker.call(`/sites/${site.id}/guidance/guidance-1/replies`, 'POST', {
    kind: 'question',
    text: 'Khi nào thu cá?',
  });
  const before = await operations();

  const near = eum(() => snapshot([reading('7', 35.982, '2026-10-04T09:05:00.000Z', 5)]));
  const first = await collectOnce({
    workspace: f.workspace,
    observations: near,
    now: at('2026-10-04T09:10:00.000Z'),
  });
  assert.deepEqual(
    { ...first, at: undefined },
    {
      at: undefined,
      source: 'ok',
      sites: 1,
      batches: 1,
      recorded: 1,
      missing: 0,
      skipped: 0,
      failedSites: 0,
    },
  );
  assert.equal(near.calls, 1);
  const after = await operations();
  assert.equal(after.revision, before.revision + 1);
  assert.ok(validateOperationsData(after.data));
  const batch = after.data.batches[0];
  assert.equal(batch.observations.length, 1);
  assert.deepEqual(batch.observations[0], {
    at: '2026-10-04T09:10:00.000Z',
    observedAt: '2026-10-04T09:05:00.000Z',
    sourceDeviceId: '7',
    sourceDeviceName: '관측기 7',
    temperature: 4.2,
    humidity: 61,
    wind: 3.1,
    distanceM: 222,
    alert: false,
  });
  const log = batch.logs.at(-1)!;
  assert.equal(log.id, 'collect-2026-10-04T09:00:00.000Z');
  assert.equal(log.kind, 'observation');
  assert.match(log.title, /30분 자동 수집/);
  // 근로자 응답과 근로자 로그는 그대로다.
  assert.deepEqual(after.data.guidance, before.data.guidance);
  assert.deepEqual(
    batch.logs.filter((item) => item.kind === 'worker'),
    before.data.batches[0].logs.filter((item) => item.kind === 'worker'),
  );
  assert.equal(after.data.guidance[0].replies.length, 1);

  // 타이머가 같은 30분 구간에 다시 돌면 새 관측이 있어도 아무것도 더하지 않는다.
  const newer = eum(() => snapshot([reading('7', 35.982, '2026-10-04T09:18:00.000Z', 2)]));
  const second = await collectOnce({
    workspace: f.workspace,
    observations: newer,
    now: at('2026-10-04T09:20:00.000Z'),
  });
  assert.equal(second.recorded, 0);
  assert.equal(second.missing, 0);
  assert.equal(second.skipped, 1);
  const unchanged = await operations();
  assert.equal(unchanged.revision, after.revision);
  assert.deepEqual(unchanged.data, after.data);
  assert.equal(getBatchReport(unchanged.data.batches[0]).validSamples, 1);
  assert.match(formatSummary(first), /source=ok sites=1 batches=1 recorded=1 missing=0/);
});

test('without an ongoing batch the collector exits without calling E-UM', async (t) => {
  const f = await fixture(t);
  const { operations } = await siteWithBatch(f, false);
  const before = await operations();
  const source = eum(() => {
    throw new Error('E-UM must not be called');
  });
  const summary = await collectOnce({ workspace: f.workspace, observations: source });
  assert.equal(source.calls, 0);
  assert.equal(summary.source, 'skipped');
  assert.equal(summary.sites, 0);
  assert.equal(summary.batches, 0);
  assert.equal((await operations()).revision, before.revision);
});

test('stale, distant, failed or archived data become one missing sample per slot in the missing rate', async (t) => {
  const f = await fixture(t);
  const { operations } = await siteWithBatch(f);
  const run = (iso: string, next: () => LiveSnapshot) =>
    collectOnce({ workspace: f.workspace, observations: eum(next), now: at(iso) });

  await run('2026-10-04T09:10:00.000Z', () =>
    snapshot([reading('7', 35.982, '2026-10-04T09:05:00.000Z', 5)]),
  );
  const recorded = await operations();
  assert.equal(getBatchReport(recorded.data.batches[0]).validSamples, 1);

  // 1km 안 장비가 오래됨: 결측 하나
  const stale = await run('2026-10-04T09:40:00.000Z', () =>
    snapshot([reading('7', 35.982, '2026-10-04T09:00:00.000Z', 40, 'stale')]),
  );
  assert.equal(stale.missing, 1);
  const afterStale = await operations();
  assert.equal(afterStale.revision, recorded.revision + 1);
  let report = getBatchReport(afterStale.data.batches[0]);
  assert.equal(report.totalSamples, 2);
  assert.equal(report.validSamples, 1);
  assert.equal(report.missingRate, 50);
  const sample = afterStale.data.batches[0].observations[1];
  assert.equal(sample.sourceDeviceId, MISSING_DEVICE_ID);
  assert.deepEqual([sample.temperature, sample.humidity, sample.wind], [null, null, null]);
  assert.equal(sample.alert, false);
  assert.match(afterStale.data.batches[0].logs.at(-1)!.detail, /덕장 근처\(E-UM 1km, 기상청 5km\)/);

  // 같은 구간에 다시 돌아도 결측을 두 번 넣지 않는다.
  const again = await run('2026-10-04T09:50:00.000Z', () => {
    throw new BridgeError(502, 'EUM_UNAVAILABLE', '실패');
  });
  assert.deepEqual([again.missing, again.skipped], [0, 1]);
  assert.equal((await operations()).revision, afterStale.revision);

  // 1km 밖 장비뿐, E-UM 실패, 보관 자료: 구간마다 결측 하나씩
  const far = await run('2026-10-04T10:10:00.000Z', () =>
    snapshot([reading('9', 36.0, '2026-10-04T10:05:00.000Z', 5)]),
  );
  const failed = await run('2026-10-04T10:40:00.000Z', () => {
    throw new BridgeError(502, 'EUM_UNAVAILABLE', '실패');
  });
  const archived = await run('2026-10-04T11:10:00.000Z', () =>
    snapshot([reading('7', 35.982, '2026-08-06T02:59:00.000Z', 80000, 'stale')], 'archived'),
  );
  assert.deepEqual(
    [far, failed, archived].map((item) => [item.source, item.missing, item.recorded]),
    [
      ['ok', 1, 0],
      ['error', 1, 0],
      ['archived', 1, 0],
    ],
  );
  assert.equal(failed.sourceError, 'EUM_UNAVAILABLE');
  assert.match(formatSummary(failed), /source=error\(EUM_UNAVAILABLE\)/);

  const final = await operations();
  assert.equal(final.revision, afterStale.revision + 3);
  assert.ok(validateOperationsData(final.data));
  report = getBatchReport(final.data.batches[0]);
  assert.equal(report.totalSamples, 5);
  assert.equal(report.validSamples, 1);
  assert.equal(report.missingRate, 80);
  assert.equal(report.alertCount, 0);
  assert.deepEqual(
    final.data.batches[0].logs.map((log) => log.id),
    [
      'collect-2026-10-04T09:00:00.000Z',
      'collect-2026-10-04T09:30:00.000Z',
      'collect-2026-10-04T10:00:00.000Z',
      'collect-2026-10-04T10:30:00.000Z',
      'collect-2026-10-04T11:00:00.000Z',
    ],
  );
});

test('real E-UM rows go through the observation service once and KST rows are recorded', async (t) => {
  // E-UM 원문 형식: 시간대 없는 "YYYY-MM-DD HH:mm:ss" (KST). 실제 시계 기준 2분 전 관측.
  const kst = new Date(Date.now() - 2 * 60 * 1000 + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const config: BridgeConfig = {
    eumServiceKey: 'test-eum-secret',
    openaiApiKey: '',
    openaiModel: 'test',
    llmBaseUrl: 'https://api.openai.com/v1',
    timezoneOffset: '+09:00',
    staleAfterMinutes: 30,
    projectRoot: process.cwd(),
  };
  const run = async (logDateTime: string) => {
    const f = await fixture(t);
    const { operations } = await siteWithBatch(f);
    const paths: string[] = [];
    const service = createObservationService(config, async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      const data = url.pathname.endsWith('/realtime')
        ? [{ devId: 1, logDateTime, temp: 22.7, humi: 57, winsp: 0.95 }]
        : [
            {
              id: 1,
              nickname: '구룡포 관측기',
              address: '구룡포',
              latitude: 35.981,
              longitude: 129.55,
            },
          ];
      return Response.json({ id: '1', status: 'success', data });
    });
    const summary = await collectOnce({ workspace: f.workspace, observations: service });
    return { summary, paths, batch: (await operations()).data.batches[0] };
  };

  const local = await run(kst);
  assert.deepEqual(local.paths, ['/dpg/atmosphere/devices', '/dpg/atmosphere/devices/realtime']);
  // 원문 시각은 한국 시간으로 확인됐으므로(eum.ts 의 EUM_SOURCE_OFFSET) 그대로 기록된다.
  assert.deepEqual(
    [local.summary.source, local.summary.recorded, local.summary.missing],
    ['ok', 1, 0],
  );
  assert.equal(local.batch.observations[0].sourceDeviceId, '1');

  const zoned = await run(`${kst.replace(' ', 'T')}+09:00`);
  assert.deepEqual([zoned.summary.recorded, zoned.summary.missing], [1, 0]);
  assert.equal(zoned.batch.observations[0].sourceDeviceId, '1');
  assert.equal(zoned.batch.observations[0].distanceM, 111);
});

test('the collector command prints one line and does not call E-UM for an empty database', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gwamegi-collect-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await runScript(fileURLToPath(new URL('./collect.ts', import.meta.url)), [], {
    DATABASE_PATH: join(directory, 'haepung.db'),
    EUM_SERVICE_KEY: 'test-collect-secret',
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /^\[collect\] \S+ source=skipped sites=0 batches=0 recorded=0 missing=0 skipped=0 failed=0\n$/,
  );
  assert.ok(!(result.stdout + result.stderr).includes('test-collect-secret'));
});

test('when E-UM has no recent value near the site, the batch records the KMA AWS value', async (t) => {
  const config: BridgeConfig = {
    eumServiceKey: 'test-eum-secret',
    openaiApiKey: '',
    openaiModel: 'test',
    llmBaseUrl: 'https://api.openai.com/v1',
    timezoneOffset: '+09:00',
    staleAfterMinutes: 30,
    projectRoot: process.cwd(),
  };
  // E-UM 은 3시간 전 값만 준다 (오래된 관측).
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const awsAt = new Date(Date.now() - 60 * 1000).toISOString();
  const aws: LiveObservation = {
    device: {
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      address: '기상청 AWS 816',
      latitude: SITE.latitude + 0.002,
      longitude: SITE.longitude,
      provider: 'kma',
    },
    temperature: 13.5,
    humidity: 84.6,
    windSpeed: 2.2,
    observedAt: awsAt,
    observedAtRaw: '202610062215',
    ageMinutes: 1,
    status: 'current',
    issues: [],
  };
  const f = await fixture(t);
  const { operations } = await siteWithBatch(f);
  const service = createObservationService(
    config,
    async (input) => {
      const url = new URL(String(input));
      const data = url.pathname.endsWith('/realtime')
        ? [{ devId: 1, logDateTime: old, temp: 22.7, humi: 57, winsp: 0.95 }]
        : [
            {
              id: 1,
              nickname: '구룡포 관측기',
              address: '구룡포',
              latitude: SITE.latitude,
              longitude: SITE.longitude,
            },
          ];
      return Response.json({ id: '1', status: 'success', data });
    },
    { aws: async () => aws, weather: async () => null },
  );
  const summary = await collectOnce({ workspace: f.workspace, observations: service });
  assert.deepEqual([summary.recorded, summary.missing], [1, 0]);
  const recorded = (await operations()).data.batches[0].observations[0];
  assert.equal(recorded.sourceDeviceId, 'kma-aws-816');
  assert.equal(recorded.sourceDeviceName, '기상청 구룡포 AWS');
  assert.equal(recorded.temperature, 13.5);
});

test('when E-UM is down and only archived data exists, a current KMA AWS value near the site is still recorded', async (t) => {
  const config: BridgeConfig = {
    eumServiceKey: '',
    openaiApiKey: '',
    openaiModel: 'test',
    llmBaseUrl: 'https://api.openai.com/v1',
    timezoneOffset: '+09:00',
    staleAfterMinutes: 30,
    projectRoot: process.cwd(),
  };
  const aws: LiveObservation = {
    device: {
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      address: '기상청 AWS 816',
      latitude: SITE.latitude + 0.002,
      longitude: SITE.longitude,
      provider: 'kma',
    },
    temperature: 13.5,
    humidity: 84.6,
    windSpeed: 2.2,
    observedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    observedAtRaw: '202610062215',
    ageMinutes: 1,
    status: 'current',
    issues: [],
  };
  const f = await fixture(t);
  const { operations } = await siteWithBatch(f);
  // 키가 없어 E-UM 은 보관 자료(archived)만 준다.
  const service = createObservationService(
    config,
    async () => {
      throw new Error('E-UM 을 부르면 안 된다');
    },
    { aws: async () => aws, weather: async () => null },
  );
  const summary = await collectOnce({ workspace: f.workspace, observations: service });
  assert.equal(summary.source, 'archived');
  assert.deepEqual([summary.recorded, summary.missing], [1, 0]);
  assert.equal((await operations()).data.batches[0].observations[0].sourceDeviceId, 'kma-aws-816');
});

test('each automatic sample keeps the grade it got, and 부적합 raises one alert per hour', async (t) => {
  const config: BridgeConfig = {
    eumServiceKey: '',
    openaiApiKey: '',
    openaiModel: 'test',
    llmBaseUrl: 'https://api.openai.com/v1',
    timezoneOffset: '+09:00',
    staleAfterMinutes: 30,
    projectRoot: process.cwd(),
  };
  let humidity = 90;
  // 첫 실행은 구간 시작보다 30초 늦게 기록된다 (조회가 오래 걸린 경우)
  let clock = Date.parse('2026-10-06T13:00:30.000Z');
  const aws = (): LiveObservation => ({
    device: {
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      address: '기상청 AWS 816',
      latitude: SITE.latitude + 0.002,
      longitude: SITE.longitude,
      provider: 'kma',
    },
    temperature: 8,
    humidity,
    windSpeed: 3,
    observedAt: new Date(clock - 60 * 1000).toISOString(),
    observedAtRaw: '202610062159',
    ageMinutes: 1,
    status: 'current',
    issues: [],
  });
  const f = await fixture(t);
  const { operations } = await siteWithBatch(f);
  const service = createObservationService(
    config,
    async () => {
      throw new Error('E-UM 을 부르면 안 된다');
    },
    { aws: async () => aws(), weather: async () => null },
  );
  const run = async () =>
    collectOnce({
      workspace: f.workspace,
      observations: service,
      now: () => clock,
      // 기상청 실황: 비·눈 없음 (없으면 적합을 주지 않는다)
      weather: async () => ({
        precipitation: { type: '없음', rain1hMm: 0, observedAt: new Date(clock).toISOString() },
        rain: null,
        sun: null,
      }),
    });
  await run(); // 22:00:30 KST 부적합 → 경보
  clock = Date.parse('2026-10-06T13:30:10.000Z');
  await run(); // 22:30 부적합 → 1시간 안이라 경보 없음
  clock = Date.parse('2026-10-06T14:00:05.000Z');
  await run(); // 23:00:05 부적합 → 기록 시각으로는 59.6분이지만 구간으로 1시간이라 경보
  humidity = 50;
  clock = Date.parse('2026-10-06T14:30:00.000Z');
  await run(); // 23:30 적합
  const batch = (await operations()).data.batches[0];
  const alerts = batch.logs.filter((log) => log.kind === 'alert');
  assert.equal(alerts.length, 2);
  assert.match(alerts[0].title, /부적합 경보/);
  assert.deepEqual(
    batch.observations.map((item) => item.alert),
    [true, false, true, false],
  );
  const recorded = batch.logs.filter((log) => log.title.includes('30분 자동 수집으로'));
  assert.match(
    recorded[0].detail,
    /등급 부적합 · 습도가 매우 높아요\(90%\).* · 기준 2026-10-10 가설값/,
  );
  assert.match(recorded[3].detail, /등급 적합/);
  assert.match(recorded[0].detail, /실제 관측 10\.06 21:59 KST/);
});

test('with no E-UM in 1 km and no AWS in 5 km, the site grid nowcast is recorded once per hourly value', async (t) => {
  const config: BridgeConfig = {
    eumServiceKey: 'test-eum-secret',
    openaiApiKey: '',
    openaiModel: 'test',
    llmBaseUrl: 'https://api.openai.com/v1',
    timezoneOffset: '+09:00',
    staleAfterMinutes: 30,
    projectRoot: process.cwd(),
  };
  // E-UM 은 3시간 전 값만, 기상청 AWS 는 약 6.7km 밖이라 둘 다 못 쓴다.
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const aws: LiveObservation = {
    device: {
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      address: '기상청 AWS 816',
      latitude: SITE.latitude + 0.06,
      longitude: SITE.longitude,
      provider: 'kma',
    },
    temperature: 13.5,
    humidity: 84.6,
    windSpeed: 2.2,
    observedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    observedAtRaw: '202610062215',
    ageMinutes: 1,
    status: 'current',
    issues: [],
  };
  const grid: LiveObservation = {
    device: {
      id: 'kma-grid-105-94',
      name: '기상청 초단기실황 (격자 105,94)',
      address: '덕장이 속한 기상청 5km 격자 (105, 94) 중심',
      latitude: SITE.latitude + 0.01,
      longitude: SITE.longitude,
      provider: 'kma-grid',
    },
    temperature: 9.5,
    humidity: 55,
    windSpeed: 3.1,
    observedAt: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
    observedAtRaw: '202610100300',
    ageMinutes: 50,
    status: 'current',
    issues: [],
  };
  const f = await fixture(t);
  const { operations } = await siteWithBatch(f);
  const service = createObservationService(
    config,
    async (input) => {
      const url = new URL(String(input));
      const data = url.pathname.endsWith('/realtime')
        ? [{ devId: 1, logDateTime: old, temp: 22.7, humi: 57, winsp: 0.95 }]
        : [
            {
              id: 1,
              nickname: '구룡포 관측기',
              address: '구룡포',
              latitude: SITE.latitude,
              longitude: SITE.longitude,
            },
          ];
      return Response.json({ id: '1', status: 'success', data });
    },
    { aws: async () => aws, weather: async () => null },
  );
  const summary = await collectOnce({
    workspace: f.workspace,
    observations: service,
    grid: async () => grid,
  });
  assert.deepEqual([summary.recorded, summary.missing], [1, 0]);
  const recorded = (await operations()).data.batches[0].observations[0];
  assert.equal(recorded.sourceDeviceId, 'kma-grid-105-94');
  assert.equal(recorded.temperature, 9.5);
  assert.equal(recorded.distanceM, 1112);
  // 다음 30분 구간에도 같은 매시 값이면 다시 쌓지 않는다
  const next = await collectOnce({
    workspace: f.workspace,
    observations: service,
    grid: async () => grid,
    now: () => Date.now() + 30 * 60 * 1000,
  });
  assert.deepEqual([next.recorded, next.missing, next.skipped], [0, 0, 1]);
  assert.equal((await operations()).data.batches[0].observations.length, 1);
});
