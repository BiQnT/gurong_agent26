import { ChatError, prepareChat, streamChat } from '../../../chat/service.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/chat  { sessionId?: string, message: string }  →  text/event-stream
export async function POST(request: Request): Promise<Response> {
  // 메시지는 2,000자라 본문이 이보다 훨씬 클 이유가 없다. 다 읽기 전에 거른다.
  if (Number(request.headers.get('content-length') ?? 0) > 32_000) {
    return Response.json({ error: '본문이 너무 크다' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '본문이 JSON 이 아니다' }, { status: 400 });
  }

  let context;
  try {
    context = prepareChat(body);
  } catch (error) {
    if (error instanceof ChatError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }

  // 브라우저가 연결을 끊으면 claude 프로세스도 끝낸다 (비용).
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort(), { once: true });
  if (request.signal.aborted) abort.abort();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const event of streamChat(context, abort.signal)) {
        if (abort.signal.aborted) continue;
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      }
      if (!abort.signal.aborted) controller.close();
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
