import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStreamJsonLine, type AgentEvent } from '../src/agent/stream-json.ts';

// fixture 는 2026-10-04 claude 2.1.289 의 실제 출력이다 (자외선 지수 질문 → INT_S06_005 호출 → 가짜 키라 401).
const lines = readFileSync(new URL('./fixtures/claude-stream-tool-call.jsonl', import.meta.url), 'utf8').split('\n');
const events: AgentEvent[] = lines.flatMap(parseStreamJsonLine);

describe('parseStreamJsonLine', () => {
  it('init 에서 세션 id 를 꺼낸다', () => {
    expect(events[0]).toEqual({ type: 'init', sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  it('도구 호출 시작과 끝을 같은 id 로 짝짓는다', () => {
    const start = events.find((e) => e.type === 'tool_start');
    const end = events.find((e) => e.type === 'tool_end');
    expect(start).toMatchObject({ name: 'mcp__eum__INT_S06_005', input: {} });
    expect(end).toMatchObject({ isError: true });
    expect(start && 'id' in start && end && 'id' in end && start.id === end.id).toBe(true);
  });

  it('텍스트 조각을 모으면 최종 결과와 같다', () => {
    const streamed = events.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');
    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({ isError: false, subtype: 'success' });
    expect(result && result.type === 'result' && result.text).toBe(streamed);
    expect(result && result.type === 'result' && result.costUsd).toBeGreaterThan(0);
  });

  it('JSON 이 아니거나 모르는 줄은 버린다', () => {
    expect(parseStreamJsonLine('')).toEqual([]);
    expect(parseStreamJsonLine('not json')).toEqual([]);
    expect(parseStreamJsonLine('{"type":"rate_limit_event"}')).toEqual([]);
  });
});
