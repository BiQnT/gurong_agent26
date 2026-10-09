import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectNumbers,
  currentSentences,
  measuredNumbers,
  ungroundedNumbers,
} from './answer-checks.ts';
import { checkAnswer } from './chat.ts';

test('only measured numbers are read, and 영하 means below zero', () => {
  assert.deepEqual(
    measuredNumbers(
      '영하 3.2도, 습도 72%, 바람 4.1m/s, 강수 1.5mm. 10월 9일 14시, 300마리, 2일째',
    ).map((item) => item.value),
    [-3.2, 72, 4.1, 1.5],
  );
  assert.deepEqual(collectNumbers({ a: [1, '습도 72.7%'], b: { c: -3 } }), [1, 72.7, -3]);
});

test('numbers must come from the evidence, rounded to the precision the answer used', () => {
  const evidence = [72.7, 3.25, -2.4];
  assert.deepEqual(ungroundedNumbers('습도 73%, 풍속 3.3m/s, 영하 2.4도', evidence), []);
  assert.deepEqual(ungroundedNumbers('습도 72.7%예요', evidence), []);
  assert.deepEqual(ungroundedNumbers('습도 70% 정도예요. 기온 15도', evidence), ['70%', '15도']);
});

test('current sentences are the ones about now, past and forecast sentences are left out', () => {
  const text =
    '지금은 습도가 높아요. 어제는 적합 시간이 4시간이었어요. 예보로는 오후 3시에 적합이 예상돼요. 바람은 약해요.';
  assert.deepEqual(currentSentences(text, { current: false, otherTimes: true }), [
    '지금은 습도가 높아요.',
  ]);
  assert.deepEqual(currentSentences(text, { current: true, otherTimes: true }), [
    '지금은 습도가 높아요.',
    '바람은 약해요.',
  ]);
  // 현재 관측만 본 답에서는 과거형 어미가 있어도 현재 문장으로 본다.
  assert.deepEqual(
    currentSentences('규칙 함수가 적합으로 판정했어요.', { current: true, otherTimes: false }),
    ['규칙 함수가 적합으로 판정했어요.'],
  );
});

test('checkAnswer separates a wrong current grade from honest talk about other days', () => {
  const evidence = [72.7, 4];
  const current = new Set(['get_current_conditions']);
  const both = new Set(['get_current_conditions', 'get_weather_history']);
  const history = new Set(['get_weather_history']);
  // 현재 등급과 다른 등급
  assert.deepEqual(
    checkAnswer({
      text: "지금 등급은 '적합'이에요.",
      grade: '주의',
      usedTools: current,
      allowedNumbers: evidence,
    }),
    { ok: false, reason: 'grade' },
  );
  // 과거 이야기에 다른 등급이 나와도 괜찮다
  assert.deepEqual(
    checkAnswer({
      text: "지금은 '주의'예요. 지난주에는 부적합이었던 날이 많았어요.",
      grade: '주의',
      usedTools: both,
      allowedNumbers: evidence,
    }),
    { ok: true },
  );
  // 현재 관측을 보지 않고 지금 널어도 된다고 하면 안 된다
  assert.deepEqual(
    checkAnswer({
      text: '지금 널어도 괜찮아요.',
      grade: '주의',
      usedTools: history,
      allowedNumbers: evidence,
    }),
    { ok: false, reason: 'grade' },
  );
  // 안전 보장은 언제든 막는다
  assert.deepEqual(
    checkAnswer({
      text: '어제 말린 과메기는 안전합니다.',
      grade: '주의',
      usedTools: history,
      allowedNumbers: evidence,
    }),
    { ok: false, reason: 'grade' },
  );
  // 근거 없는 측정 숫자
  assert.deepEqual(
    checkAnswer({
      text: '지난주 평균 습도는 81%였어요.',
      grade: '주의',
      usedTools: history,
      allowedNumbers: evidence,
    }),
    { ok: false, reason: 'numbers' },
  );
  assert.deepEqual(
    checkAnswer({
      text: '지난주 평균 습도는 73%였어요.',
      grade: '주의',
      usedTools: history,
      allowedNumbers: evidence,
    }),
    { ok: true },
  );
});
