import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readLiveSnapshot } from '../src/lib/live.ts';
import { distanceMeters } from '../src/lib/geo.ts';
import {
  AWS_816,
  createKmaSource,
  fromKmaGrid,
  gridObservation,
  readAwsMinute,
  readNowcast,
  readNowcastGrid,
  readRiseSet,
  toKmaGrid,
} from './sources/kma.ts';

const raw = (name: string) =>
  readFileSync(new URL(`../research/api-tests/raw/${name}`, import.meta.url), 'utf8');
// 원본 매분자료의 관측 시각: 2026-10-06 22:03 KST
const OBSERVED = Date.parse('2026-10-06T13:03:00Z');

test('grid conversion matches the KMA grid for Seoul and Guryongpo points', () => {
  // 서울시청은 기상청 공식 격자 60,127. 예시 덕장은 105,94, 팀원이 쓴 106,94 는 조금 동쪽이다.
  assert.deepEqual(toKmaGrid(35.9812, 129.5402), { nx: 105, ny: 94 });
  assert.deepEqual(toKmaGrid(35.99, 129.555), { nx: 106, ny: 94 });
  assert.deepEqual(toKmaGrid(37.5665, 126.978), { nx: 60, ny: 127 });
});

test('the real AWS 816 minute sample becomes a current observation with rain totals', () => {
  const read = readAwsMinute(raw('kma-aws816-minute.txt'), OBSERVED + 2 * 60_000, 30);
  assert.ok(read);
  assert.deepEqual(read.observation, {
    device: { ...AWS_816 },
    temperature: 13.5,
    humidity: 85.5,
    windSpeed: 2.4,
    observedAt: '2026-10-06T13:03:00.000Z',
    observedAtRaw: '202610062203',
    ageMinutes: 2,
    status: 'current',
    issues: [],
  });
  assert.deepEqual(read.rain, {
    last60mMm: 0,
    todayMm: 0,
    observedAt: '2026-10-06T13:03:00.000Z',
  });
  // 오래되면 stale, 필수값이 -50 이하(관측 없음)면 invalid
  assert.equal(
    readAwsMinute(raw('kma-aws816-minute.txt'), OBSERVED + 40 * 60_000, 30)?.observation.status,
    'stale',
  );
  const missing = raw('kma-aws816-minute.txt').replace(' 13.5 ', ' -99.9 ');
  const broken = readAwsMinute(missing, OBSERVED, 30)!.observation;
  assert.equal(broken.status, 'invalid');
  assert.equal(broken.temperature, null);
  assert.equal(readAwsMinute('#START7777\n#7777END\n', OBSERVED, 30), null);
});

test('the real nowcast and sunrise samples are read', () => {
  assert.deepEqual(readNowcast(JSON.parse(raw('kma-ultra-srt-ncst.json'))), {
    type: '없음',
    rain1hMm: 0,
    observedAt: '2026-10-06T12:00:00.000Z',
  });
  assert.equal(readNowcast({ response: { body: {} } }), null);
  assert.deepEqual(readRiseSet(raw('datagokr-risesetinfo.xml')), {
    date: '2026-10-06',
    sunrise: '06:21',
    sunset: '17:59',
  });
  assert.equal(
    readRiseSet('<response><header><resultCode>99</resultCode></header></response>'),
    null,
  );
});

test('the source caches, never leaks keys, and survives upstream failures', async () => {
  assert.equal(createKmaSource({ staleAfterMinutes: 30 }), null);
  const urls: URL[] = [];
  let fail = false;
  const source = createKmaSource(
    { kmaAuthKey: 'kma-secret', dataGoKrKey: 'a%2Bb%3D%3D', staleAfterMinutes: 30 },
    async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (fail) throw new TypeError(`fetch failed ${url}`);
      if (url.pathname.endsWith('nph-aws2_min')) return new Response(raw('kma-aws816-minute.txt'));
      if (url.pathname.endsWith('getUltraSrtNcst'))
        return new Response(raw('kma-ultra-srt-ncst.json'));
      if (url.pathname.endsWith('getUltraSrtFcst'))
        return new Response(raw('kma-ultra-srt-fcst.json'));
      return new Response(raw('datagokr-risesetinfo.xml'));
    },
    () => OBSERVED + 2 * 60_000,
  )!;
  const [first, second] = await Promise.all([source.aws(), source.aws()]);
  assert.equal(first?.temperature, 13.5);
  assert.equal(second, first);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get('stn'), '816');
  assert.equal(urls[0].searchParams.get('authKey'), 'kma-secret');
  const weather = await source.weather({ latitude: 35.9812, longitude: 129.5402 });
  assert.deepEqual(weather?.precipitation?.type, '없음');
  assert.deepEqual(weather?.sun, { date: '2026-10-06', sunrise: '06:21', sunset: '17:59' });
  assert.equal(weather?.rain?.todayMm, 0);
  // 초단기예보: 22:05 KST 에 21:30 발표분을 묻고, 22시부터 6시간을 쓴다 (00시 빗방울)
  const fcst = urls.find((url) => url.pathname.endsWith('getUltraSrtFcst'))!;
  assert.equal(fcst.searchParams.get('base_time'), '2130');
  assert.equal(weather?.forecast?.hours.length, 6);
  assert.equal(weather?.forecast?.hours[0].at, '2026-10-06T13:00:00.000Z');
  assert.deepEqual(
    {
      precipitation: weather?.forecast?.hours[2].precipitation,
      rain: weather?.forecast?.hours[2].rain,
    },
    { precipitation: '빗방울', rain: '1mm 미만' },
  );
  const nowcast = urls.find((url) => url.pathname.endsWith('getUltraSrtNcst'))!;
  assert.equal(nowcast.searchParams.get('nx'), '105');
  assert.equal(nowcast.searchParams.get('base_time'), '2100');
  // 공공데이터포털 Encoding 키는 한 번만 인코딩되어 나간다
  const sun = urls.find((url) => url.pathname.endsWith('getLCRiseSetInfo'))!;
  assert.match(sun.search, /serviceKey=a%2Bb%3D%3D(&|$)/);
  // 실패하면 던지지 않고 null 이며, 화면 검증을 통과하는 형태로만 붙는다
  fail = true;
  const fresh = createKmaSource({ kmaAuthKey: 'kma-secret', staleAfterMinutes: 30 }, async () => {
    throw new TypeError('fetch failed https://apihub.kma.go.kr/?authKey=kma-secret');
  })!;
  assert.equal(await fresh.aws(), null);
  assert.equal(await fresh.weather({ latitude: 35.98, longitude: 129.54 }), null);
  const kept = readLiveSnapshot({
    fetchedAt: '2026-10-06T13:05:00Z',
    source: '테스트',
    sourceUrl: 'https://pohang-eum.kr',
    devices: [first!.device],
    observations: [first],
    selected: first,
    warnings: [],
    status: 'ok',
    llm: { configured: false, model: 'test' },
    weather,
  });
  assert.deepEqual(kept.weather, weather);
  assert.equal(kept.selected?.device.provider, 'kma');
});

test('a stalled call is retried once, an HTTP refusal is not, and callers wait at most a cap', async () => {
  let calls = 0;
  const flaky = createKmaSource(
    { kmaAuthKey: 'kma-secret', staleAfterMinutes: 30 },
    async () => {
      calls++;
      if (calls === 1)
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return new Response(raw('kma-aws816-minute.txt'));
    },
    () => OBSERVED + 2 * 60_000,
  )!;
  assert.equal((await flaky.aws())?.temperature, 13.5);
  assert.equal(calls, 2);

  let refused = 0;
  const denied = createKmaSource({ kmaAuthKey: 'kma-secret', staleAfterMinutes: 30 }, async () => {
    refused++;
    return new Response(raw('kma-wrn-now-403.json'), { status: 403 });
  })!;
  assert.equal(await denied.aws(), null);
  assert.equal(refused, 1);

  const { within } = await import('./sources/kma.ts');
  const never = new Promise<number | null>(() => undefined);
  const started = Date.now();
  assert.equal(await within(never, 50), null);
  assert.ok(Date.now() - started < 1000);
  assert.equal(await within(Promise.resolve(7), 50), 7);
  assert.equal(await within(Promise.reject(new Error('x')), 50), null);
});

test('the last row with values is used, impossible dates are rejected, and a selected AWS id survives a KMA outage', async () => {
  const header = '#START7777\n';
  const row = (stamp: string, ta: string, hm: string) =>
    `${stamp}   816  311.0    2.0  333.0    2.9  312.8    2.4   ${ta}  -99.9    0.0    0.0    0.0    0.0   ${hm} 1011.2 1016.3   10.9\n`;
  const body =
    header +
    row('202610062202', '13.4', '85.1') +
    row('202610062203', '-99.9', '-99.9') +
    '#7777END\n';
  const read = readAwsMinute(body, OBSERVED, 30)!.observation;
  assert.equal(read.observedAtRaw, '202610062202');
  assert.equal(read.temperature, 13.4);
  const impossible = readAwsMinute(
    header + row('202602301200', '13.4', '85.1'),
    OBSERVED,
    30,
  )!.observation;
  assert.equal(impossible.status, 'invalid');
  assert.equal(impossible.observedAt, null);
  assert.ok(impossible.issues.some((issue) => issue.includes('시각을 확인할 수 없어요')));
  const stale = readAwsMinute(
    raw('kma-aws816-minute.txt'),
    OBSERVED + 40 * 60_000,
    30,
  )!.observation;
  assert.ok(stale.issues.some((issue) => issue.includes('40분 전')));

  // 화면이 기상청 AWS 를 고른 채 물었는데 이번에 기상청을 못 받았으면 오류 대신 기본 선택
  const { createObservationService } = await import('./eum.ts');
  const service = createObservationService(
    {
      eumServiceKey: 'test-eum-secret',
      openaiApiKey: '',
      openaiModel: 'test',
      llmBaseUrl: 'https://api.openai.com/v1',
      timezoneOffset: '+09:00',
      staleAfterMinutes: 30,
      projectRoot: process.cwd(),
    },
    async (input) => {
      const url = new URL(String(input));
      const data = url.pathname.endsWith('/realtime')
        ? [{ devId: 1, logDateTime: '2026-10-06 22:00:00', temp: 13, humi: 80, winsp: 1 }]
        : [
            {
              id: 1,
              nickname: '구룡포 관측기',
              address: '구룡포',
              latitude: 35.98,
              longitude: 129.54,
            },
          ];
      return Response.json({ id: '1', status: 'success', data });
    },
    { aws: async () => null, weather: async () => null },
  );
  const result = await service.snapshot(new AbortController().signal, 'kma-aws-816');
  assert.equal(result.selected?.device.id, '1');
});

test('the grid centre converts back to the same grid and lies within a few km of the site', () => {
  for (const [latitude, longitude] of [
    [35.9812, 129.5402],
    [35.9035, 129.5145],
    [37.5665, 126.978],
  ]) {
    const { nx, ny } = toKmaGrid(latitude, longitude);
    const centre = fromKmaGrid(nx, ny);
    assert.deepEqual(toKmaGrid(centre.latitude, centre.longitude), { nx, ny });
    // 5km 격자라 격자 안의 어느 점도 중심에서 대각선 반(약 3.6km)보다 가깝다
    assert.ok(distanceMeters({ latitude, longitude }, centre) < 3600);
  }
});

test('the real nowcast gives the grid temperature, humidity and wind; a missing value stays null', () => {
  // 2026-10-10 12:00 KST 발표, 예시 덕장 격자 105,94 (research/api-tests/2026-10-10-kma-grid-nowcast.md)
  const today = JSON.parse(raw('kma-ultra-srt-ncst-2026-10-10.json'));
  const reading = readNowcastGrid(today);
  assert.deepEqual(reading, {
    nx: 105,
    ny: 94,
    temperature: 24.3,
    humidity: 68,
    windSpeed: 3,
    observedAt: '2026-10-10T03:00:00.000Z',
    observedAtRaw: '202610101200',
  });
  // 2026-10-06 기록도 같은 모양이다
  assert.deepEqual(
    (({ temperature, humidity, windSpeed }) => ({ temperature, humidity, windSpeed }))(
      readNowcastGrid(JSON.parse(raw('kma-ultra-srt-ncst.json')))!,
    ),
    { temperature: 13.1, humidity: 82, windSpeed: 2.6 },
  );
  // 항목이 빠지면 0 이 아니라 없음이다
  const items = today.response.body.items.item.filter(
    (item: { category: string }) => item.category !== 'REH',
  );
  const partial = { response: { body: { items: { item: items } } } };
  assert.equal(readNowcastGrid(partial)?.humidity, null);
  assert.equal(readNowcastGrid({ response: { body: { items: { item: [] } } } }), null);

  // 관측 하나로: 매시 자료라 2시간까지 최신으로 본다
  const observedAt = Date.parse('2026-10-10T03:00:00Z');
  const fresh = gridObservation(reading!, observedAt + 50 * 60_000);
  assert.equal(fresh.status, 'current');
  assert.equal(fresh.ageMinutes, 50);
  assert.deepEqual(fresh.issues, []);
  assert.equal(fresh.device.id, 'kma-grid-105-94');
  assert.equal(fresh.device.provider, 'kma-grid');
  assert.deepEqual(toKmaGrid(fresh.device.latitude, fresh.device.longitude), { nx: 105, ny: 94 });
  assert.equal(gridObservation(reading!, observedAt + 130 * 60_000).status, 'stale');
  assert.equal(gridObservation(readNowcastGrid(partial)!, observedAt).status, 'invalid');
  // 화면 검증을 통과한다
  assert.equal(
    readLiveSnapshot({
      fetchedAt: '2026-10-10T03:50:00Z',
      source: '테스트',
      sourceUrl: 'https://apihub.kma.go.kr/',
      devices: [fresh.device],
      observations: [fresh],
      selected: fresh,
      warnings: [],
      status: 'ok',
      llm: { configured: false, model: 'test' },
      selectionReason: 'kma-grid',
    }).selected?.device.provider,
    'kma-grid',
  );
});

test('the grid observation and the rain check share one nowcast call', async () => {
  const urls: URL[] = [];
  const source = createKmaSource(
    { kmaAuthKey: 'kma-secret', staleAfterMinutes: 30 },
    async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith('getUltraSrtNcst'))
        return new Response(raw('kma-ultra-srt-ncst-2026-10-10.json'));
      if (url.pathname.endsWith('nph-aws2_min')) return new Response(raw('kma-aws816-minute.txt'));
      return new Response('{}');
    },
    () => Date.parse('2026-10-10T03:50:00Z'),
  )!;
  const site = { latitude: 35.9812, longitude: 129.5402 };
  const [weather, grid] = await Promise.all([source.weather(site), source.grid!(site)]);
  assert.equal(weather?.precipitation?.type, '없음');
  assert.equal(grid?.temperature, 24.3);
  assert.equal(grid?.status, 'current');
  assert.equal(urls.filter((url) => url.pathname.endsWith('getUltraSrtNcst')).length, 1);
  // 키는 URL 에만 있고 관측 결과에는 없다
  assert.ok(!JSON.stringify(grid).includes('kma-secret'));
});

test('when the 10-minute wind (WS10) is missing, the 1-minute wind (WS1) is used', () => {
  // 2026-10-10 에 816 의 WS10 이 모든 줄에서 -99.9 로 왔다 (WS1 은 정상)
  const body = raw('kma-aws816-minute.txt')
    .split('\n')
    .map((row) => {
      if (row.startsWith('#') || !row.trim()) return row;
      const column = row.trim().split(/\s+/);
      column[7] = '-99.9';
      return column.join(' ');
    })
    .join('\n');
  const read = readAwsMinute(body, OBSERVED + 2 * 60_000, 30);
  const ws1 = Number(
    raw('kma-aws816-minute.txt')
      .split('\n')
      .filter((row) => row.trim() && !row.startsWith('#'))
      .at(-1)!
      .trim()
      .split(/\s+/)[3],
  );
  assert.equal(read?.observation.windSpeed, ws1);
  assert.equal(read?.observation.status, 'current');
});

test('AWS 816 rain is told only to sites within 5 km, and a late nowcast falls back one hour', async () => {
  const asked: string[] = [];
  const source = createKmaSource(
    { kmaAuthKey: 'kma-secret', staleAfterMinutes: 30 },
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('getUltraSrtNcst')) {
        asked.push(url.searchParams.get('base_time')!);
        // 13:00 자료가 아직 없다 (발표 지연) → 빈 목록
        if (url.searchParams.get('base_time') === '1300')
          return Response.json({ response: { header: { resultCode: '03' }, body: { items: '' } } });
        return new Response(raw('kma-ultra-srt-ncst-2026-10-10.json'));
      }
      if (url.pathname.endsWith('nph-aws2_min')) return new Response(raw('kma-aws816-minute.txt'));
      return new Response('{}');
    },
    // 13:46 KST: 45분 전은 13:01 → 13:00 자료를 묻는다
    () => Date.parse('2026-10-10T04:46:00Z'),
  )!;
  const near = await source.weather({ latitude: 35.9812, longitude: 129.5402 });
  assert.equal(near?.rain?.todayMm, 0);
  assert.deepEqual(asked, ['1300', '1200']);
  // 한 시간 전 자료의 비·눈은 오래됐을 수 있어 쓰지 않는다 (판정은 적합 대신 주의가 된다)
  assert.equal(near?.precipitation, null);
  // 약 9km 남쪽 덕장에는 구룡포 AWS 강수량을 붙이지 않는다
  const far = await source.weather({ latitude: 35.9035, longitude: 129.5145 });
  // (다른 자료도 없으면 weather 자체가 없다)
  assert.equal(far?.rain ?? null, null);
  // 한 시간 전 격자 값도 2시간 안이라 최신이다
  const grid = await source.grid!({ latitude: 35.9812, longitude: 129.5402 });
  assert.equal(grid?.status, 'current');
  assert.equal(grid?.ageMinutes, 106);
});

test('a KMA outage does not trigger a second nowcast request for the previous hour', async () => {
  const asked: string[] = [];
  const source = createKmaSource(
    { kmaAuthKey: 'kma-secret', staleAfterMinutes: 30 },
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('getUltraSrtNcst')) {
        asked.push(url.searchParams.get('base_time')!);
        return new Response('', { status: 503 });
      }
      return new Response('', { status: 503 });
    },
    () => Date.parse('2026-10-10T04:46:00Z'),
  )!;
  assert.equal(await source.grid!({ latitude: 35.9812, longitude: 129.5402 }), null);
  assert.deepEqual(asked, ['1300']);
});
