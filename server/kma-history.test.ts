import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKmaHistory,
  createKmaShortForecast,
  hourlyStamps,
  readVilageForecast,
  sampleStepHours,
  vilageBase,
} from './sources/kma-history.ts';

// 응답 줄은 2026-10-09 실제 호출(research/api-tests/2026-10-09-kma-history.md)의 형식 그대로다.
// YYMMDDHHMI STN WD1 WS1 WDS WSS WD10 WS10 TA RE RN-15m RN-60m RN-12H RN-DAY HM PA PS TD
const awsLine = (stamp: string, ta: number, hm: number, ws10: number, rn60 = 0) =>
  `${stamp}   816  314.0    2.4  301.0    3.9  315.5    ${ws10}    ${ta}    0.0    0.0    ${rn60}    0.0    0.0   ${hm} 1014.4 1019.7   -5.7`;

test('the sample step grows with the period, and stamps stop before data that has not arrived', () => {
  assert.deepEqual([7, 8, 31, 32, 62, 63, 120].map(sampleStepHours), [1, 3, 3, 6, 6, 12, 12]);
  const now = Date.parse('2026-01-10T05:30:00+09:00');
  // 05:30 기준 70분 여유: 04:20 전까지 → 00·01·02·03·04시
  assert.deepEqual(hourlyStamps({ from: '2026-01-10', to: '2026-01-10' }, 1, now), [
    '202601100000',
    '202601100100',
    '202601100200',
    '202601100300',
    '202601100400',
  ]);
  assert.equal(hourlyStamps({ from: '2026-01-01', to: '2026-01-02' }, 6, now).length, 8);
});

test('history asks one minute per sampled hour, remembers it, and keeps rain only at hourly steps', async () => {
  const asked: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('authKey'), 'kma-key');
    assert.equal(url.searchParams.get('stn'), '816');
    const stamp = url.searchParams.get('tm1')!;
    assert.equal(url.searchParams.get('tm2'), stamp);
    asked.push(stamp);
    // 02시는 자료가 없다 (빈 응답)
    if (stamp.endsWith('0200')) return new Response('# no data\n');
    return new Response(
      `#START\n${awsLine(stamp, 5.5, 48.2, 3.1, stamp.endsWith('0300') ? 1.5 : 0)}\n`,
    );
  };
  const now = () => Date.parse('2026-01-10T05:30:00+09:00');
  const history = createKmaHistory({ kmaAuthKey: 'kma-key' }, fetcher, now)!;
  const result = await history(
    { from: '2026-01-10', to: '2026-01-10' },
    new AbortController().signal,
  );
  assert.equal(result?.sampleMinutes, 60);
  assert.equal(result?.source, '기상청 구룡포 AWS 매시 관측');
  assert.equal(result?.samples.length, 4);
  const three = result!.samples.find((sample) => sample.at === '2026-01-09T18:00:00.000Z')!;
  assert.deepEqual(three, {
    at: '2026-01-09T18:00:00.000Z',
    temperature: 5.5,
    humidity: 48.2,
    windSpeed: 3.1,
    rainMm: 1.5,
  });
  // 다시 부르면 받은 시각은 기억에서 꺼내고, 못 받은 02시만 다시 묻는다.
  asked.length = 0;
  await history({ from: '2026-01-10', to: '2026-01-10' }, new AbortController().signal);
  assert.deepEqual(asked, ['202601100200']);
  // 키가 없으면 과거 관측 소스가 없다.
  assert.equal(createKmaHistory({}), undefined);
});

test('long periods use sparse samples without rain, and HTTP errors give no history', async () => {
  const fetcher: typeof fetch = async (input) => {
    const stamp = new URL(String(input)).searchParams.get('tm1')!;
    return new Response(awsLine(stamp, 4, 55, 2.5, 3));
  };
  const history = createKmaHistory({ kmaAuthKey: 'k' }, fetcher, () =>
    Date.parse('2026-03-01T12:00:00+09:00'),
  )!;
  const result = await history(
    { from: '2025-12-01', to: '2025-12-31' },
    new AbortController().signal,
  );
  assert.equal(result?.sampleMinutes, 180);
  assert.equal(result?.samples.length, 31 * 8);
  assert.ok(result?.samples.every((sample) => sample.rainMm === null));
  const denied = createKmaHistory(
    { kmaAuthKey: 'k' },
    async () => new Response('', { status: 403 }),
  )!;
  assert.equal(
    await denied({ from: '2025-12-01', to: '2025-12-01' }, new AbortController().signal),
    null,
  );
});

test('the short-range forecast is read hour by hour from now on, with shower and probability', () => {
  const item = (time: string, category: string, value: string) => ({
    baseDate: '20261009',
    baseTime: '1100',
    category,
    fcstDate: '20261009',
    fcstTime: time,
    fcstValue: value,
    nx: 105,
    ny: 94,
  });
  const payload = {
    response: {
      body: {
        items: {
          item: [
            ...[
              ['TMP', '24'],
              ['REH', '55'],
              ['WSD', '1.2'],
              ['PTY', '0'],
              ['POP', '0'],
            ].map(([c, v]) => item('1100', c, v)),
            ...[
              ['TMP', '23'],
              ['REH', '60'],
              ['WSD', '2.4'],
              ['PTY', '4'],
              ['POP', '60'],
              ['PCP', '1.0mm'],
            ].map(([c, v]) => item('1200', c, v)),
          ],
        },
      },
    },
  };
  const forecast = readVilageForecast(payload, Date.parse('2026-10-09T12:10:00+09:00'));
  assert.equal(forecast?.issuedAt, '2026-10-09T02:00:00.000Z');
  assert.deepEqual(forecast?.hours, [
    {
      at: '2026-10-09T03:00:00.000Z',
      temperature: 23,
      humidity: 60,
      windSpeed: 2.4,
      precipitation: '소나기',
      pop: 60,
    },
  ]);
  assert.equal(readVilageForecast({ response: {} }, 0), null);
  // 02시 발표 전 새벽에는 전날 23시 발표를 쓴다.
  assert.deepEqual(vilageBase(Date.parse('2026-10-09T01:00:00+09:00')), {
    date: '20261008',
    time: '2300',
  });
  assert.deepEqual(vilageBase(Date.parse('2026-10-09T11:25:00+09:00')), {
    date: '20261009',
    time: '1100',
  });
});

test('the short-range forecast is fetched once per release for the site grid', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('nx'), '105');
    assert.equal(url.searchParams.get('ny'), '94');
    return Response.json({ response: { body: { items: { item: [] } } } });
  };
  const forecast = createKmaShortForecast({ kmaAuthKey: 'k' }, fetcher, () =>
    Date.parse('2026-10-09T12:00:00+09:00'),
  )!;
  const site = { latitude: 35.9812, longitude: 129.5402 };
  assert.equal(await forecast(site), null);
  await forecast(site);
  assert.equal(calls, 1);
  assert.equal(createKmaShortForecast({}), undefined);
});
