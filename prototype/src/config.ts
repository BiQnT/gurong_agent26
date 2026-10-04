import path from 'node:path';

// 모든 경로 기본값은 prototype/ 를 작업 디렉터리로 가정한다 (next dev/start, npm 스크립트 모두 그렇다).
// VM 에서는 systemd 유닛(infra/gcp/systemd/)이 공유 경로를 환경변수로 넘긴다.

export type AuthMode = 'subscription' | 'api_key';

export type Config = {
  appEnv: string;
  databasePath: string;
  migrationsDir: string;
  eumCatalogPath: string;
  gitCommit?: string;
  agent: {
    claudeBin: string;
    workdir: string;
    systemPromptPath: string;
    mcpServerPath: string;
    authMode: AuthMode;
    model?: string;
    effort?: string;
    maxBudgetUsd: number;
    timeoutMs: number;
    maxConcurrency: number;
  };
};

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached) return cached;
  const env = process.env;
  const root = process.cwd();
  const dataDir = path.join(root, '.data');

  const authMode = env.AGENT_AUTH_MODE ?? 'subscription';
  if (authMode !== 'subscription' && authMode !== 'api_key') {
    throw new Error(`AGENT_AUTH_MODE 는 subscription 또는 api_key 여야 한다: ${authMode}`);
  }

  cached = {
    appEnv: env.APP_ENV ?? 'local',
    databasePath: env.DATABASE_PATH ?? path.join(dataDir, 'gwamegi.db'),
    migrationsDir: path.join(root, 'db', 'migrations'),
    eumCatalogPath: env.EUM_CATALOG_PATH ?? path.resolve(root, '..', 'data', 'eum-api-catalog.json'),
    gitCommit: env.GIT_COMMIT || undefined,
    agent: {
      // VM 은 bootstrap.sh 가 버전을 고정해 전역 설치한다. 로컬은 각자 설치한 claude 를 쓴다.
      claudeBin: env.CLAUDE_BIN ?? 'claude',
      workdir: env.AGENT_WORKDIR ?? path.join(dataDir, 'agent-workdir'),
      systemPromptPath: path.join(root, 'src', 'agent', 'system-prompt.md'),
      mcpServerPath: path.join(root, 'src', 'mcp', 'eum-server.ts'),
      authMode,
      model: env.AGENT_MODEL || undefined,
      effort: env.AGENT_EFFORT || undefined,
      maxBudgetUsd: Number(env.AGENT_MAX_BUDGET_USD ?? '0.5'),
      timeoutMs: Number(env.AGENT_TIMEOUT_MS ?? '120000'),
      // claude 프로세스 하나가 메모리 200~300MB 를 쓴다. 공개 주소라 상한을 둔다.
      maxConcurrency: Number(env.AGENT_MAX_CONCURRENCY ?? '4'),
    },
  };
  return cached;
}
