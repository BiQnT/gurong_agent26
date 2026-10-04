import { getConfig } from '../../../config.ts';
import { listSessions } from '../../../chat/service.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/sessions[?env=all]  →  { sessions: [...] }  최근 대화 50개. 기본은 지금 서버 환경(dev/prod)에서 만든 것만.
export async function GET(request: Request): Promise<Response> {
  const all = new URL(request.url).searchParams.get('env') === 'all';
  return Response.json({ sessions: listSessions(all ? undefined : getConfig().appEnv) });
}
