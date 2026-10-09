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
// 지금이 아닌 때를 가리키는 말 (과거·예보·특정 날짜·시각·배치)
const ELSEWHEN =
  /어제|그제|그저께|지난|작년|지난해|전년|예년|과거|당시|그때|그날|그\s*주|그\s*달|기간|내일|모레|글피|이따|나중|예보|예상|될\s*거|\d+\s*월|\d+\s*일(?!\s*(?:정도|째))|\d+\s*시|배치|회차/;
// 과거형 어미. 과거·배치 자료를 함께 본 답에서만 과거 문장의 표시로 쓴다
// ("규칙 함수가 주의로 판정했어요" 같은 현재 문장을 빼먹지 않게).
const PAST_TENSE = /었|았|였|했|됐|왔/;
// 조건·기준을 설명하는 문장은 지금 판정이 아니다: "습도가 내려가면 적합이에요", "10도 이하로 내려가야
// 적합이에요", "앱 기준으로는 15도를 넘으면 부적합이에요".
const CONDITION = /[가-힣]면(?:\s|,|$)|[가-힣]야(?:\s|,|$)|기준|가설값|미만|초과|이하|이상이/;

/**
 * 현재 상태를 말하는 문장만 고른다.
 * - 과거·예보·배치 도구를 함께 본 답: 다른 때를 가리키는 말이나 과거형이 있으면 지금이 아니다
 *   ("예보로는 오늘 15시에 적합이 예상돼요"는 예보 문장).
 * - 그 밖의 답: 지금을 가리키는 말이 있으면 현재다 ("오늘은 어제보다 습해요").
 * - 현재 관측 도구를 본 답이면 시점 말이 없는 문장도 현재로 본다.
 */
export function currentSentences(
  text: string,
  used: { current: boolean; otherTimes: boolean },
): string[] {
  return sentences(text).filter((sentence) => {
    if (CONDITION.test(sentence)) return false;
    const now = NOW.test(sentence);
    if (used.otherTimes)
      return (now || used.current) && !ELSEWHEN.test(sentence) && !PAST_TENSE.test(sentence);
    return now || (used.current && !ELSEWHEN.test(sentence));
  });
}

// ── 숫자 근거 ──

export type Unit = '°C' | '%' | 'm/s' | 'mm';
/** 단위별로 근거가 있는 숫자 */
export type Evidence = Record<Unit, number[]>;

export const emptyEvidence = (): Evidence => ({ '°C': [], '%': [], 'm/s': [], mm: [] });

// 측정 단위가 붙은 숫자만 본다 (날짜·시각·마리 수·배치 수는 보지 않는다).
// "도"는 "25도예요", "3도로", "영하 7도까지"처럼 조사가 붙어도 기온으로 읽는다.
const MEASURE =
  /(영하\s*)?([-+]?\d+(?:\.\d+)?)\s*(°C|℃|도(?=$|[^가-힣]|예요|에요|이에요|입니다|이고|이며|이라|로|까지|보다|가|는|를|씨|정도|에서|였|이었|이상|이하|미만|초과|안팎|쯤|대|나|만)|%p?|퍼센트|m\/s|㎧|mm|밀리)/g;

const unitOf = (suffix: string): Unit =>
  suffix === '°C' || suffix === '℃' || suffix === '도'
    ? '°C'
    : suffix === 'm/s' || suffix === '㎧'
      ? 'm/s'
      : suffix === 'mm' || suffix === '밀리'
        ? 'mm'
        : '%';

/** 답 속의 측정 숫자. "영하 3도"는 -3 으로 읽는다. */
export function measuredNumbers(
  text: string,
): { value: number; decimals: number; raw: string; unit: Unit }[] {
  const found: { value: number; decimals: number; raw: string; unit: Unit }[] = [];
  for (const match of text.replace(/[*_`]/g, '').matchAll(MEASURE)) {
    const number = Number(match[2]);
    if (!Number.isFinite(number)) continue;
    found.push({
      value: match[1] && number > 0 ? -number : number,
      decimals: match[2].split('.')[1]?.length ?? 0,
      raw: match[0].trim(),
      unit: unitOf(match[3]),
    });
  }
  return found;
}

// 열쇠 이름으로 숫자의 단위를 정한다. 시간 수·개수·거리·지수는 측정값 검사 대상이 아니다.
const SKIP_KEY =
  /hours|samples|count|elapsed|limit|owners|workers|korean|vietnamese|pending|alerts|distance|^age|^uv|expected|quantity|rated|waiting/i;
const skipped = (key: string) => SKIP_KEY.test(key) || key === 'ms' || key === 'total';
function unitForKey(path: string[]): Unit | null {
  if (path.some(skipped)) return null;
  const joined = path.join('.').toLowerCase();
  if (/temp/.test(joined)) return '°C';
  if (/wind|gale/.test(joined)) return 'm/s';
  if (/rain|mm$/.test(joined)) return 'mm';
  if (/humid|missingrate|percent|share/.test(joined)) return '%';
  return null;
}

/**
 * 도구 결과·기준값에서 근거 숫자를 모은다. 숫자는 열쇠 이름으로 단위를 정하고, 글 속에서는 단위가
 * 붙은 숫자만 꺼낸다 (시각 "13:05", 날짜 "10.09" 는 근거가 되지 않는다). 차이 값은 부호 없이도 받는다
 * ("습도가 20%p 낮아요").
 */
export function addEvidence(evidence: Evidence, value: unknown, path: string[] = []): Evidence {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const unit = unitForKey(path);
    if (unit) {
      evidence[unit].push(value);
      if (path.some((key) => /difference/i.test(key))) evidence[unit].push(Math.abs(value));
    }
  } else if (typeof value === 'string') addTextEvidence(evidence, value);
  else if (Array.isArray(value)) for (const item of value) addEvidence(evidence, item, path);
  else if (typeof value === 'object' && value !== null)
    for (const [key, item] of Object.entries(value)) addEvidence(evidence, item, [...path, key]);
  return evidence;
}

/** 글 속에서 단위가 붙은 숫자만 근거로 더한다. */
export function addTextEvidence(evidence: Evidence, text: string): Evidence {
  for (const { value, unit } of measuredNumbers(text)) evidence[unit].push(value);
  return evidence;
}

/** 사용자가 직접 쓴 숫자는 단위가 없어도 어느 단위로든 되말할 수 있다 ("습도 70이면?"). */
export function addLooseNumbers(evidence: Evidence, text: string): Evidence {
  for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g))
    for (const unit of Object.keys(evidence) as Unit[]) evidence[unit].push(Number(match[0]));
  return evidence;
}

/**
 * 근거에 없는 측정 숫자. 같은 단위의 근거를 답이 쓴 자릿수로 반올림해 같으면 근거가 있는 것으로 본다
 * (72.7% 를 73% 로 쓰는 것은 괜찮고 70% 는 안 된다, 기온 3.2 를 "3.2%" 로 쓰면 안 된다).
 */
export function ungroundedNumbers(text: string, evidence: Evidence): string[] {
  return measuredNumbers(text)
    .filter(({ value, decimals, unit }) => {
      const scale = 10 ** decimals;
      return !evidence[unit].some(
        (candidate) => Math.abs(Math.round(candidate * scale) / scale - value) < 1e-9,
      );
    })
    .map(({ raw }) => raw);
}

/** 품질·식품 안전을 보장하는 말. 시점과 상관없이 막는다 ("안전을 보장하지는 않아요"는 괜찮다). */
export function promisesSafety(text: string): boolean {
  return /안전(?:합니다|해요)|안전을\s*보장(?:합니다|해요|해\s*드려요|할\s*수\s*있)/.test(
    text.replace(/[*_`]/g, ''),
  );
}
