import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Config } from '../config.ts';
import { parseStreamJsonLine, type AgentEvent } from './stream-json.ts';

// 사용자 메시지 하나 = `claude -p` 프로세스 하나.
// 같은 명령을 터미널에서 그대로 재현할 수 있게 인자를 한곳(buildClaudeArgs)에서 만든다.

type AgentConfig = Config['agent'];

export class ClaudeCliError extends Error {
  readonly stderr: string;
  readonly reason: 'spawn' | 'timeout' | 'aborted' | 'exit';
  constructor(message: string, stderr: string, reason: ClaudeCliError['reason']) {
    super(message);
    this.name = 'ClaudeCliError';
    this.stderr = stderr;
    this.reason = reason;
  }
}

export function mcpConfigJson(agent: AgentConfig, eumCatalogPath: string): string {
  return JSON.stringify({
    mcpServers: {
      eum: {
        type: 'stdio',
        command: process.execPath,
        args: [agent.mcpServerPath],
        // EUM_SERVICE_KEY 는 여기 넣지 않는다. 인자로 넘기면 ps 에 보인다. claude 의 환경변수를 MCP 서버가 물려받는다.
        env: { EUM_CATALOG_PATH: eumCatalogPath },
      },
    },
  });
}

export function buildClaudeArgs(agent: AgentConfig, mcpConfig: string, resumeSessionId?: string): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    // 공개 엔드포인트라 내장 도구(Bash·Read·Write·WebFetch 등)는 전부 끈다. 쓸 수 있는 건 E-UM MCP 도구뿐이다.
    '--tools', '',
    '--strict-mcp-config',
    '--mcp-config', mcpConfig,
    '--allowedTools', 'mcp__eum__*',
    // 허용 목록 밖의 도구는 묻지 않고 거부한다.
    '--permission-mode', 'dontAsk',
    // 서버 사용자의 ~/.claude 설정·플러그인·훅·CLAUDE.md 를 읽지 않는다. 개발자가 같은 계정으로 Claude Code 를 써도 섞이지 않는다.
    '--setting-sources', '',
    // 채팅으로 /model, /config 같은 Claude Code 명령을 보내도 실행되지 않게 한다.
    '--disable-slash-commands',
    '--system-prompt-file', agent.systemPromptPath,
    // 프롬프트를 고치면 이어지는 대화에도 다음 메시지부터 반영한다 (기본은 첫 턴의 프롬프트를 고정).
    '--system-prompt-snapshot', 'off',
    // 대화 기록(세션 파일)을 30일 뒤 지우는 기본 정리를 끈다. 지워지면 --resume 이 실패한다.
    '--settings', JSON.stringify({ cleanupPeriodDays: 3650 }),
    '--max-budget-usd', String(agent.maxBudgetUsd),
  ];
  // API 키 모드는 --bare: OAuth·키체인을 아예 읽지 않고 ANTHROPIC_API_KEY 만 쓴다.
  if (agent.authMode === 'api_key') args.push('--bare');
  if (agent.model) args.push('--model', agent.model);
  if (agent.effort) args.push('--effort', agent.effort);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  return args;
}

// claude 에 넘기는 환경변수는 필요한 것만 고른다.
const PASS_THROUGH = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'EUM_SERVICE_KEY'];

export function childEnv(agent: AgentConfig, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  // 자동 메모리를 끈다. 작업 폴더가 하나라 켜져 있으면 한 사람의 대화 내용이 다른 대화에 섞일 수 있다.
  const env: Record<string, string> = { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
  const names = [...PASS_THROUGH, agent.authMode === 'api_key' ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN'];
  for (const name of names) {
    const value = source[name];
    if (value) env[name] = value;
  }
  return env;
}

export type RunOptions = {
  prompt: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
};

export async function* runClaude(config: Config, options: RunOptions): AsyncGenerator<AgentEvent> {
  const { agent } = config;
  mkdirSync(agent.workdir, { recursive: true });
  // cwd 는 빈 작업 폴더다. 저장소 안에서 띄우면 저장소의 CLAUDE.md 를 읽어 버린다.
  const child = spawn(
    agent.claudeBin,
    buildClaudeArgs(agent, mcpConfigJson(agent, config.eumCatalogPath), options.resumeSessionId),
    { cwd: agent.workdir, env: childEnv(agent) as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve));

  let timedOut = false;
  let forceKill: NodeJS.Timeout | undefined;
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null || forceKill) return;
    child.kill('SIGTERM');
    // SIGTERM 을 무시하면 잠금과 동시 실행 자리를 계속 잡고 있으므로 5초 뒤 강제 종료한다.
    forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
    forceKill.unref();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, agent.timeoutMs);
  options.signal?.addEventListener('abort', kill, { once: true });
  if (options.signal?.aborted) kill();

  // 프롬프트는 stdin 으로 넘긴다. 인자로 넘기면 '-'로 시작하는 메시지가 옵션으로 해석된다.
  child.stdin.on('error', () => {});
  child.stdin.end(options.prompt);

  let sawResult = false;
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      for (const event of parseStreamJsonLine(line)) {
        if (event.type === 'result') sawResult = true;
        yield event;
      }
    }
    const code = await exited;
    if (spawnError) throw new ClaudeCliError(`claude CLI 를 실행하지 못했다: ${spawnError.message}`, stderr, 'spawn');
    if (!sawResult) {
      if (timedOut) throw new ClaudeCliError(`claude CLI 가 결과 없이 끝났다 (${agent.timeoutMs}ms 시간 초과)`, stderr, 'timeout');
      if (options.signal?.aborted) throw new ClaudeCliError('claude CLI 가 결과 없이 끝났다 (요청 취소)', stderr, 'aborted');
      throw new ClaudeCliError(`claude CLI 가 결과 없이 끝났다 (exit ${code})`, stderr, 'exit');
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', kill);
    // 소비가 중간에 끝나면 stdout 을 비워 줘야 claude 가 파이프에 막히지 않고 종료된다.
    child.stdout.resume();
    kill();
  }
}
