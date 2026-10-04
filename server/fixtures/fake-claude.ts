import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeConfig } from '../claude-cli.ts';

// 테스트용 가짜 `claude` 실행 파일. 받은 인자·환경·stdin 을 파일에 남기고 정해 둔 동작을 한다.
// 서버가 자식에게 환경변수를 거르므로(claudeEnv) 동작은 환경변수가 아니라 스크립트에 박아 넣는다.

export type FakeBehavior = {
  /** 표준 출력으로 내보낼 글 (보통 claude 결과 JSON) */
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** 출력 전에 기다리는 시간. 시간 초과·취소·동시 실행 시험에 쓴다 */
  sleepMs?: number;
  /** SIGTERM 을 무시해 강제 종료(SIGKILL)가 필요하게 만든다 */
  ignoreSigterm?: boolean;
  /** 표준 출력을 물고 있는 하위 프로세스를 만든다 (프로세스 그룹 종료 시험) */
  grandchild?: boolean;
};

export type FakeCall = {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  stdin: string;
};

const SCRIPT = `
const fs = require('node:fs');
// 시작하자마자 등록해야 기록 파일이 생긴 시점에는 이미 SIGTERM 을 무시하고 있다.
if (BEHAVIOR.ignoreSigterm) process.on('SIGTERM', () => {});
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  fs.appendFileSync(
    RECORD,
    JSON.stringify({
      argv: process.argv.slice(2),
      env: process.env,
      cwd: process.cwd(),
      stdin: Buffer.concat(chunks).toString('utf8'),
    }) + '\\n',
  );
  if (BEHAVIOR.grandchild)
    require('node:child_process').spawn('sleep', ['15'], { stdio: ['ignore', 'inherit', 'inherit'] });
  setTimeout(() => {
    if (BEHAVIOR.stderr) process.stderr.write(BEHAVIOR.stderr);
    if (BEHAVIOR.stdout !== undefined) process.stdout.write(BEHAVIOR.stdout);
    process.exit(BEHAVIOR.exitCode ?? 0);
  }, BEHAVIOR.sleepMs ?? 0);
});
`;

const dirs: string[] = [];

/** server/fixtures 의 claude 결과 JSON 을 읽는다. patch 로 일부 필드만 바꿀 수 있다. */
export function readFixture(name: string, patch: Record<string, unknown> = {}): string {
  const file = new URL(`./${name}`, import.meta.url);
  return JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...patch });
}

export function makeFakeClaude(behavior: FakeBehavior, overrides: Partial<ClaudeConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  dirs.push(dir);
  const record = join(dir, 'calls.jsonl');
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nconst BEHAVIOR = ${JSON.stringify(behavior)};\nconst RECORD = ${JSON.stringify(record)};\n${SCRIPT}`,
  );
  chmodSync(bin, 0o755);
  const config: ClaudeConfig = {
    bin,
    workdir: join(dir, 'workdir'),
    authMode: 'subscription',
    maxBudgetUsd: 0.5,
    dailyBudgetUsd: 10,
    timeoutMs: 10000,
    maxConcurrency: 2,
    killGraceMs: 300,
    ...overrides,
  };
  const calls = (): FakeCall[] =>
    existsSync(record)
      ? readFileSync(record, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as FakeCall)
      : [];
  /** 가짜 claude 가 n 번째 실행을 시작할 때까지 기다린다 */
  const waitForCall = async (count = 1, limitMs = 5000): Promise<void> => {
    const until = Date.now() + limitMs;
    while (calls().length < count) {
      if (Date.now() > until) throw new Error('fake claude did not start');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  return { config, calls, waitForCall };
}

export function cleanupFakes(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
