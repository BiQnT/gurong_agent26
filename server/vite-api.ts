import type { Connect, Plugin } from 'vite';
import { BridgeError, createObservationService, llmStatus, type BridgeConfig } from './eum.ts';
import { createLiveChat, readChatRequest } from './chat.ts';
import {
  createWorkspaceMiddleware,
  createWorkspaceService,
  isLocalWorkspaceRequest,
  type WorkspaceService,
} from './workspace.ts';
import { attachSiteContext } from './site-observations.ts';
import { summarizeBatches, withAssessment } from './assessment.ts';
import { createUvIndexSource } from './sources/eum-uv.ts';
import { createKmaSource, KMA_WAIT_MS, within } from './sources/kma.ts';
import { createGeocoder, readGeocodeReverse, readGeocodeSearch, type Geocoder } from './geocode.ts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { posix, relative, resolve, sep } from 'node:path';

const MAX_BODY_BYTES = 32768;
// 초대 링크 비밀값의 최소 길이. 짧으면 추측해 초대 토큰을 만들 수 있다 (ADR 0012).
const INVITE_SECRET_MIN_LENGTH = 32;
const API_PATHS = new Set([
  '/api/health',
  '/api/observations',
  '/api/chat',
  '/api/geocode/search',
  '/api/geocode/reverse',
]);

// Nominatim 이용 정책은 앱과 연락처를 User-Agent 로 알리게 한다. 공개 주소가 있으면 그것을 쓴다.
function geocoderUserAgent() {
  const origin = (process.env.PUBLIC_ORIGINS || '').split(',')[0]?.trim();
  return `haepung-gwamegi/1.0 (+${origin || 'https://github.com/BiQnT/gurong_agent26'})`;
}

function normalizeEumServiceKey(value: string | undefined): string {
  const key = value?.trim() || '';
  try {
    // Portal keys may be encoded already; decode once and preserve literal + characters.
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

// 빈 값이 0 이 되거나 오타가 NaN 이 되어 상한이 사라지지 않게 한다.
function positive(env: Record<string, string>, name: string, fallback: number): number {
  const value = Number(env[name]);
  return env[name]?.trim() && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function readBridgeConfig(env: Record<string, string>, projectRoot: string): BridgeConfig {
  const offset = env.EUM_TIMEZONE_OFFSET?.trim() || '+09:00';
  const age = Number(env.EUM_STALE_AFTER_MINUTES || 30);
  const inviteSecret = env.INVITE_LINK_SECRET?.trim() || '';
  // 짧은 비밀값은 없는 것으로 본다. 값은 로그에 남기지 않는다.
  if (inviteSecret && inviteSecret.length < INVITE_SECRET_MIN_LENGTH)
    console.warn(
      `[config] INVITE_LINK_SECRET 이 ${INVITE_SECRET_MIN_LENGTH}자보다 짧아 쓰지 않는다. 초대 링크는 만들 때 한 번만 보인다.`,
    );
  // workspace.ts 는 요청마다 process.env 를 읽으므로 .env 파일에서 온 값도 옮겨 둔다 (터널 주소와 같은 방식).
  for (const name of ['PUBLIC_ORIGINS', 'COOKIE_SECURE'])
    if (env[name] !== undefined && process.env[name] === undefined) process.env[name] = env[name];
  if (env.PUBLIC_TUNNEL_HOSTS !== undefined && process.env.PUBLIC_TUNNEL_HOSTS === undefined)
    process.env.PUBLIC_TUNNEL_HOSTS = env.PUBLIC_TUNNEL_HOSTS;
  return {
    eumServiceKey: normalizeEumServiceKey(env.EUM_SERVICE_KEY),
    // 기본은 팀원 로컬 설정(OpenAI 호환)이 그대로 동작하도록 openai. VM 은 LLM_PROVIDER=claude
    llmProvider: env.LLM_PROVIDER?.trim() === 'claude' ? 'claude' : 'openai',
    claude: {
      bin: env.CLAUDE_BIN?.trim() || 'claude',
      workdir: env.AGENT_WORKDIR?.trim() || resolve(projectRoot, '.local-data', 'agent-workdir'),
      authMode: env.AGENT_AUTH_MODE?.trim() === 'api_key' ? 'api_key' : 'subscription',
      model: env.AGENT_MODEL?.trim() || undefined,
      effort: env.AGENT_EFFORT?.trim() || undefined,
      maxBudgetUsd: positive(env, 'AGENT_MAX_BUDGET_USD', 0.5),
      timeoutMs: positive(env, 'AGENT_TIMEOUT_MS', 40000),
      maxConcurrency: positive(env, 'AGENT_MAX_CONCURRENCY', 4),
      dailyBudgetUsd: positive(env, 'AGENT_DAILY_BUDGET_USD', 10),
    },
    databasePath: env.DATABASE_PATH?.trim() || undefined,
    publicOrigins: (env.PUBLIC_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    cookieSecure: env.COOKIE_SECURE?.trim() === '1',
    inviteLinkSecret: inviteSecret.length >= INVITE_SECRET_MIN_LENGTH ? inviteSecret : undefined,
    devBasicAuth: env.DEV_BASIC_AUTH?.trim() || undefined,
    devOpen: env.DEV_OPEN?.trim() === '1',
    kmaAuthKey: env.KMA_AUTH_KEY?.trim() || undefined,
    dataGoKrKey: env.DATA_GO_KR_KEY?.trim() || undefined,
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
  geocoder: Geocoder = createGeocoder(geocoderUserAgent),
): Connect.NextHandleFunction {
  const workspaceMiddleware = createWorkspaceMiddleware(workspace);
  const kma = createKmaSource(config);
  const observations = createObservationService(config, fetch, kma);
  // 덕장 위치의 비·눈, 강수량, 일출·일몰. 키가 없거나 실패하면 붙이지 않는다.
  const siteWeather = async (site: { latitude: number; longitude: number }) =>
    kma ? await within(kma.weather(site), KMA_WAIT_MS) : null;
  const chat = createLiveChat(config, fetch, undefined, createUvIndexSource(config));
  return (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const send = (status: number, payload: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.end(JSON.stringify(payload));
    };
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
      // 없는 API 주소가 화면(index.html)으로 넘어가 200 HTML 이 되지 않게 한다.
      if (/^\/api(?:\/|$)/.test(url.pathname))
        send(404, { error: '요청한 API를 찾을 수 없어요.', code: 'NOT_FOUND' });
      else next();
      return;
    }
    const controller = new AbortController();
    const deadlineAt = Date.now() + 45000;
    const deadline = setTimeout(() => controller.abort(), 45000);
    const disconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', disconnect);
    response.once('close', disconnect);
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
          // 저장소를 실제로 한 번 읽는다. 못 읽으면 503 이라 배포 스크립트가 자동으로 되돌린다.
          let schema: number;
          try {
            ({ schema } = await workspace.health());
          } catch (error) {
            const code = (error as { code?: unknown }).code;
            console.error('[health] 저장소를 읽지 못했다', error);
            send(503, {
              error: '저장소를 읽을 수 없어요.',
              code: typeof code === 'string' ? code : 'STORE_UNAVAILABLE',
            });
            return;
          }
          send(200, {
            mode: process.env.APP_MODE || 'local-bridge',
            eum: { configured: !!config.eumServiceKey },
            llm: { provider: config.llmProvider ?? 'openai', ...llmStatus(config) },
            // 배포 스크립트가 새 버전이 떴는지 확인한다 (release.env 의 GIT_COMMIT).
            commit: process.env.GIT_COMMIT || null,
            schema,
          });
          return;
        }
        if (url.pathname.startsWith('/api/geocode/')) {
          if (request.method !== 'GET')
            throw new BridgeError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식이에요.');
          // 외부 서비스를 대신 부르므로 로그인한 사람만 쓴다 (덕장 등록은 가입 뒤에 한다).
          const { user } = await workspace.session(request);
          if (!user) throw new BridgeError(401, 'AUTH_REQUIRED', '로그인한 뒤 이용해 주세요.');
          if (url.pathname === '/api/geocode/search') {
            const query = readGeocodeSearch(url.searchParams);
            send(200, { results: await geocoder.search(query, controller.signal) });
          } else {
            const { latitude, longitude } = readGeocodeReverse(url.searchParams);
            send(200, { address: await geocoder.reverse(latitude, longitude, controller.signal) });
          }
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
          const [snapshot, weather] = await Promise.all([
            observations.snapshot(controller.signal, deviceId),
            access ? siteWeather(access.site) : null,
          ]);
          send(
            200,
            access
              ? withAssessment({
                  ...attachSiteContext(snapshot, access.site, deviceId),
                  ...(weather ? { weather } : {}),
                })
              : snapshot,
          );
          return;
        }
        if (request.method !== 'POST')
          throw new BridgeError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식이에요.');
        const input = readChatRequest(await readBody(request, controller.signal));
        const { site } = await workspace.requireMember(request, input.siteId, 'owner');
        const [observed, weather, operations] = await Promise.all([
          observations.snapshot(controller.signal, input.deviceId),
          siteWeather(site),
          // 배치 평가는 AI 설명 근거일 뿐이라 읽지 못해도 답변은 한다.
          workspace.operations(request, site.id).catch(() => null),
        ]);
        const snapshot = withAssessment({
          ...attachSiteContext(observed, site, input.deviceId),
          ...(weather ? { weather } : {}),
        });
        const batches = operations ? summarizeBatches(operations.data) : [];
        send(200, await chat(input, snapshot, controller.signal, deadlineAt, batches));
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

/** dev 공용 암호 "아이디:비밀번호" 를 HTTP Basic 으로 확인한다. */
function devBasicAuth(credentials: string): Connect.NextHandleFunction {
  // 길이가 달라도 비교 시간이 같도록 고정 길이 해시끼리 비교한다.
  const digest = (value: Buffer) => createHash('sha256').update(value).digest();
  // charset="UTF-8" 을 알리면 브라우저가 한글 비밀번호도 UTF-8 로 보내므로 바이트 그대로 비교한다.
  const expected = digest(Buffer.from(credentials, 'utf8'));
  return (request, response, next) => {
    const match = /^Basic +([A-Za-z0-9+/]+={0,2}) *$/i.exec(request.headers.authorization ?? '');
    if (match && timingSafeEqual(digest(Buffer.from(match[1], 'base64')), expected)) {
      next();
      return;
    }
    response.statusCode = 401;
    response.setHeader('WWW-Authenticate', 'Basic realm="haepung-dev", charset="UTF-8"');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end('개발 서버 접속 암호가 필요해요.');
  };
}

// 암호 없이 연 dev 가 줄 수 있는 주소. 화면(index.html, src)과 라이브러리, Vite 내부, API 만이다.
const DEV_APP_PREFIXES = [
  '/src/',
  '/node_modules/',
  '/@vite/',
  '/@react-refresh',
  '/@id/__x00__',
  '/api/',
];

/**
 * 암호 없이 연 dev 는 화면에 필요한 파일만 준다. Vite 는 저장소 안의 파일을 주소대로 내주므로
 * 그대로 열면 비공개 저장소의 서버 코드·문서·조사 자료가 공개된다. 나머지 주소는 404.
 */
export function devAppFilesOnly(root: string): Connect.NextHandleFunction {
  const publicDir = resolve(root, 'public');
  // /@fs/ 는 이 저장소의 node_modules 안만 준다 (경로 중간에 node_modules 가 있다고 통과시키지 않는다).
  const modulesFs = `/@fs${resolve(root, 'node_modules').split(sep).join('/')}/`;
  let publicFiles = new Set<string>();
  try {
    publicFiles = new Set(
      readdirSync(publicDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map(
          (entry) =>
            `/${relative(publicDir, resolve(entry.parentPath, entry.name)).split(sep).join('/')}`,
        ),
    );
  } catch {
    // public/ 이 없으면 줄 파일도 없다.
  }
  return (request, response, next) => {
    let path = '';
    try {
      // 인코딩(%2e%2e 등)과 ../ 를 풀어 실제로 가리키는 경로로 판단한다.
      path = posix.normalize(
        decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname),
      );
    } catch {
      path = '';
    }
    const allowed =
      path !== '' &&
      !path.includes('\0') &&
      (path === '/' ||
        path === '/index.html' ||
        publicFiles.has(path) ||
        DEV_APP_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
        path.startsWith(modulesFs));
    if (allowed) {
      next();
      return;
    }
    response.statusCode = 404;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end('Not found');
  };
}

export function localApiPlugin(config: BridgeConfig): Plugin {
  return {
    name: 'guryongpo-local-api',
    configureServer(server) {
      // 공개된 Vite dev 는 저장소의 코드·문서 파일을 그대로 준다. 암호 없이 열면(DEV_OPEN=1) 화면에
      // 필요한 파일만 주고, 아니면 모든 요청에 암호를 먼저 묻는다.
      // preview·prod(main.ts)는 빌드 결과만 주므로 걸지 않는다.
      if (config.devOpen) server.middlewares.use(devAppFilesOnly(config.projectRoot));
      else if (config.devBasicAuth) server.middlewares.use(devBasicAuth(config.devBasicAuth));
      // 공개 주소로 띄우는데 둘 다 없으면 저장소 전체가 열린다. 열지 않고 시작을 멈춘다.
      else if (config.publicOrigins?.length)
        throw new Error(
          'PUBLIC_ORIGINS 로 공개한 dev 서버는 DEV_BASIC_AUTH 나 DEV_OPEN=1 이 있어야 시작한다.',
        );
      server.middlewares.use(createApiMiddleware(config));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApiMiddleware(config));
    },
  };
}
