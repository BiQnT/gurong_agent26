import { ChatError, prepareChat, streamChat } from '../../../chat/service.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/chat  { sessionId?: string, message: string }  →  text/event-stream
// 메시지는 2,000자라 본문이 이보다 훨씬 클 이유가 없다. content-length 가 없는 chunked 요청도 있어 읽으면서 센다.
const MAX_BODY_BYTES = 32_000;

async function readBody(request: Request): Promise<string | undefined> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(request: Request): Promise<Response> {
  const raw = await readBody(request);
  if (raw === undefined) return Response.json({ error: '본문이 너무 크다' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
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
