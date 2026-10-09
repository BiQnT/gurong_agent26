// AI 답을 화면에 내기 전에 코드가 다시 보는 검사 (ADR 0010, 0011).
// 모든 문장의 사실성을 증명하는 장치가 아니라, 규칙 등급과 도구 숫자를 벗어난 답을 거르는 마지막 그물이다.

/** 문장 단위로 나눈다. 마침표·물음표·느낌표·줄바꿈 뒤에서 자른다. */
export function sentences(text: string): string[] {
  return text
    .replace(/[*_`]/g, '')
    .split(/(?<=[.?!。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// 지금을 가리키는 말
const NOW = /지금|현재|오늘|당장|이\s*시각|요즘/;
// 지금이 아닌 때를 가리키는 말 (과거·예보·특정 날짜·배치)
const ELSEWHEN =
  /어제|그제|그저께|지난|작년|지난해|전년|예년|과거|당시|그때|그날|그\s*주|그\s*달|기간|내일|모레|글피|이따|나중|예보|예상|될\s*거|\d+\s*월|\d+\s*일(?!\s*(?:정도|째))|배치|회차/;
// 과거형 어미. 과거·배치 자료를 함께 본 답에서만 과거 문장의 표시로 쓴다
// ("규칙 함수가 주의로 판정했어요" 같은 현재 문장을 빼먹지 않게).
const PAST_TENSE = /었|았|였|했|됐|왔/;

/**
 * 현재 상태를 말하는 문장만 고른다.
 * - 지금을 가리키는 말이 있으면 현재다 ("오늘은 어제보다 습해요"도 현재로 본다).
 * - 현재 관측 도구를 부른 답이면, 다른 때를 가리키는 말이 없는 문장도 현재로 본다.
 *   과거·예보·배치 도구를 함께 불렀다면 과거형 문장도 다른 때로 본다.
 */
export function currentSentences(
  text: string,
  used: { current: boolean; otherTimes: boolean },
): string[] {
  return sentences(text).filter(
    (sentence) =>
      NOW.test(sentence) ||
      (used.current && !ELSEWHEN.test(sentence) && !(used.otherTimes && PAST_TENSE.test(sentence))),
  );
}

// 측정 단위가 붙은 숫자만 본다 (날짜·시각·마리 수·배치 수는 보지 않는다).
const MEASURE = /(영하\s*)?(-?\d+(?:\.\d+)?)\s*(?:°C|℃|도(?![가-힣])|%|퍼센트|m\/s|㎧|mm|밀리)/g;

/** 답 속의 측정 숫자. "영하 3도"는 -3 으로 읽는다. */
export function measuredNumbers(text: string): { value: number; decimals: number; raw: string }[] {
  const found: { value: number; decimals: number; raw: string }[] = [];
  for (const match of text.replace(/[*_`]/g, '').matchAll(MEASURE)) {
    const number = Number(match[2]);
    if (!Number.isFinite(number)) continue;
    found.push({
      value: match[1] && number > 0 ? -number : number,
      decimals: match[2].split('.')[1]?.length ?? 0,
      raw: match[0].trim(),
    });
  }
  return found;
}

/** 값 안의 모든 숫자 (객체·배열을 따라 들어가고, 글 속의 숫자도 꺼낸다). */
export function collectNumbers(value: unknown, into: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) into.push(value);
  else if (typeof value === 'string')
    for (const match of value.matchAll(/-?\d+(?:\.\d+)?/g)) into.push(Number(match[0]));
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, into);
  else if (typeof value === 'object' && value !== null)
    for (const item of Object.values(value)) collectNumbers(item, into);
  return into;
}

/**
 * 근거에 없는 측정 숫자. 답이 쓴 자릿수로 반올림해 같으면 근거가 있는 것으로 본다
 * (72.7% 를 73% 로 쓰는 것은 괜찮고 70% 는 안 된다). 부호 없이 같은 값("영하"를 빼먹은 경우)도 본다.
 */
export function ungroundedNumbers(text: string, allowed: number[]): string[] {
  const matches = (value: number, decimals: number) =>
    allowed.some((candidate) => {
      const scale = 10 ** decimals;
      const rounded = Math.round(candidate * scale) / scale;
      return (
        Math.abs(rounded - value) < 1e-9 || Math.abs(Math.abs(rounded) - Math.abs(value)) < 1e-9
      );
    });
  return measuredNumbers(text)
    .filter(({ value, decimals }) => !matches(value, decimals))
    .map(({ raw }) => raw);
}
