import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import {
  createObservationService,
  normalizeDevice,
  normalizeObservation,
  selectObservation,
  type BridgeConfig,
} from './eum.ts';
import { createLiveChat, readChatRequest, readCompletionText } from './chat.ts';
import { createApiMiddleware, readBridgeConfig } from './vite-api.ts';
import { readLiveSnapshot } from '../src/lib/live.ts';

const config: BridgeConfig = {
  eumServiceKey: 'test-eum-secret',
  openaiApiKey: 'test-openai-secret',
  openaiModel: 'gpt-4.1-mini',
  llmBaseUrl: 'https://api.openai.com/v1',
  timezoneOffset: '+09:00',
  staleAfterMinutes: 30,
  projectRoot: process.cwd(),
};
const device = {
  id: '1',
  name: '실측 관측기',
  address: '구룡포',
  latitude: 35.98,
  longitude: 129.55,
};
const now = Date.parse('2026-10-03T12:00:00+09:00');
const signal = () => new AbortController().signal;

test('E-UM keys decode percent escapes once while preserving literal plus signs and other settings', () => {
  for (const [input, expected] of [
    ['  dummy+/key==  ', 'dummy+/key=='],
    ['  dummy%2B%2Fkey%3D%3D  ', 'dummy+/key=='],
    ['dummy+%2fkey%3d%3d', 'dummy+/key=='],
    ['dummy%252B%252F%253D', 'dummy%2B%2F%3D'],
    ['dummy%key+', 'dummy%key+'],
    ['dummy%2', 'dummy%2'],
    ['dummy%E0%A4', 'dummy%E0%A4'],
    ['  ', ''],
  ]) {
    const actual = readBridgeConfig(
      {
        EUM_SERVICE_KEY: input,
        OPENAI_API_KEY: '  sk-test%2B+%3D  ',
        OPENAI_MODEL: 'test-model',
        EUM_TIMEZONE_OFFSET: '+08:00',
        EUM_STALE_AFTER_MINUTES: '45',
      },
      '/test/project',
    );
    assert.deepEqual(actual, {
      eumServiceKey: expected,
      // 서버 설정 기본값: OpenAI 호환(팀원 로컬 그대로), 공유 DB·원격 출처·추가 키 없음
      llmProvider: 'openai',
      claude: {
        bin: 'claude',
        workdir: '/test/project/.local-data/agent-workdir',
        authMode: 'subscription',
        model: undefined,
        effort: undefined,
        maxBudgetUsd: 0.5,
        timeoutMs: 40000,
        maxConcurrency: 4,
        dailyBudgetUsd: 10,
      },
      databasePath: undefined,
      publicOrigins: [],
      cookieSecure: false,
      devBasicAuth: undefined,
      devOpen: false,
      kmaAuthKey: undefined,
      dataGoKrKey: undefined,
      openaiApiKey: 'sk-test%2B+%3D',
      openaiModel: 'test-model',
      llmBaseUrl: 'https://api.openai.com/v1',
      timezoneOffset: '+08:00',
      staleAfterMinutes: 45,
      projectRoot: '/test/project',
    });
  }
  assert.equal(readBridgeConfig({}, '/test/project').eumServiceKey, '');
});

test('raw and encoded E-UM keys reach each upstream route with one query encoding pass', async () => {
  for (const [input, expected, encoded] of [
    ['dummy+/key==', 'dummy+/key==', 'dummy%2B%2Fkey%3D%3D'],
    ['dummy%2B%2Fkey%3D%3D', 'dummy+/key==', 'dummy%2B%2Fkey%3D%3D'],
    ['dummy+%2Fkey%3D%3D', 'dummy+/key==', 'dummy%2B%2Fkey%3D%3D'],
    ['dummy%252B', 'dummy%2B', 'dummy%252B'],
    ['dummy%key+', 'dummy%key+', 'dummy%25key%2B'],
  ]) {
    const requests: URL[] = [];
    const service = createObservationService(
      readBridgeConfig({ EUM_SERVICE_KEY: input }, process.cwd()),
      async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        if (url.pathname.endsWith('/devices'))
          return Response.json({ status: 'success', data: [device] });
        if (url.pathname.endsWith('/devices/realtime')) return new Response('', { status: 503 });
        return Response.json({
          status: 'success',
          data: {
            devId: device.id,
            temp: 12,
            humi: 50,
            winsp: 1,
            logDateTime: '2026-10-03T02:59:00Z',
          },
        });
      },
    );
    const snapshot = await service.snapshot(signal());
    assert.equal(snapshot.status, 'ok');
    assert.equal(requests.length, 3);
    for (const url of requests) {
      assert.equal(url.searchParams.get('serviceKey'), expected);
      assert.equal(url.searchParams.getAll('serviceKey').length, 1);
      assert.equal(url.search.slice(1).split('&')[0], `serviceKey=${encoded}`);
    }
  }
});

test('upstream values preserve zeros, missing data, and flag unverified timezone assumptions', () => {
  assert.equal(
    normalizeDevice({ id: 1, latitude: '35.98', longitude: '129.55', nickname: '관측기' })
      ?.latitude,
    35.98,
  );
  assert.equal(normalizeDevice({ id: 1, latitude: false, longitude: 129 }), null);
  const current = normalizeObservation(
    device,
    { temp: 0, humi: '50', winsp: 0, logDateTime: '2026-10-03 11:59:00' },
    now,
    '+09:00',
    30,
  );
  assert.equal(current.temperature, 0);
  assert.equal(current.windSpeed, 0);
  assert.equal(current.ageMinutes, 1);
  assert.equal(current.status, 'current');
  // E-UM 원문은 한국 시간이라(호출 기록으로 확인) +09:00 으로 읽으면 확인 사항이 아니다.
  assert.equal(current.issues.length, 0);
  const otherOffset = normalizeObservation(
    device,
    { temp: 0, humi: '50', winsp: 0, logDateTime: '2026-10-03 02:59:00' },
    now,
    '+00:00',
    30,
  );
  assert.equal(otherOffset.ageMinutes, 1);
  assert.match(otherOffset.issues.join(' '), /시간대가 없어/);
  const utc = normalizeObservation(
    device,
    { temp: 10, humi: 50, winsp: 1, logDateTime: '2026-10-03T02:59:00Z' },
    now,
    '+09:00',
    30,
  );
  assert.equal(utc.ageMinutes, 1);
  assert.equal(utc.issues.length, 0);
  const invalid = normalizeObservation(
    device,
    { temp: null, humi: 101, winsp: -1, logDateTime: '' },
    now,
    '+09:00',
    30,
  );
  assert.deepEqual(
    [invalid.temperature, invalid.humidity, invalid.windSpeed, invalid.ageMinutes],
    [null, null, null, null],
  );
  assert.equal(invalid.status, 'invalid');
  const future = normalizeObservation(
    device,
    { temp: 10, humi: 50, winsp: 1, logDateTime: '2026-10-04 12:00:00' },
    now,
    '+09:00',
    30,
  );
  assert.equal(future.ageMinutes, null);
  assert.equal(future.status, 'invalid');
  assert.equal(selectObservation([future, current])?.observedAt, current.observedAt);
});

test('sensor-error bounds reject impossible values without changing valid measurements', () => {
  const row = { temp: 12.34, humi: 56.78, winsp: 1.234, logDateTime: '2026-10-03T02:59:00Z' };
  const read = (patch: Partial<typeof row>) =>
    normalizeObservation(device, { ...row, ...patch }, now, '+09:00', 30);
  for (const temp of [-80, 60]) {
    const result = read({ temp });
    assert.equal(result.temperature, temp, 'Temperature bounds must remain inclusive');
    assert.equal(result.status, 'current');
  }
  for (const temp of [-80.001, 60.001, 1e300, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = read({ temp });
    assert.equal(result.temperature, null);
    assert.equal(result.humidity, 56.78);
    assert.equal(
      result.windSpeed,
      1.234,
      'A bad temperature must not alter a valid wind measurement',
    );
    assert.equal(result.status, 'invalid');
    assert.match(result.issues.join(' '), /온도/);
  }
  for (const field of ['humi', 'winsp'] as const) {
    for (const boundary of [0, 100]) {
      const result = read({ [field]: boundary });
      assert.equal(field === 'humi' ? result.humidity : result.windSpeed, boundary);
      assert.equal(result.status, 'current');
    }
    for (const invalid of [-0.001, 100.001, Number.POSITIVE_INFINITY]) {
      const result = read({ [field]: invalid });
      assert.equal(field === 'humi' ? result.humidity : result.windSpeed, null);
      assert.equal(
        result.temperature,
        12.34,
        'Invalid ancillary values must not replace valid temperature evidence',
      );
      assert.equal(result.observedAt, '2026-10-03T02:59:00.000Z');
      assert.equal(result.status, 'invalid');
    }
  }
  const numericStrings = normalizeObservation(
    device,
    { temp: '-80', humi: '100', winsp: '100', logDateTime: row.logDateTime },
    now,
    '+09:00',
    30,
  );
  assert.deepEqual(
    [numericStrings.temperature, numericStrings.humidity, numericStrings.windSpeed],
    [-80, 100, 100],
  );
});

test('observation timestamps reject impossible calendar dates instead of rolling forward', () => {
  const row = { temp: 12.34, humi: 56.78, winsp: 1.234 };
  for (const raw of [
    '2026-02-31T11:59:00+09:00',
    '2026-02-31 11:59:00',
    '2025-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-00-10T00:00:00Z',
    '2026-13-10T00:00:00Z',
    '2026-01-00T00:00:00Z',
    '2026-10-03T24:00:00Z',
    '2026-10-03T02:60:00Z',
    '2026-10-03T02:59:60Z',
  ]) {
    const result = normalizeObservation(device, { ...row, logDateTime: raw }, now, '+09:00', 30);
    assert.equal(result.observedAt, null, raw);
    assert.equal(result.ageMinutes, null, raw);
    assert.equal(
      result.observedAtRaw,
      raw,
      'Rejected timestamps must remain available as source evidence',
    );
    assert.equal(result.status, 'invalid');
    assert.equal(
      result.temperature,
      12.34,
      'Calendar errors must not fabricate or erase otherwise valid measurements',
    );
    assert.match(result.issues.join(' '), /유효한 수집 시각/);
  }
  for (const [raw, expected] of [
    ['2024-02-29T12:00:00+09:00', '2024-02-29T03:00:00.000Z'],
    ['2000-02-29T00:00:00Z', '2000-02-29T00:00:00.000Z'],
    ['2026-02-28T00:00:00Z', '2026-02-28T00:00:00.000Z'],
    ['2026-04-30T23:59:59.123Z', '2026-04-30T23:59:59.123Z'],
  ]) {
    const result = normalizeObservation(device, { ...row, logDateTime: raw }, now, '+09:00', 30);
    assert.equal(result.observedAt, expected);
    assert.equal(result.status, 'stale');
  }
});

test('E-UM authentication failures expose only real archived measurements with an explicit archived source', async () => {
  let count = 0;
  const service = createObservationService(config, async () => {
    count += 1;
    return new Response('secret raw upstream error test-eum-secret', { status: 401 });
  });
  const snapshot = await service.snapshot(signal());
  assert.equal(snapshot.status, 'archived');
  assert.equal(snapshot.source, 'E-UM 보관된 실측');
  assert.equal(snapshot.archiveSourceDate, '2026-08-06');
  assert.equal(snapshot.devices.length, 24);
  assert.equal(snapshot.observations.length, 24);
  const preciseArchive = snapshot.observations.find((item) => item.device.id === '16');
  assert.deepEqual(
    [preciseArchive?.temperature, preciseArchive?.humidity, preciseArchive?.windSpeed],
    [30.6, 70.7, 0.948],
    'Archived source precision must stay unchanged',
  );
  const zeroArchive = snapshot.observations.find((item) => item.device.id === '7');
  assert.deepEqual(
    [zeroArchive?.temperature, zeroArchive?.humidity, zeroArchive?.windSpeed],
    [0, 0, 0],
    'Real archived zero readings must remain zero even with a missing timestamp',
  );
  assert.equal(zeroArchive?.status, 'invalid');
  assert.ok(snapshot.observations.every((item) => item.status !== 'current'));
  assert.match(snapshot.warnings.join(' '), /HTTP 401/);
  assert.ok(!JSON.stringify(snapshot).includes('test-eum-secret'));
  assert.ok(!JSON.stringify(snapshot).includes('params'));
  assert.equal(readLiveSnapshot(snapshot).status, 'archived');
  const countBeforeCachedRead = count;
  await service.snapshot(signal());
  assert.equal(count, countBeforeCachedRead, 'Actual or archived source should be cached briefly');
});

test('a denied device list can use archived metadata while measurements remain exclusively live', async () => {
  const observedAt = new Date(Date.now() - 60000).toISOString();
  const routes: string[] = [];
  const service = createObservationService(config, async (input) => {
    const url = new URL(String(input));
    routes.push(url.pathname);
    if (url.pathname.endsWith('/devices'))
      return Response.json({ code: '40104', message: 'API permission denied' }, { status: 401 });
    if (url.pathname.endsWith('/devices/realtime'))
      return Response.json({
        status: 'success',
        data: [
          { devId: 1, temp: 12.345, humi: 56.78, winsp: 1.234, logDateTime: observedAt },
          { devId: 16, temp: 0, humi: 0, winsp: 0, logDateTime: observedAt },
        ],
      });
    return new Response('', { status: 401 });
  });
  const snapshot = await service.snapshot(signal(), '1');
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.source, '포항 E-UM · 대기환경 관측 API');
  assert.equal(snapshot.archiveSourceDate, undefined);
  assert.equal(snapshot.devices.length, 24);
  assert.equal(snapshot.selected?.status, 'current');
  assert.deepEqual(
    [
      snapshot.selected?.temperature,
      snapshot.selected?.humidity,
      snapshot.selected?.windSpeed,
      snapshot.selected?.observedAt,
    ],
    [12.345, 56.78, 1.234, observedAt],
  );
  const zeroLive = snapshot.observations.find((item) => item.device.id === '16');
  assert.deepEqual([zeroLive?.temperature, zeroLive?.humidity, zeroLive?.windSpeed], [0, 0, 0]);
  assert.ok(
    snapshot.observations
      .filter((item) => !['1', '16'].includes(item.device.id))
      .every(
        (item) => item.temperature === null && item.humidity === null && item.windSpeed === null,
      ),
    'Archived metadata must never fill gaps with archived measurements',
  );
  assert.match(snapshot.warnings.join(' '), /보관된 실제 관측소 정보/);
  assert.match(snapshot.warnings.join(' '), /관측값은 실시간 API/);
  assert.ok(routes.includes('/dpg/atmosphere/devices/realtime'));
});

test('a failed bulk request uses per-device E-UM requests without creating metrics', async () => {
  const routes: string[] = [];
  const service = createObservationService(config, async (input) => {
    const url = new URL(String(input));
    routes.push(url.pathname);
    if (url.pathname.endsWith('/devices'))
      return Response.json({
        status: 'success',
        data: [{ id: 1, latitude: 35.98, longitude: 129.55, nickname: '실측 관측기' }],
      });
    if (url.pathname.endsWith('/devices/realtime')) return new Response('', { status: 503 });
    assert.equal(url.searchParams.get('id'), '1');
    return Response.json({
      status: 'success',
      data: { devId: 1, temp: 12.34, humi: 56.78, winsp: 1.23, logDateTime: '2026-08-06 03:00:31' },
    });
  });
  const snapshot = await service.snapshot(signal());
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.selected?.temperature, 12.34);
  assert.equal(snapshot.selected?.observedAtRaw, '2026-08-06 03:00:31');
  assert.equal(routes.length, 3);
  assert.match(snapshot.warnings.join(' '), /관측기별 API/);
});

test('Responses output is read across messages and model failures keep immutable observation evidence', async () => {
  const snapshot = await createObservationService(
    config,
    async () => new Response('', { status: 401 }),
  ).snapshot(signal());
  const request = readChatRequest({
    message: '다 널었어요',
    siteId: 'local-site',
    history: [],
    deviceId: '1',
    scenario: 'normal',
  });
  let input = '';
  const live = createLiveChat(config, async (_url, init) => {
    input = String(init?.body);
    return Response.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '보관된 과거 실측 자료이며 현재 날씨가 아니에요.',
          },
        },
      ],
    });
  });
  const reply = await live(request, snapshot, signal());
  assert.equal(reply.provider, 'openai');
  assert.equal(reply.action, 'start-batch');
  assert.equal(reply.assessment, undefined);
  assert.deepEqual(reply.observation, snapshot.selected);
  assert.ok(input.includes('OBSERVATION_CONTEXT'));
  assert.ok(!input.includes(config.eumServiceKey) && !input.includes(config.openaiApiKey));
  const failure = await createLiveChat(
    config,
    async () => new Response('secret raw test-openai-secret', { status: 401 }),
  )(request, snapshot, signal());
  assert.equal(failure.provider, 'local');
  assert.match(failure.providerNotice ?? '', /인증에 실패/);
  assert.ok(!JSON.stringify(failure).includes('test-openai-secret'));
  assert.match(failure.content, /현재 날씨가 아니에요/);
  assert.throws(() => readCompletionText({ status: 'incomplete' }));
});

test('cancelled clients do not receive an archive or local explanation instead of cancellation', async () => {
  const controller = new AbortController();
  const waiting: typeof fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
  const pending = createObservationService(config, waiting).snapshot(controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('localhost middleware rejects foreign origins, malformed JSON, and oversized bodies', async () => {
  const middleware = createApiMiddleware(config);
  const server = createServer((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/api/health`);
    const payload = await health.json();
    assert.equal(payload.llm.model, 'gpt-4.1-mini');
    assert.equal(payload.eum.configured, true);
    assert.ok(!JSON.stringify(payload).includes('secret'));
    const denied = await fetch(`${base}/api/health`, {
      headers: { Origin: 'https://foreign.example' },
    });
    assert.equal(denied.status, 403);
    const invalid = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(invalid.status, 400);
    const oversized = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'x'.repeat(40000) }),
    });
    assert.equal(oversized.status, 413);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('public settings expose defaults without accepting an invalid timezone or freshness interval', () => {
  const defaults = readBridgeConfig(
    { EUM_TIMEZONE_OFFSET: 'invalid', EUM_STALE_AFTER_MINUTES: '-1' },
    process.cwd(),
  );
  assert.equal(defaults.timezoneOffset, '+09:00');
  assert.equal(defaults.staleAfterMinutes, 30);
  assert.equal(defaults.openaiModel, 'gpt-4.1-mini');
});
