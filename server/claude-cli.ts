import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';

// 채팅 설명을 claude CLI(`claude -p`)로 만든다. 메시지 하나 = 프로세스 하나.
// 내장 도구(Bash·Read 등)는 모두 끄고, 서버가 루프백으로 여는 읽기 전용 도구(server/tool-server.ts)만 허용한다.
// claude 는 어떤 자료를 볼지 고르고 설명만 쓴다. 숫자와 등급은 도구(코드)가 계산한다 (ADR 0011).
// 다른 CLI 에이전트(codex 등)를 붙일 때도 같은 모양(AgentAsk)으로 만든다.

export type AgentMessage = { role: 'user' | 'assistant'; content: string };
/** 이 요청에서 쓸 수 있는 도구 서버 (MCP Streamable HTTP). 토큰은 환경변수로만 넘긴다. */
export type AgentTools = { url: string; token: string };
export type AgentAsk = (input: {
  system: string;
  history: AgentMessage[];
  message: string;
  signal: AbortSignal;
  tools?: AgentTools;
}) => Promise<{ text: string; costUsd?: number }>;

/** MCP 서버 이름. claude 안에서 도구는 `mcp__haepung__<도구>` 로 보인다. */
export const TOOL_SERVER_NAME = 'haepung';
/** 도구 토큰을 담는 환경변수. 인자로 넘기면 같은 VM 의 프로세스 목록(ps)에 보인다. */
export const TOOL_TOKEN_ENV = 'HAEPUNG_TOOL_TOKEN';

export type ClaudeConfig = {
  bin: string;
  workdir: string;
  /** subscription: 로그인·토큰 사용. api_key: --bare 로 ANTHROPIC_API_KEY 만 사용 */
  authMode: 'subscription' | 'api_key';
  model?: string;
  effort?: string;
  maxBudgetUsd: number;
  /** 최근 24시간 비용 합계 상한 (DATABASE_PATH 가 있을 때만 센다) */
  dailyBudgetUsd: number;
  timeoutMs: number;
  maxConcurrency: number;
  /** SIGTERM 뒤 강제 종료(SIGKILL)까지 기다리는 시간. 기본 5000 (테스트에서만 줄인다) */
  killGraceMs?: number;
};

export type ClaudeFailure = 'busy' | 'auth' | 'limit' | 'timeout' | 'aborted' | 'failed';

export class ClaudeCliError extends Error {
  kind: ClaudeFailure;
  /** claude 가 실패 결과에 비용을 실어 보낸 경우 (예: 메시지당 상한 초과) */
  costUsd?: number;
  constructor(kind: ClaudeFailure, message: string, costUsd?: number) {
    super(message);
    this.name = 'ClaudeCliError';
    this.kind = kind;
    this.costUsd = costUsd;
  }
}

export function buildClaudeArgs(
  config: ClaudeConfig,
  system: string,
  tools?: Pick<AgentTools, 'url'>,
): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    // 공개 서버라 내장 도구(Bash·Read·Write·WebFetch 등)를 모두 끈다.
    '--tools',
    '',
    // 서버 계정에 설정된 MCP 는 읽지 않는다. 아래 --mcp-config 로 준 우리 도구 서버만 쓴다.
    '--strict-mcp-config',
    // 채팅으로 /model, /config 같은 Claude Code 명령이 실행되지 않게 한다.
    '--disable-slash-commands',
    // 서버 계정의 ~/.claude 설정·플러그인·훅·CLAUDE.md 를 읽지 않는다.
    '--setting-sources',
    '',
    // 대화 기록은 화면이 history 로 보내므로 claude 쪽에 세션을 남기지 않는다.
    '--no-session-persistence',
    '--system-prompt',
    system,
    '--max-budget-usd',
    String(config.maxBudgetUsd),
  ];
  if (config.authMode === 'api_key') args.push('--bare');
  if (config.model) args.push('--model', config.model);
  if (config.effort) args.push('--effort', config.effort);
  if (tools) {
    const mcp = {
      mcpServers: {
        [TOOL_SERVER_NAME]: {
          type: 'http',
          url: tools.url,
          // claude 가 자식 환경변수에서 풀어 쓴다.
          headers: { Authorization: `Bearer \${${TOOL_TOKEN_ENV}}` },
        },
      },
    };
    // 이 서버의 도구만 묻지 않고 쓰게 한다 (-p 에서는 허용되지 않은 도구가 거절된다).
    args.push('--mcp-config', JSON.stringify(mcp), '--allowedTools', `mcp__${TOOL_SERVER_NAME}`);
  }
  return args;
}

const PASS_THROUGH = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
  'CLAUDE_CONFIG_DIR',
];

/** claude 에 넘길 환경변수만 고른다. 서버의 다른 비밀값(E-UM 키 등)은 넘기지 않는다. */
export function claudeEnv(
  config: ClaudeConfig,
  source: NodeJS.ProcessEnv = process.env,
  toolToken?: string,
): Record<string, string> {
  const env: Record<string, string> = {
    DISABLE_AUTOUPDATER: '1',
    // 작업 폴더가 하나라 자동 메모리가 켜져 있으면 한 사람의 대화가 다른 대화에 섞일 수 있다.
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };
  const auth = config.authMode === 'api_key' ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN';
  for (const name of [...PASS_THROUGH, auth]) {
    const value = source[name];
    if (value) env[name] = value;
  }
  if (toolToken) env[TOOL_TOKEN_ENV] = toolToken;
  return env;
}

/**
 * claude -p 는 한 번에 질문 하나만 받으므로 이전 대화를 글로 이어 붙인다.
 * 첫 질문도 감싼다. '/'로 시작하는 입력은 --disable-slash-commands 를 줘도 CLI 가 명령으로 가로챈다.
 */
export function buildPrompt(history: AgentMessage[], message: string): string {
  if (!history.length) return `지금 질문:\n${message}`;
  const lines = history.map(
    (entry) => `[${entry.role === 'user' ? '사용자' : '도우미'}] ${entry.content}`,
  );
  return `이전 대화:\n${lines.join('\n')}\n\n지금 질문:\n${message}`;
}

type ResultLine = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  errors?: unknown;
  total_cost_usd?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 실패 사유 글에서 인증·한도 문제를 가려 낸다. 나머지는 failed. */
function classifyFailure(reason: string, subtype?: string, costUsd?: number): ClaudeCliError {
  const text = reason.trim().slice(0, 500);
  // 로그인 안 됨·잘못된 키는 subtype 이 'success' 로 올 때도 있어 문구로 가른다.
  if (/not logged in|\/login|invalid api key|authentication|unauthorized|oauth/i.test(text))
    return new ClaudeCliError('auth', text, costUsd);
  if (
    subtype === 'error_max_budget_usd' ||
    /rate limit|usage limit|quota|credit balance|too many requests/i.test(text)
  )
    return new ClaudeCliError('limit', text || 'budget', costUsd);
  return new ClaudeCliError('failed', text || subtype || 'error', costUsd);
}

/** `--output-format json` 의 결과 한 덩어리를 해석한다. */
export function readClaudeResult(stdout: string): { text: string; costUsd?: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    // 오래된 버전은 인증 오류를 JSON 없이 글로만 내보낸다.
    const failure = classifyFailure(stdout);
    throw new ClaudeCliError(failure.kind, `claude 출력이 JSON 이 아니다: ${failure.message}`);
  }
  // 버전에 따라 결과 하나(객체) 또는 메시지 목록(배열)으로 온다. 마지막 result 를 쓴다.
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const line = [...entries]
    .reverse()
    .find((entry) => isRecord(entry) && entry.type === 'result') as ResultLine | undefined;
  if (!line) throw classifyFailure(`claude 결과 항목이 없다: ${stdout}`);
  const costUsd =
    typeof line.total_cost_usd === 'number' && Number.isFinite(line.total_cost_usd)
      ? line.total_cost_usd
      : undefined;
  const reason =
    typeof line.result === 'string'
      ? line.result
      : Array.isArray(line.errors)
        ? line.errors.filter((e): e is string => typeof e === 'string').join('; ')
        : '';
  if (line.is_error === true || (line.subtype !== undefined && line.subtype !== 'success'))
    throw classifyFailure(reason, line.subtype, costUsd);
  return { text: reason.trim(), costUsd };
}

let running = 0;

export function createClaudeAgent(config: ClaudeConfig): AgentAsk {
  return async ({ system, history, message, signal, tools }) => {
    signal.throwIfAborted();
    if (running >= config.maxConcurrency)
      throw new ClaudeCliError('busy', `동시에 ${config.maxConcurrency}개까지만 처리한다`);
    running++;
    try {
      let child: ChildProcessWithoutNullStreams;
      try {
        mkdirSync(config.workdir, { recursive: true });
        // cwd 는 빈 작업 폴더다. 저장소 안에서 띄우면 저장소의 CLAUDE.md 를 읽어 버린다.
        // detached: 자식이 만든 하위 프로세스까지 프로세스 그룹으로 한꺼번에 끝내려는 것이다.
        child = spawn(config.bin, buildClaudeArgs(config, system, tools), {
          cwd: config.workdir,
          env: claudeEnv(config, process.env, tools?.token) as NodeJS.ProcessEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        });
      } catch (error) {
        throw new ClaudeCliError(
          'failed',
          `claude 를 실행하지 못했다: ${(error as Error).message}`,
        );
      }
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let closed = false;
      let forceKill: NodeJS.Timeout | undefined;
      const send = (name: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, name);
          else child.kill(name);
        } catch {
          child.kill(name);
        }
      };
      const terminate = () => {
        if (closed || forceKill) return;
        send('SIGTERM');
        // SIGTERM 을 무시하면 동시 실행 자리를 계속 차지하므로 잠시 뒤 강제 종료한다.
        forceKill = setTimeout(() => send('SIGKILL'), config.killGraceMs ?? 5000);
        forceKill.unref();
      };
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, config.timeoutMs);
      signal.addEventListener('abort', terminate, { once: true });
      // 프롬프트는 stdin 으로 넘긴다. 인자로 넘기면 '-'로 시작하는 메시지가 옵션으로 해석된다.
      child.stdin.on('error', () => undefined);
      child.stdin.end(buildPrompt(history, message));
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', (exitCode) => {
            closed = true;
            resolve(exitCode);
          });
        });
        if (timedOut) throw new ClaudeCliError('timeout', `${config.timeoutMs}ms 시간 초과`);
        if (signal.aborted) throw new ClaudeCliError('aborted', '요청 취소');
        if (!stdout.trim())
          throw classifyFailure(`claude 가 결과 없이 끝났다 (exit ${code}) ${stderr}`);
        return readClaudeResult(stdout);
      } catch (error) {
        if (error instanceof ClaudeCliError) throw error;
        throw new ClaudeCliError(
          'failed',
          `claude 를 실행하지 못했다: ${(error as Error).message}`,
        );
      } finally {
        clearTimeout(timer);
        clearTimeout(forceKill);
        signal.removeEventListener('abort', terminate);
        // 정상 종료가 아닌 경로(실행 실패 등)에서 남은 프로세스를 정리한다.
        if (!closed) send('SIGKILL');
      }
    } finally {
      running--;
    }
  };
}
