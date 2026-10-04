import { getConfig } from '../../../config.ts';
import { getDb } from '../../../db/index.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/health — 배포 스크립트가 기동 확인에 쓴다. 비밀값은 넣지 않는다.
export async function GET(): Promise<Response> {
  const config = getConfig();
  try {
    const row = getDb().prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: string | null };
    return Response.json({
      ok: true,
      env: config.appEnv,
      commit: config.gitCommit ?? null,
      schema: row.version,
      agentAuth: config.agent.authMode,
    });
  } catch (error) {
    return Response.json({ ok: false, env: config.appEnv, error: String(error) }, { status: 503 });
  }
}
