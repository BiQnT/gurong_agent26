import type { AgentAsk, AgentTools } from '../claude-cli.ts';

// 테스트용 가짜 claude. 실제 claude 처럼 서버가 연 도구 서버(MCP)에 tools/call 을 보내고, 정해 둔 답을 돌려준다.

export type ToolResult = { result: unknown; isError: boolean };

export async function callTool(
  tools: AgentTools,
  name: string,
  args: Record<string, unknown> = {},
  token = tools.token,
): Promise<ToolResult & { status: number }> {
  const response = await fetch(tools.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) return { status: response.status, result: null, isError: true };
  const body = (await response.json()) as {
    result?: { content: { text: string }[]; isError?: boolean };
    error?: { message: string };
  };
  if (!body.result) return { status: response.status, result: body.error, isError: true };
  const text = body.result.content[0]?.text ?? '';
  let result: unknown = text;
  try {
    result = JSON.parse(text);
  } catch {
    // 오류 안내는 글 그대로 둔다.
  }
  return { status: response.status, result, isError: body.result.isError === true };
}

/**
 * 도구를 차례로 부른 뒤 답한다. text 를 함수로 주면 도구 결과를 보고 답을 만든다.
 * seen 에 받은 시스템 프롬프트·도구 결과를 남긴다.
 */
export function toolAsk(
  calls: [string, Record<string, unknown>?][],
  text: string | ((results: ToolResult[]) => string),
  seen: { system?: string; results?: ToolResult[]; tools?: AgentTools } = {},
): AgentAsk {
  return async ({ system, tools }) => {
    seen.system = system;
    seen.tools = tools;
    const results: ToolResult[] = [];
    if (calls.length && !tools) throw new Error('도구 서버가 없다');
    for (const [name, args] of calls) results.push(await callTool(tools!, name, args ?? {}));
    seen.results = results;
    return { text: typeof text === 'function' ? text(results) : text, costUsd: 0 };
  };
}

/** 도구가 없는 제공자(OpenAI 호환)에 간 시스템 프롬프트의 CONTEXT JSON (마지막 줄). */
export function contextOf(system: string): Record<string, Record<string, unknown> | null> {
  return JSON.parse(system.trim().split('\n').at(-1)!);
}
