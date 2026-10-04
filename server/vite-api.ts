import type { Connect, Plugin } from 'vite';
import { BridgeError, createObservationService, type BridgeConfig } from './eum.ts';
import { createLiveChat, readChatRequest } from './chat.ts';
import {
  createWorkspaceMiddleware,
  createWorkspaceService,
  isLocalWorkspaceRequest,
  type WorkspaceService,
} from './workspace.ts';
import { attachSiteContext } from './site-observations.ts';

const MAX_BODY_BYTES = 32768;
const API_PATHS = new Set(['/api/health', '/api/observations', '/api/chat']);

function normalizeEumServiceKey(value: string | undefined): string {
  const key = value?.trim() || '';
  try {
    // Portal keys may be encoded already; decode once and preserve literal + characters.
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

export function readBridgeConfig(env: Record<string, string>, projectRoot: string): BridgeConfig {
  const offset = env.EUM_TIMEZONE_OFFSET?.trim() || '+09:00';
  const age = Number(env.EUM_STALE_AFTER_MINUTES || 30);
  if (env.PUBLIC_TUNNEL_HOSTS !== undefined && process.env.PUBLIC_TUNNEL_HOSTS === undefined)
    process.env.PUBLIC_TUNNEL_HOSTS = env.PUBLIC_TUNNEL_HOSTS;
  return {
    eumServiceKey: normalizeEumServiceKey(env.EUM_SERVICE_KEY),
    openaiApiKey: (env.LLM_API_KEY ?? env.OPENAI_API_KEY)?.trim() || '',
    openaiModel: (env.LLM_API_MODEL ?? env.OPENAI_MODEL)?.trim() || 'gpt-4.1-mini',
    llmBaseUrl: env.LLM_API_BASE?.trim() || 'https://api.openai.com/v1',
    timezoneOffset: /^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset) ? offset : '+09:00',
    staleAfterMinutes: Number.isFinite(age) && age > 0 && age <= 1440 ? age : 30,
    projectRoot,
  };
}

function readBody(request: Connect.IncomingMessage, signal: AbortSignal): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return Promise.reject(new BridgeError(415, 'JSON_REQUIRED', 'JSON 형식의 요청이 필요해요.'));
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let length = 0;
    const decoder = new TextDecoder();
    const cleanup = () => {
      request.off('data', data);
      request.off('end', end);
      request.off('error', error);
      signal.removeEventListener('abort', abort);
    };
    const error = () => {
      cleanup();
      reject(new BridgeError(400, 'BODY_ERROR', '요청 본문을 읽을 수 없어요.'));
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const data = (chunk: Uint8Array) => {
      length += chunk.byteLength;
      if (length > MAX_BODY_BYTES) {
        cleanup();
        request.resume();
        reject(
          new BridgeError(
            413,
            'BODY_TOO_LARGE',
            '요청 내용이 너무 길어요. 대화를 줄여 다시 시도해 주세요.',
          ),
        );
        return;
      }
      body += decoder.decode(chunk, { stream: true });
    };
    const end = () => {
      cleanup();
      try {
        resolve(JSON.parse(body + decoder.decode()));
      } catch {
        reject(new BridgeError(400, 'INVALID_JSON', '요청 본문이 올바른 JSON 형식이 아니에요.'));
      }
    };
    request.on('data', data);
    request.on('end', end);
    request.on('error', error);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function createApiMiddleware(
  config: BridgeConfig,
  workspace: WorkspaceService = createWorkspaceService(config),
): Connect.NextHandleFunction {
  const workspaceMiddleware = createWorkspaceMiddleware(workspace);
  const observations = createObservationService(config);
  const chat = createLiveChat(config);
  return (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname).replaceAll('\\', '/');
    } catch {
      decodedPath = url.pathname;
    }
    // The Vite project directory also contains the private development database.
    // Stop static and /@fs reads before Vite's file middleware can serve it.
    if (/(?:^|\/)\.local-data(?:\/|$)/i.test(decodedPath)) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ error: '요청한 파일을 찾을 수 없어요.', code: 'NOT_FOUND' }));
      return;
    }
    if (/^\/api\/(?:auth(?:\/|$)|sites(?:\/|$)|invitations(?:\/|$))/.test(url.pathname)) {
      workspaceMiddleware(request, response, next);
      return;
    }
    if (!API_PATHS.has(url.pathname)) {
      next();
      return;
    }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 45000);
    const disconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', disconnect);
    response.once('close', disconnect);
    const send = (status: number, payload: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.end(JSON.stringify(payload));
    };
    void (async () => {
      try {
        if (!isLocalWorkspaceRequest(request))
          throw new BridgeError(
            403,
            'LOCAL_ORIGIN_REQUIRED',
            '같은 로컬 화면에서만 API를 사용할 수 있어요.',
          );
        if (url.pathname === '/api/health') {
          if (request.method !== 'GET')
            throw new BridgeError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식이에요.');
          send(200, {
            mode: 'local-bridge',
            eum: { configured: !!config.eumServiceKey },
            llm: { configured: !!config.openaiApiKey, model: config.openaiModel },
          });
          return;
        }
        if (url.pathname === '/api/observations') {
          if (request.method !== 'GET')
            throw new BridgeError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식이에요.');
          const deviceId = url.searchParams.get('deviceId') || undefined;
          if (deviceId && !/^[\w-]{1,80}$/.test(deviceId))
            throw new BridgeError(400, 'INVALID_DEVICE', '관측기 ID가 올바르지 않아요.');
          const siteId = url.searchParams.get('siteId');
          const access = siteId ? await workspace.requireMember(request, siteId) : null;
          const snapshot = await observations.snapshot(controller.signal, deviceId);
          send(200, access ? attachSiteContext(snapshot, access.site, deviceId) : snapshot);
          return;
        }
        if (request.method !== 'POST')
          throw new BridgeError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식이에요.');
        const input = readChatRequest(await readBody(request, controller.signal));
        const { site } = await workspace.requireMember(request, input.siteId, 'owner');
        const snapshot = attachSiteContext(
          await observations.snapshot(controller.signal, input.deviceId),
          site,
          input.deviceId,
        );
        send(200, await chat(input, snapshot, controller.signal));
      } catch (error) {
        if (controller.signal.aborted)
          send(504, {
            error: '요청 시간이 초과됐거나 중단됐어요. 다시 시도해 주세요.',
            code: 'REQUEST_CANCELLED',
          });
        else if (error instanceof BridgeError)
          send(error.status, { error: error.message, code: error.code });
        else
          send(500, {
            error: '연결 처리 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.',
            code: 'BRIDGE_ERROR',
          });
      } finally {
        clearTimeout(deadline);
        request.off('aborted', disconnect);
        response.off('close', disconnect);
      }
    })();
  };
}

export function localApiPlugin(config: BridgeConfig): Plugin {
  return {
    name: 'guryongpo-local-api',
    configureServer(server) {
      server.middlewares.use(createApiMiddleware(config));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApiMiddleware(config));
    },
  };
}
