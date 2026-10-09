import { readFileSync } from 'node:fs';

// AI 도우미의 기본 지시는 server/prompts/*.md 에 둔다 (PR 로 리뷰하려고 코드와 나눴다, ADR 0011).
// 서버가 시작할 때 한 번 읽는다. 파일이 없으면 서버가 뜨지 않게 바로 던진다.

const read = (name: string) =>
  readFileSync(new URL(`./prompts/${name}`, import.meta.url), 'utf8').trim();

export const PROMPTS = {
  persona: read('persona.md'),
  rules: read('rules.md'),
  tools: read('tools.md'),
  fields: read('fields.md'),
  gwamegi: read('gwamegi.md'),
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 지금 시각을 `2026-10-09 (금) 13:20 KST` 로. 모델이 "어제", "지난주"를 풀 때 쓴다. */
export function nowLine(now: number): string {
  const shifted = new Date(now + 9 * 60 * 60 * 1000);
  const iso = shifted.toISOString();
  return `${iso.slice(0, 10)} (${WEEKDAYS[shifted.getUTCDay()]}) ${iso.slice(11, 16)} KST`;
}

export type PromptRuntime = { now: number; siteName: string; siteRegistered: boolean };

function runtimeBlock({ now, siteName, siteRegistered }: PromptRuntime): string {
  return [
    '# 지금',
    `- 지금 시각: ${nowLine(now)}`,
    `- 덕장: ${siteName}${siteRegistered ? '' : ' (위치 미등록)'}`,
  ].join('\n');
}

/** claude 처럼 도구를 쓰는 제공자의 시스템 프롬프트. */
export function toolSystemPrompt(runtime: PromptRuntime): string {
  return [
    PROMPTS.persona,
    PROMPTS.rules,
    PROMPTS.tools,
    PROMPTS.fields,
    PROMPTS.gwamegi,
    runtimeBlock(runtime),
  ].join('\n\n');
}

/**
 * 도구가 없는 제공자(OpenAI 호환)의 시스템 프롬프트. 도구 대신 서버가 미리 고른 자료(CONTEXT)를 붙인다.
 * 도구 이름이 나오는 tools.md 는 넣지 않는다.
 */
export function contextSystemPrompt(runtime: PromptRuntime, context: unknown): string {
  return [
    PROMPTS.persona,
    PROMPTS.rules,
    PROMPTS.fields,
    PROMPTS.gwamegi,
    runtimeBlock(runtime),
    [
      '# CONTEXT',
      '이 연결에는 도구가 없습니다. 규칙의 "도구 결과"는 아래 CONTEXT 로 읽습니다.',
      'current 는 get_current_conditions, site 는 get_site_overview, batches 는 get_batches, forecast 는 get_forecast_outlook 의 결과와 같습니다 (current 를 이미 부른 것으로 칩니다).',
      '과거 기간 자료는 이 연결에서 조회할 수 없으니, 과거 분석을 부탁받으면 지금은 할 수 없다고 말합니다.',
      JSON.stringify(context),
    ].join('\n'),
  ].join('\n\n');
}

/** 숫자 검사에서 허용할 숫자의 출처 (지시문에 적힌 기준·상식 수치). */
export const PROMPT_TEXT = Object.values(PROMPTS).join('\n');
