import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addEvidence,
  addLooseNumbers,
  addTextEvidence,
  currentSentences,
  emptyEvidence,
  measuredNumbers,
  promisesSafety,
  ungroundedNumbers,
} from './answer-checks.ts';
import { DRYING_THRESHOLDS } from '../src/lib/drying.ts';
import { checkAnswer } from './chat.ts';

test('only measured numbers are read, 도 with particles is a temperature, and 영하 means below zero', () => {
  assert.deepEqual(
    measuredNumbers(
      '영하 3.2도, 습도 72%, 바람 4.1m/s, 강수 1.5mm. 10월 9일 14시, 300마리, 2일째',
    ).map((item) => [item.value, item.unit]),
    [
      [-3.2, '°C'],
      [72, '%'],
      [4.1, 'm/s'],
      [1.5, 'mm'],
    ],
  );
  assert.deepEqual(
    measuredNumbers(
      '기온은 25도예요, 15도이고, 31도로 올라 영하 7도까지 떨어져요. 적합 비율 +8%p',
    ).map((item) => item.value),
    [25, 15, 31, -7, 8],
  );
  assert.deepEqual(
    measuredNumbers('12도라서, 10도면, 12도에 가까워요, 12도인데. 걱정할 건 1도 없어요. 3도시').map(
      (item) => item.value,
    ),
    [12, 10, 12, 12],
  );
});

test('evidence is collected per unit from result keys, and timestamps or citations never count', () => {
  const evidence = addEvidence(emptyEvidence(), {
    observation: {
      temperature: 3.1,
      humidity: 66.4,
      windSpeed: 1.2,
      observedAt: '10.09 13:05 KST',
    },
    totals: { gradeHours: { 적합: 7 }, percentages: { 적합: 52 } },
    differences: { humidityMean: -20 },
    reasons: ['기온 3.1°C · 적정 -5~10°C 안이에요'],
    distanceM: 30,
  });
  assert.deepEqual(evidence['°C'].sort(), [3.1, 3.1, 10].sort());
  assert.deepEqual(evidence['%'].sort(), [66.4, 52, -20, 20].sort());
  assert.deepEqual(evidence['m/s'], [1.2]);
  // 시각 13:05, 적합 시간 7, 거리 30 은 측정값 근거가 아니다.
  assert.deepEqual(ungroundedNumbers('기온 7°C, 풍속 9m/s, 습도 13%', evidence), [
    '7°C',
    '9m/s',
    '13%',
  ]);
  assert.deepEqual(ungroundedNumbers('영하 14°C', evidence), ['영하 14°C']);
  // 같은 숫자라도 단위가 다르면 근거가 아니다.
  assert.deepEqual(ungroundedNumbers('습도 3.1%', evidence), ['3.1%']);
  // 반올림과 차이 값의 부호 없는 표현은 괜찮다.
  assert.deepEqual(ungroundedNumbers('습도 66%, 기온 3도, 습도가 20%p 낮아요', evidence), []);
  // 사용자가 쓴 숫자는 단위 없이도 되말할 수 있다. 날짜·시각의 숫자는 빼고 읽는다.
  addLooseNumbers(evidence, '습도 70이면 어때? 2025-12-01 13:05 부터 -2도');
  assert.deepEqual(ungroundedNumbers('습도 70%면 주의예요, 영하 2도', evidence), []);
  assert.deepEqual(ungroundedNumbers('영하 12도', evidence), ['영하 12도']);
  addTextEvidence(evidence, '영하 4도에서 영상 10도 정도');
  assert.deepEqual(ungroundedNumbers('영하 4도', evidence), []);
});

test('current sentences are about now; forecast, past and conditional sentences are left out', () => {
  const text =
    '지금은 습도가 높아요. 어제는 적합 시간이 4시간이었어요. 예보로는 오후 3시에 적합이 예상돼요. 바람은 약해요.';
  assert.deepEqual(currentSentences(text, { current: false, otherTimes: true }), [
    '지금은 습도가 높아요.',
  ]);
  assert.deepEqual(currentSentences(text, { current: true, otherTimes: true }), [
    '지금은 습도가 높아요.',
    '바람은 약해요.',
  ]);
  // 예보를 함께 본 답에서는 "오늘"이 있어도 예보 문장이다.
  assert.deepEqual(
    currentSentences('예보로는 오늘 15시 예상 등급이 적합이에요.', {
      current: true,
      otherTimes: true,
    }),
    [],
  );
  // 조건 문장은 조건 앞부분만 현재로 본다 (판정은 조건 뒤에 있으니 대조할 것이 없다).
  assert.deepEqual(
    currentSentences('습도만 75% 아래로 내려가면 적합이에요.', {
      current: true,
      otherTimes: false,
    }),
    ['습도만 75% 아래로 내려가'],
  );
  assert.deepEqual(
    currentSentences("지금은 '적합'이에요, 바로 널면 돼요.", { current: true, otherTimes: false }),
    ["지금은 '적합'이에요, 바로 널"],
  );
  // 현재 관측만 본 답에서는 과거형 어미가 있어도 현재 문장으로 본다.
  assert.deepEqual(
    currentSentences('규칙 함수가 적합으로 판정했어요.', { current: true, otherTimes: false }),
    ['규칙 함수가 적합으로 판정했어요.'],
  );
});

test('honest forecast, history and conditional answers pass; wrong current claims and safety promises do not', () => {
  // 채팅에서는 판정 기준값이 늘 근거에 들어간다 (chat.ts 의 BASE_EVIDENCE).
  const evidence = addEvidence(emptyEvidence(), [
    { humidity: 72.7, temperature: 4 },
    DRYING_THRESHOLDS,
  ]);
  addLooseNumbers(evidence, '75');
  const check = (text: string, tools: string[]) =>
    checkAnswer({ text, grade: '부적합', usedTools: new Set(tools), evidence });
  // 리뷰에서 잘못 바뀌던 답 (예보·과거·조건·근로자 안전 안내)
  for (const [text, tools] of [
    ['예보로는 15시부터 널어도 괜찮을 것 같아요.', ['get_forecast_outlook']],
    [
      "지금은 '부적합'이에요. 예보로는 오늘 15시 예상 등급이 '적합'이에요.",
      ['get_current_conditions', 'get_forecast_outlook'],
    ],
    ['어제는 하루 종일 널어도 괜찮았어요.', ['get_weather_history']],
    ['지난 7일 중 건조 가능한 날씨는 사흘이었어요.', ['get_weather_history']],
    ['습도만 75% 아래로 내려가면 적합이에요.', ['get_current_conditions']],
    ['근로자는 안전한 환경에서 작업하도록 안내해 주세요.', []],
    [
      '앱 기준으로는 기온이 10도 이하로 내려가야 "적합"이에요. 15도를 넘으면 "부적합"이고, 습도 60% 미만도 맞아야 해요.',
      ['get_current_conditions'],
    ],
  ] as const)
    assert.deepEqual(check(text, [...tools]), { ok: true }, text);
  for (const [text, tools, reason] of [
    ["지금 등급은 '적합'이에요.", ['get_current_conditions'], 'grade'],
    // 다시 본 리뷰: 기준·조건 말이 있어도 지금 판정을 말하면 대조한다
    ["현재 기준으로는 '적합'이에요.", ['get_current_conditions'], 'grade'],
    ["지금은 습도가 85% 이상이라 '적합'이에요.", ['get_current_conditions'], 'grade'],
    ["지금은 '적합'이에요, 바로 널면 돼요.", ['get_current_conditions'], 'grade'],
    ['지금은 습도가 60% 미만이라 널어도 괜찮아요.', ['get_weather_history'], 'grade'],
    ["진행 중인 배치는 지금 '적합'이에요.", ['get_current_conditions', 'get_batches'], 'grade'],
    [
      "지금(14시 관측) 등급은 '적합'이에요.",
      ['get_current_conditions', 'get_forecast_outlook'],
      'grade',
    ],
    ['지금 널어도 괜찮아요.', ['get_weather_history'], 'grade'],
    ['어제 말린 과메기는 안전합니다.', ['get_weather_history'], 'grade'],
    ['지난주 평균 습도는 81%였어요.', ['get_weather_history'], 'numbers'],
  ] as const)
    assert.deepEqual(check(text, [...tools]), { ok: false, reason }, text);
  assert.equal(check('지난주 평균 습도는 73%였어요.', ['get_weather_history']).ok, true);
  assert.equal(promisesSafety('품질이나 안전을 보장하지는 않아요.'), false);
});
