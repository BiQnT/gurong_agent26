import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readLiveSnapshot } from '../src/lib/live.ts';
import {
  AWS_816,
  createKmaSource,
  readAwsMinute,
  readNowcast,
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
