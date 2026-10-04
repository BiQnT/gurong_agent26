// 운영용 서버: `npm run build` 로 만든 화면(dist/)과 API 를 한 포트에서 함께 제공한다.
// 개발 중에는 Vite(npm run dev)가 같은 API 를 붙여 주므로 이 파일은 prod 에서만 쓴다.
// 바깥 접속은 앞단 Caddy(TLS)가 받아 넘기므로 루프백에만 연다. 설정은 .env 파일이 아니라 환경 변수로 받는다.
//
//   PORT=3000 HOST=127.0.0.1 node server/main.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import type { BridgeConfig } from './eum.ts';
import { createApiMiddleware, readBridgeConfig } from './vite-api.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function createStaticHandler(dist: string) {
  const root = resolve(dist);
  const assets = join(root, 'assets') + sep;
  const sendFile = (
    request: IncomingMessage,
    response: ServerResponse,
    file: string,
    size: number,
  ) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    response.setHeader('Content-Length', size);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // 빌드 결과의 assets/ 는 파일 이름에 해시가 붙어 있어 오래 캐시해도 된다. index.html 은 매번 확인한다.
    // 주소가 아니라 실제 파일 위치로 판단한다 (/assets/..%2findex.html 이 index 를 굳히지 않게).
    response.setHeader(
      'Cache-Control',
      file.startsWith(assets) ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    // pipe 와 달리 읽기 오류나 연결 끊김에서 파일을 닫고, 처리 안 된 오류로 서버가 죽지 않는다.
    pipeline(createReadStream(file), response, () => undefined);
  };
  const fileSize = (file: string) => {
    try {
      const stat = statSync(file);
      return stat.isFile() ? stat.size : undefined;
    } catch {
      return undefined;
    }
  };
  return (request: IncomingMessage, response: ServerResponse) => {
    const notFound = () => {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('Not found');
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      notFound();
      return;
    }
    // dist 밖의 파일은 읽지 않는다 (../ 등).
    const file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep)) {
      notFound();
      return;
    }
    const size = fileSize(file);
    if (size !== undefined) {
      sendFile(request, response, file, size);
      return;
    }
    // 확장자가 없는 주소(/invite/... 등)는 화면 라우팅이므로 index.html 을 준다.
    const index = join(root, 'index.html');
    const indexSize = extname(path) ? undefined : fileSize(index);
    if (indexSize === undefined) {
      notFound();
      return;
    }
    sendFile(request, response, index, indexSize);
  };
}

/** API 를 먼저 보고, API 가 아닌 주소만 화면 파일로 넘긴다. */
export function createAppServer(config: BridgeConfig, dist: string) {
  const api = createApiMiddleware(config);
  const serveStatic = createStaticHandler(dist);
  return createServer((request, response) =>
    api(request, response, () => serveStatic(request, response)),
  );
}

if (import.meta.main) {
  // systemd 의 작업 폴더 설정과 상관없이 release 폴더(이 파일의 상위)를 기준으로 삼는다.
  const projectRoot = resolve(import.meta.dirname, '..');
  process.env.APP_MODE ||= 'server';
  const config = readBridgeConfig(process.env as Record<string, string>, projectRoot);
  const server = createAppServer(config, join(projectRoot, 'dist'));
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(
      `[server] http://${host}:${port} · LLM ${config.llmProvider} · DB ${config.databasePath ?? '.local-data/workspace.json'}`,
    );
  });
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
