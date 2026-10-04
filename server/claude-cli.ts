import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

// 채팅 설명을 claude CLI(`claude -p`)로 만든다. 메시지 하나 = 프로세스 하나.
// 서버가 확보한 관측 근거를 시스템 프롬프트로 넘기고, claude 는 도구 없이 설명만 쓴다.
// 다른 CLI 에이전트(codex 등)를 붙일 때도 같은 모양(AgentAsk)으로 만든다.

export type AgentMessage = { role: 'user' | 'assistant'; content: string };
export type AgentAsk = (input: {
  system: string;
  history: AgentMessage[];
  message: string;
  signal: AbortSignal;
}) => Promise<{ text: string; costUsd?: number }>;

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
};

export type ClaudeFailure = 'busy' | 'auth' | 'limit' | 'timeout' | 'aborted' | 'failed';

export class ClaudeCliError extends Error {
  kind: ClaudeFailure;
  constructor(kind: ClaudeFailure, message: string) {
    super(message);
    this.name = 'ClaudeCliError';
    this.kind = kind;
  }
}

export function buildClaudeArgs(config: ClaudeConfig, system: string): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    // 공개 서버라 내장 도구(Bash·Read·Write·WebFetch 등)와 MCP 를 모두 끈다.
    '--tools',
    '',
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
  return env;
}

/** claude -p 는 한 번에 질문 하나만 받으므로 이전 대화를 글로 이어 붙인다. */
export function buildPrompt(history: AgentMessage[], message: string): string {
  if (!history.length) return message;
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
  total_cost_usd?: number;
};

/** `--output-format json` 의 결과 한 덩어리를 해석한다. */
export function readClaudeResult(stdout: string): { text: string; costUsd?: number } {
  let parsed: ResultLine;
  try {
    parsed = JSON.parse(stdout.trim()) as ResultLine;
  } catch {
    throw new ClaudeCliError('failed', 'claude 출력이 JSON 이 아니다');
  }
  const reason =
    typeof parsed.result === 'string'
      ? parsed.result
      : Array.isArray(parsed.errors)
        ? parsed.errors.filter((e): e is string => typeof e === 'string').join('; ')
        : '';
  if (parsed.type !== 'result' || parsed.is_error) {
    // 로그인 안 됨·잘못된 키는 subtype 이 'success' 로 올 때도 있어 문구로 가른다.
    if (/not logged in|invalid api key|authentication|unauthorized|oauth/i.test(reason))
      throw new ClaudeCliError('auth', reason);
    if (parsed.subtype === 'error_max_budget_usd' || /rate limit|usage limit|quota/i.test(reason))
      throw new ClaudeCliError('limit', reason || 'budget');
    throw new ClaudeCliError('failed', reason || parsed.subtype || 'error');
  }
  return { text: reason.trim(), costUsd: parsed.total_cost_usd };
}

let running = 0;

export function createClaudeAgent(config: ClaudeConfig): AgentAsk {
  return async ({ system, history, message, signal }) => {
    signal.throwIfAborted();
    if (running >= config.maxConcurrency)
      throw new ClaudeCliError('busy', `동시에 ${config.maxConcurrency}개까지만 처리한다`);
    running++;
    try {
      mkdirSync(config.workdir, { recursive: true });
      // cwd 는 빈 작업 폴더다. 저장소 안에서 띄우면 저장소의 CLAUDE.md 를 읽어 버린다.
      const child = spawn(config.bin, buildClaudeArgs(config, system), {
        cwd: config.workdir,
        env: claudeEnv(config) as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      let timedOut = false;
      let forceKill: NodeJS.Timeout | undefined;
      const kill = () => {
        if (child.exitCode !== null || child.signalCode !== null || forceKill) return;
        child.kill('SIGTERM');
        // SIGTERM 을 무시하면 동시 실행 자리를 계속 차지하므로 5초 뒤 강제 종료한다.
        forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
        forceKill.unref();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, config.timeoutMs);
      signal.addEventListener('abort', kill, { once: true });
      if (signal.aborted) kill();
      // 프롬프트는 stdin 으로 넘긴다. 인자로 넘기면 '-'로 시작하는 메시지가 옵션으로 해석된다.
      child.stdin.on('error', () => undefined);
      child.stdin.end(buildPrompt(history, message));
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
        });
        if (timedOut) throw new ClaudeCliError('timeout', `${config.timeoutMs}ms 시간 초과`);
        if (signal.aborted) throw new ClaudeCliError('aborted', '요청 취소');
        if (!stdout.trim())
          throw new ClaudeCliError('failed', `claude 가 결과 없이 끝났다 (exit ${code}) ${stderr}`);
        return readClaudeResult(stdout);
      } catch (error) {
        if (error instanceof ClaudeCliError) throw error;
        throw new ClaudeCliError(
          'failed',
          `claude 를 실행하지 못했다: ${(error as Error).message}`,
        );
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', kill);
        kill();
      }
    } finally {
      running--;
    }
  };
}
