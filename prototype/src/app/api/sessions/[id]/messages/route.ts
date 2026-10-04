import { listMessages } from '../../../../../chat/service.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/sessions/:id/messages  →  { sessionId, messages: [...] }
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const messages = listMessages(id);
  if (!messages) return Response.json({ error: '대화를 찾을 수 없다' }, { status: 404 });
  return Response.json({ sessionId: id, messages });
}
