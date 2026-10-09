import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forecastDays,
  forecastOutlook,
  gradeSample,
  kstDate,
  readForecastOutlook,
  readHistorySummary,
  summarizeHistory,
  type HistorySample,
  type ShortForecastHour,
} from './analysis.ts';

// 2026-01-10 KST 하루를 시간자료로 만든다. 값은 손으로 정한 것이라 기대값을 직접 셀 수 있다.
const hour = (h: number, values: Partial<HistorySample> = {}): HistorySample => ({
  at: new Date(Date.parse('2026-01-10T00:00:00+09:00') + h * 3_600_000).toISOString(),
  temperature: 5,
  humidity: 50,
  windSpeed: 3,
  rainMm: 0,
  ...values,
});

test('each sample is graded by the same rule function, and unusable samples are excluded', () => {
  assert.equal(gradeSample(hour(0)), '적합');
  assert.equal(gradeSample(hour(0, { humidity: 70 })), '주의');
  assert.equal(gradeSample(hour(0, { humidity: 90 })), '부적합');
  assert.equal(gradeSample(hour(0, { rainMm: 0.5 })), '부적합');
  assert.equal(gradeSample(hour(0, { windSpeed: null })), '제외');
  assert.equal(gradeSample(hour(0, { humidity: 2 })), '제외');
  assert.equal(gradeSample(hour(0, { temperature: -8 })), '제외');
  // 강수 자료가 없으면(null) 비·눈 없이 매긴다.
  assert.equal(gradeSample(hour(0, { rainMm: null })), '적합');
});

test('a day of hourly samples becomes grade hours, a best window and a missing rate', () => {
  // 0~9시 습함(주의) · 10~15시 적합(6시간) · 16시 비(부적합) · 17시 빠짐 · 18~23시 적합(6시간, 23시가 마지막)
  const samples = [
    ...Array.from({ length: 10 }, (_, h) => hour(h, { humidity: 70 })),
    ...Array.from({ length: 6 }, (_, h) => hour(10 + h)),
    hour(16, { rainMm: 2 }),
    ...Array.from({ length: 6 }, (_, h) => hour(18 + h)),
  ];
  const summary = summarizeHistory({
    samples,
    from: '2026-01-10',
    to: '2026-01-10',
    source: '기상청 구룡포 AWS 시간자료',
    station: '기상청 구룡포 AWS',
    distanceM: 690,
    sampleMinutes: 60,
    now: Date.parse('2026-02-01T00:00:00+09:00'),
  });
  assert.equal(summary.resolution, 'day');
  assert.equal(summary.expectedSamples, 24);
  assert.equal(summary.samples, 23);
  assert.equal(summary.missingRate, 4.2);
  assert.equal(summary.rows.length, 1);
  const [row] = summary.rows;
  assert.equal(row.label, '01.10');
  assert.deepEqual(row.gradeHours, { 적합: 12, 주의: 10, 부적합: 1, 제외: 0 });
  // 같은 길이면 먼저 나온 구간 (10시~16시 전)
  assert.equal(row.bestWindow, '10~16시');
  assert.equal(row.rainMm, 2);
  assert.deepEqual(summary.totals.percentages, { 적합: 52, 주의: 43, 부적합: 4 });
  assert.match(summary.summary, /적합 12시간\(52%\)/);
  assert.match(summary.summary, /강수 2mm/);
  assert.ok(readHistorySummary(summary));
});

test('long periods are grouped by week, samples outside the range are dropped, and today stops at now', () => {
  const start = Date.parse('2025-11-01T00:00:00+09:00');
  const samples: HistorySample[] = [];
  for (let h = -24; h < 24 * 50; h += 6)
    samples.push({
      at: new Date(start + h * 3_600_000).toISOString(),
      temperature: 6,
      humidity: 55,
      windSpeed: 4,
      rainMm: null,
    });
  const summary = summarizeHistory({
    samples,
    from: '2025-11-01',
    to: '2025-12-15',
    source: '시험 자료',
    station: '시험 지점',
    distanceM: null,
    sampleMinutes: 360,
    now: Date.parse('2026-02-01T00:00:00+09:00'),
  });
  assert.equal(summary.resolution, 'week');
  assert.equal(summary.rows.length, 7);
  assert.equal(summary.rows[0].label, '11.01~11.07');
  assert.equal(summary.rows.at(-1)!.label, '12.13~12.15');
  // 11.01~12.15 는 45일, 6시간마다 4개 → 180개. 범위 밖(10.31)은 빠진다.
  assert.equal(summary.samples, 180);
  assert.equal(summary.missingRate, 0);
  assert.equal(summary.rainKnown, false);
  assert.match(summary.summary, /강수 자료가 없어 비·눈은 등급에서 뺐어요/);

  const today = summarizeHistory({
    samples: [hour(0), hour(1)],
    from: '2026-01-10',
    to: '2026-01-10',
    source: '시험',
    station: '시험',
    distanceM: null,
    sampleMinutes: 60,
    now: Date.parse('2026-01-10T03:30:00+09:00'),
  });
  // 03:30 까지라 기대 표본은 4개 (0·1·2·3시)
  assert.equal(today.expectedSamples, 4);
  assert.equal(today.missingRate, 50);
  assert.equal(kstDate('2026-01-09T15:00:00.000Z'), '2026-01-10');
});

test('forecast hours get an expected grade with the same rules, unknown values stay unrated', () => {
  const outlook = forecastOutlook({
    ultra: {
      issuedAt: '2026-01-10T03:30:00.000Z',
      hours: [
        {
          at: '2026-01-10T04:00:00.000Z',
          temperature: 4,
          humidity: 50,
          windSpeed: 3,
          precipitation: '없음',
          rain: null,
        },
        {
          at: '2026-01-10T05:00:00.000Z',
          temperature: 4,
          humidity: 50,
          windSpeed: 3,
          precipitation: '비',
          rain: '1mm',
        },
        {
          at: '2026-01-10T06:00:00.000Z',
          temperature: null,
          humidity: 50,
          windSpeed: 3,
          precipitation: '없음',
          rain: null,
        },
      ],
    },
  })!;
  assert.deepEqual(
    outlook.hours.map((h) => h.expectedGrade),
    ['적합', '부적합', '판정 불가'],
  );
  assert.equal(outlook.days, undefined);
  assert.match(outlook.summary, /적합 예상 시각은 13:00/);
  assert.match(outlook.summary, /현재 판정과 다를 수 있어요/);
  assert.ok(readForecastOutlook(outlook));
  assert.equal(readForecastOutlook({ ...outlook, hours: [{ at: 'x' }] }), null);
  assert.equal(forecastOutlook({}), null);
});

test('the 3-day forecast is grouped by KST day with expected grade hours and the longest window', () => {
  // 2026-01-11 KST: 0~5시 습함(주의), 6~11시 적합(6시간), 12시 비(부적합), 13~23시 적합(11시간)
  const hour = (h: number, values: Partial<ShortForecastHour> = {}): ShortForecastHour => ({
    at: new Date(Date.parse('2026-01-11T00:00:00+09:00') + h * 3_600_000).toISOString(),
    temperature: 5,
    humidity: 50,
    windSpeed: 3,
    precipitation: '없음',
    pop: 10,
    ...values,
  });
  const short = {
    issuedAt: '2026-01-10T23:00:00.000Z',
    hours: [
      ...Array.from({ length: 6 }, (_, h) => hour(h, { humidity: 70 })),
      ...Array.from({ length: 6 }, (_, h) => hour(6 + h)),
      hour(12, { precipitation: '비', pop: 60 }),
      ...Array.from({ length: 11 }, (_, h) => hour(13 + h)),
      hour(24, { temperature: null }),
    ],
  };
  const days = forecastDays(short);
  assert.deepEqual(
    days.map((day) => [day.date, day.hours]),
    [
      ['2026-01-11', 24],
      ['2026-01-12', 1],
    ],
  );
  assert.deepEqual(days[0].gradeHours, { 적합: 17, 주의: 6, 부적합: 1, 제외: 0 });
  assert.equal(days[0].bestWindow, '13~24시');
  assert.equal(days[0].maxPop, 60);
  assert.equal(days[0].precipitationHours, 1);
  assert.deepEqual(days[1].gradeHours, { 적합: 0, 주의: 0, 부적합: 0, 제외: 1 });
  // 초단기예보가 없으면 단기예보 앞 6시간을 가까운 시간으로 쓴다.
  const outlook = forecastOutlook({ short })!;
  assert.equal(outlook.hours.length, 6);
  assert.equal(outlook.source, '기상청 단기예보');
  assert.match(
    outlook.summary,
    /01\.11 적합 17시간·주의 6시간·부적합 1시간\(가장 긴 적합 13~24시\), 강수확률 최고 60%/,
  );
  assert.ok(readForecastOutlook(JSON.parse(JSON.stringify(outlook))));
});
