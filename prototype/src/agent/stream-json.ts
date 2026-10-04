// `claude -p --output-format stream-json --verbose --include-partial-messages` 의
// 한 줄(JSON)을 우리가 쓰는 이벤트로 바꾼다. 쓰지 않는 줄(rate_limit_event, thinking 등)은 버린다.

export type AgentEvent =
  | { type: 'init'; sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_end'; id: string; isError: boolean }
  | {
      type: 'result';
      sessionId: string;
      text: string;
      isError: boolean;
      subtype?: string;
      costUsd?: number;
      durationMs?: number;
    };

type ContentBlock = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean };

type Line = {
  type?: string;
  subtype?: string;
  session_id?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  message?: { content?: ContentBlock[] | string };
  result?: unknown;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  parent_tool_use_id?: string | null;
};

function blocks(line: Line): ContentBlock[] {
  return Array.isArray(line.message?.content) ? line.message.content : [];
}

export function parseStreamJsonLine(raw: string): AgentEvent[] {
  const text = raw.trim();
  if (!text) return [];
  let line: Line;
  try {
    line = JSON.parse(text) as Line;
  } catch {
    return [];
  }
  // 서브에이전트 메시지는 쓰지 않는다 (--tools "" 라 원래 나오지 않는다).
  if (line.parent_tool_use_id) return [];

  switch (line.type) {
    case 'system':
      return line.subtype === 'init' && line.session_id ? [{ type: 'init', sessionId: line.session_id }] : [];
    case 'stream_event': {
      const { event } = line;
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        return [{ type: 'text_delta', text: event.delta.text }];
      }
      return [];
    }
    case 'assistant':
      return blocks(line)
        .filter((block) => block.type === 'tool_use' && block.id && block.name)
        .map((block) => ({ type: 'tool_start', id: block.id!, name: block.name!, input: block.input }));
    case 'user':
      return blocks(line)
        .filter((block) => block.type === 'tool_result' && block.tool_use_id)
        .map((block) => ({ type: 'tool_end', id: block.tool_use_id!, isError: block.is_error === true }));
    case 'result':
      return [
        {
          type: 'result',
          sessionId: line.session_id ?? '',
          text: typeof line.result === 'string' ? line.result : '',
          isError: line.is_error === true,
          subtype: line.subtype,
          costUsd: line.total_cost_usd,
          durationMs: line.duration_ms,
        },
      ];
    default:
      return [];
  }
}
