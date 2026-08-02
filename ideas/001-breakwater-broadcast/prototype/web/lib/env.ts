import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 서버 전용 환경변수 로더.
 *
 * 키는 이 웹 프로젝트가 아니라 **한 단계 위** `prototype/.env` 에 있다.
 * 아이디어 폴더마다 개인 키(LLM 등)가 다르기 때문에 그렇게 두기로 했다.
 *
 * Next.js 의 `next.config` `env` 옵션을 쓰지 않는 이유: 그 값은 클라이언트
 * 번들에 인라인될 수 있다. 여기서는 서버 런타임에 파일을 직접 읽으므로
 * 번들러가 값을 볼 일이 자체가 없다.
 *
 * **이 모듈을 클라이언트 컴포넌트에서 import 하지 말 것.** Route Handler 와
 * 서버 코드에서만 쓴다.
 */

const ENV_FILES = [
  // web/.env (있으면 우선)
  join(process.cwd(), ".env"),
  // prototype/.env (정본)
  join(dirname(process.cwd()), ".env"),
];

let cache: Record<string, string> | null = null;

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value) out[key] = value;
  }
  return out;
}

function loadAll(): Record<string, string> {
  if (cache) return cache;
  const merged: Record<string, string> = {};
  // 뒤에 오는 파일이 먼저 채워지고, 앞(가까운) 파일이 덮어쓴다.
  for (const path of [...ENV_FILES].reverse()) {
    Object.assign(merged, parseEnvFile(path));
  }
  cache = merged;
  return merged;
}

/** 환경변수 → .env 파일 순으로 찾는다. 없으면 undefined. */
export function readEnv(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  return loadAll()[name];
}

/** 없으면 어디에 넣어야 하는지 알려주며 던진다. */
export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(
      `${name} 가 없다. 다음 중 한 곳에 넣을 것:\n` +
        ENV_FILES.map((p) => `  ${p}`).join("\n"),
    );
  }
  return value;
}
