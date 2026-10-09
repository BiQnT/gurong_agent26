import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// AI(claude CLI)가 부르는 읽기 전용 도구를 MCP(Streamable HTTP, JSON 응답만)로 내준다. 결정: ADR 0011
//
// - 127.0.0.1 의 임의 포트에만 연다. Caddy 가 넘기는 공개 포트와 다르다.
// - 채팅 요청 하나 = 세션 하나. 세션마다 일회용 토큰을 만들고, 그 덕장의 도구만 묶는다.
//   요청이 끝나면 세션을 지워 토큰이 더는 통하지 않는다.
// - 도구는 서버가 미리 정한 함수뿐이고 결과는 코드가 계산한다. AI 는 무엇을 부를지만 고른다.
// - 쓰는 메서드는 initialize, tools/list, tools/call, ping 뿐이라 SDK 없이 직접 처리한다.

/** 도구 결과. content 는 AI 에게 가고, card 는 화면 카드 자료로 서버에만 남는다. */
export type ToolOutput = { content: unknown; card?: unknown };

export type ToolDefinition = {
  name: string;
  /** AI 에게 보이는 설명. 언제 부르는지 적는다 */
  description: string;
  /** 입력 JSON Schema (type: object) */
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<ToolOutput>;
};

/** AI 에게 그대로 보여도 되는 안내 (입력 오류, 자료 없음). 다른 오류의 글은 AI 에게 넘기지 않는다. */
export class ToolNotice extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolNotice';
  }
}

export type ToolCall = {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  /** 성공했을 때 AI 에게 간 결과 (숫자 검사에 쓴다) */
  result?: unknown;
  /** 성공했을 때의 화면 카드 자료 */
  card?: unknown;
  error?: string;
  ms: number;
};

export type ToolSession = {
  /** claude 에 넘길 MCP 주소 */
  url: string;
  token: string;
  /** 이 세션에서 실제로 실행된 도구 호출 (순서대로) */
  calls: ToolCall[];
  close: () => void;
};

type Session = {
  tools: Map<string, ToolDefinition>;
  calls: ToolCall[];
  /** 실행 중인 도구 수 (상한 계산용) */
  running: number;
  signal: AbortSignal;
  expiresAt: number;
};

const SERVER_NAME = 'haepung';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 65536;
/** 질문 하나에 도구를 이보다 많이 부르면 멈춘다 (시간·비용 상한) */
export const MAX_CALLS_PER_SESSION = 8;
/** 도구 하나의 결과 글 상한. 넘으면 도구 쪽에서 줄여야 한다 */
const MAX_RESULT_CHARS = 24000;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type RpcReply = { jsonrpc: '2.0'; id: unknown } & (
  { result: unknown } | { error: { code: number; message: string } }
);

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      length += chunk.byteLength;
      if (length > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

export function createToolServer(now: () => number = Date.now) {
  const sessions = new Map<string, Session>();
  let server: Server | undefined;
  let listening: Promise<string> | undefined;

  async function handle(session: Session, message: RpcRequest): Promise<RpcReply | null> {
    const id = message.id ?? null;
    const reply = (result: unknown): RpcReply => ({ jsonrpc: '2.0', id, result });
    const failure = (code: number, text: string): RpcReply => ({
      jsonrpc: '2.0',
      id,
      error: { code, message: text },
    });
    // id 가 없으면 알림이라 답하지 않는다 (notifications/initialized 등).
    if (message.id === undefined) return null;
    const params = object(message.params) ? message.params : {};
    switch (message.method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        return reply({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: '1.0.0' },
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({
          tools: [...session.tools.values()].map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      case 'tools/call': {
        const tool = typeof params.name === 'string' ? session.tools.get(params.name) : undefined;
        if (!tool) return failure(-32602, '없는 도구예요.');
        const input = object(params.arguments) ? params.arguments : {};
        const toolError = (text: string) =>
          reply({ content: [{ type: 'text', text }], isError: true });
        // 한 번에 여러 도구를 불러도 상한을 넘지 않게, 기다리기 전에 자리를 먼저 잡는다.
        if (session.calls.length + session.running >= MAX_CALLS_PER_SESSION)
          return toolError(
            '이 질문에서 부를 수 있는 도구 횟수를 넘었어요. 가진 자료로 답해 주세요.',
          );
        session.running += 1;
        const startedAt = now();
        const record = (call: Omit<ToolCall, 'name' | 'input' | 'ms'>) =>
          session.calls.push({ name: tool.name, input, ms: now() - startedAt, ...call });
        try {
          const { content, card } = await tool.run(input, session.signal);
          const text = JSON.stringify(content);
          if (text.length > MAX_RESULT_CHARS)
            throw new ToolNotice('결과가 너무 길어요. 기간을 줄여 주세요.');
          record({ ok: true, result: content, ...(card === undefined ? {} : { card }) });
          return reply({ content: [{ type: 'text', text }] });
        } catch (error) {
          // 서버가 만든 안내문(ToolNotice)만 AI 에게 넘긴다. 저장소·원천 오류 글은 넘기지 않는다.
          const text =
            error instanceof ToolNotice ? error.message.slice(0, 300) : '자료를 읽지 못했어요.';
          record({ ok: false, error: text });
          return toolError(text);
        } finally {
          session.running -= 1;
        }
      }
      default:
        return failure(-32601, '지원하지 않는 메서드예요.');
    }
  }

  async function serve(request: IncomingMessage, response: ServerResponse) {
    const send = (status: number, body?: unknown) => {
      response.statusCode = status;
      if (body === undefined) {
        response.end();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(body));
    };
    const token = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(request.headers.authorization ?? '')?.[1];
    const session = token ? sessions.get(digest(token)) : undefined;
    if (!session || session.expiresAt <= now() || session.signal.aborted) {
      send(401, { error: 'unauthorized' });
      return;
    }
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/mcp') {
      send(404, { error: 'not found' });
      return;
    }
    // 서버가 먼저 보내는 알림 스트림(GET)과 세션 종료(DELETE)는 쓰지 않는다.
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      send(405, { error: 'method not allowed' });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(request));
    } catch {
      send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const replies: RpcReply[] = [];
    for (const message of messages) {
      if (!object(message)) continue;
      const answer = await handle(session, message);
      if (answer) replies.push(answer);
    }
    if (!replies.length) send(202);
    else send(200, Array.isArray(parsed) ? replies : replies[0]);
  }

  function listen(): Promise<string> {
    listening ??= new Promise<string>((resolve, reject) => {
      server = createServer((request, response) => {
        serve(request, response).catch(() => {
          if (!response.headersSent) {
            response.statusCode = 500;
            response.end();
          }
        });
      });
      const created = server;
      created.once('error', reject);
      created.listen(0, '127.0.0.1', () => {
        created.off('error', reject);
        // 연 뒤의 오류로 프로세스가 죽지 않게 남기기만 한다.
        created.on('error', (error) => console.error(`[tool-server] ${error.message}`));
        // 이 서버 때문에 프로세스가 끝나지 못하는 일이 없게 한다.
        created.unref();
        resolve(`http://127.0.0.1:${(created.address() as AddressInfo).port}/mcp`);
      });
    });
    // 열지 못했으면 다음 채팅에서 다시 연다 (실패를 붙잡아 두지 않는다).
    listening.catch(() => {
      listening = undefined;
    });
    return listening;
  }

  return {
    /** 채팅 요청 하나를 위한 세션을 연다. 끝나면 꼭 close 한다. */
    async open(tools: ToolDefinition[], signal: AbortSignal, ttlMs: number): Promise<ToolSession> {
      const url = await listen();
      const token = randomBytes(32).toString('base64url');
      const key = digest(token);
      const session: Session = {
        tools: new Map(tools.map((tool) => [tool.name, tool])),
        calls: [],
        running: 0,
        signal,
        expiresAt: now() + ttlMs,
      };
      sessions.set(key, session);
      // 끝난 세션이 남지 않게 만료된 것을 같이 치운다.
      for (const [other, value] of sessions)
        if (value.expiresAt <= now() || value.signal.aborted) sessions.delete(other);
      return { url, token, calls: session.calls, close: () => sessions.delete(key) };
    },
    /** 열린 세션 수 (테스트용) */
    size: () => sessions.size,
    close: () => server?.close(),
  };
}

export type ToolServer = ReturnType<typeof createToolServer>;
