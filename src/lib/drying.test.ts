import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessDrying,
  describeThresholds,
  DRYING_THRESHOLDS,
  evaluateBatch,
  gradeConditions,
  kst,
  readAssessment,
} from './drying.ts';
import type { LiveObservation, SiteWeather } from './live.ts';

const at = '2026-10-06T13:31:00.000Z';
function observed(overrides: Partial<LiveObservation> = {}): LiveObservation {
  return {
    device: {
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      address: 'AWS 816',
      latitude: 35.9831,
      longitude: 129.5475,
      provider: 'kma',
    },
    temperature: 3.2,
    humidity: 46,
    windSpeed: 4.3,
    observedAt: at,
    observedAtRaw: '202610062231',
    ageMinutes: 1,
    status: 'current',
    issues: [],
    distanceM: 690,
    ...overrides,
  };
}

test('three axes give 적합, 주의 and 부적합 the same way every time (기획서 + 보완 기준)', () => {
  // 기획서 예시: 기온 3.2℃ · 습도 46% · 풍속 4.3m/s → 적합
  const suitable = assessDrying(observed());
  assert.equal(suitable.grade, '적합');
  assert.equal(suitable.thresholds?.version, DRYING_THRESHOLDS.version);
  assert.ok(suitable.reasons.some((reason) => reason.includes('10.06 22:31 KST')));
  // 사용자가 겪은 상황: 기상청 AWS 13.9℃ · 83% · 2.2m/s → 기온과 습도가 높아 주의
  const caution = assessDrying(observed({ temperature: 13.9, humidity: 83, windSpeed: 2.2 }));
  assert.equal(caution.grade, '주의');
  assert.match(caution.summary, /기온이 적정보다 높아요\(13\.9°C\), 습도가 높아요\(83%\)/);
  // 경계값: 습도 60 은 적합이 아니고, 풍속 2 는 적합이다
  assert.equal(
    gradeConditions({ temperature: 5, humidity: 59.9, windSpeed: 2, raining: false }).grade,
    '적합',
  );
  assert.equal(
    gradeConditions({ temperature: 5, humidity: 60, windSpeed: 2, raining: false }).grade,
    '주의',
  );
  assert.equal(
    gradeConditions({ temperature: 5, humidity: 50, windSpeed: 1.9, raining: false }).grade,
    '주의',
  );
  assert.equal(
    gradeConditions({ temperature: 10, humidity: 50, windSpeed: 3, raining: false }).grade,
    '적합',
  );
  assert.equal(
    gradeConditions({ temperature: 10.1, humidity: 50, windSpeed: 3, raining: false }).grade,
    '주의',
  );
  // 부적합: 습도 85 이상, 강풍 14 이상, 기온 15 초과, 비·눈
  for (const axes of [
    { temperature: 5, humidity: 85, windSpeed: 3, raining: false },
    { temperature: 5, humidity: 50, windSpeed: 14, raining: false },
    { temperature: 15.1, humidity: 50, windSpeed: 3, raining: false },
    { temperature: 5, humidity: 50, windSpeed: 3, raining: true },
  ])
    assert.equal(gradeConditions(axes).grade, '부적합', JSON.stringify(axes));
  assert.equal(
    gradeConditions({ temperature: 15, humidity: 84.9, windSpeed: 13.9, raining: false }).grade,
    '주의',
  );
  const rain: SiteWeather = {
    precipitation: { type: '비', rain1hMm: 1.5, observedAt: at },
    rain: null,
    sun: null,
  };
  const wet = assessDrying(observed(), rain);
  assert.equal(wet.grade, '부적합');
  assert.match(wet.summary, /비·눈이 오고 있어요/);
});

test('every gate that cannot be trusted ends in 판정 불가 with its reason', () => {
  const cases: [LiveObservation | null, RegExp][] = [
    [null, /쓸 수 있는 관측값이 없어/],
    [observed({ distanceM: 1001 }), /1km 밖/],
    [observed({ status: 'stale', ageMinutes: 45 }), /최근 관측값이 아니어서/],
    [observed({ humidity: null, status: 'invalid' }), /최근 관측값이 아니어서/],
    [observed({ humidity: 0, temperature: 0 }), /비정상으로 보여/],
    [observed({ temperature: -6 }), /저온은 아직 판정 기준 밖/],
  ];
  for (const [input, summary] of cases) {
    const result = assessDrying(input);
    assert.equal(result.grade, '판정 불가');
    assert.match(result.summary, summary);
    assert.ok(result.reasons.length > 0);
    assert.ok(readAssessment(JSON.parse(JSON.stringify(result))), 'the screen accepts it');
  }
});

test('forecast rain becomes advice without changing the grade', () => {
  const weather: SiteWeather = {
    precipitation: { type: '없음', rain1hMm: 0, observedAt: at },
    rain: { last60mMm: 0, todayMm: 0, observedAt: at },
    sun: { date: '2026-10-06', sunrise: '06:21', sunset: '17:59' },
    forecast: {
      issuedAt: '2026-10-06T12:30:00.000Z',
      hours: [
        {
          at: '2026-10-06T14:00:00.000Z',
          temperature: 13,
          humidity: 75,
          windSpeed: 3,
          precipitation: '없음',
          rain: null,
        },
        {
          at: '2026-10-06T15:00:00.000Z',
          temperature: 14,
          humidity: 70,
          windSpeed: 3,
          precipitation: '빗방울',
          rain: '1mm 미만',
        },
      ],
    },
  };
  const result = assessDrying(observed(), weather);
  assert.equal(result.grade, '적합');
  assert.deepEqual(result.advice, [
    '10.07 00:00 KST 빗방울 예보예요 (기상청 초단기예보). 덮개나 회수를 미리 준비해 주세요.',
  ]);
});

test('KST formatting, threshold text and the screen validator', () => {
  assert.equal(kst('2026-10-06T13:30:44.000Z'), '10.06 22:30 KST');
  assert.equal(kst(null), '시각 없음');
  assert.match(describeThresholds(), /습도 60% 미만 · 풍속 2~14m\/s · 기온 -5~10°C/);
  const valid = assessDrying(observed());
  assert.deepEqual(readAssessment(JSON.parse(JSON.stringify(valid))), valid);
  assert.equal(readAssessment({ ...valid, grade: '최고' }), null);
  // 등급이 있는데 근거 수치가 없거나 1km 를 넘으면 받지 않는다
  assert.equal(readAssessment({ ...valid, humidity: null }), null);
  assert.equal(readAssessment({ ...valid, distanceM: 1200 }), null);
});

test('a batch is evaluated from its recorded samples with the current rules', () => {
  const sample = (
    temperature: number | null,
    humidity: number | null,
    wind: number | null,
    minute: number,
  ) => ({
    observedAt: new Date(Date.parse(at) + minute * 60_000).toISOString(),
    temperature,
    humidity,
    wind,
  });
  const evaluation = evaluateBatch([
    sample(3, 50, 3, 0),
    sample(12, 80, 2.5, 30),
    sample(8, 90, 1, 60),
    sample(null, null, null, 90),
    sample(5, 0, 3, 120),
  ]);
  assert.deepEqual(evaluation.counts, { 적합: 1, 주의: 1, 부적합: 1 });
  assert.equal(evaluation.unrated, 2);
  assert.equal(evaluation.firstUnsuitableAt, sample(0, 0, 0, 60).observedAt);
  assert.equal(
    evaluation.summary,
    '적합 33% · 주의 33% · 부적합 33% (표본 3개, 결측·판정 제외 2개)',
  );
  assert.equal(evaluateBatch([]).summary, '판정할 수 있는 관측 표본이 아직 없어요.');
});
