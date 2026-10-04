import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 관리 스크립트를 실제 실행 방식(별도 node 프로세스)으로 돌려 종료 코드와 출력을 받는다.
export const scriptPath = (name: string) =>
  fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url));

export function runScript(
  file: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', file, ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) =>
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout,
          stderr,
        }),
    );
  });
}
