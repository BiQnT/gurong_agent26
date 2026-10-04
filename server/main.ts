// 운영용 서버: `npm run build` 로 만든 화면(dist/)과 API 를 한 포트에서 함께 제공한다.
// 개발 중에는 Vite(npm run dev)가 같은 API 를 붙여 주므로 이 파일은 prod 에서만 쓴다.
//
//   PORT=3000 HOST=0.0.0.0 node server/main.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
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
  const sendFile = (response: ServerResponse, file: string, size: number, immutable: boolean) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    response.setHeader('Content-Length', size);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // 빌드 결과의 assets/ 는 파일 이름에 해시가 붙어 있어 오래 캐시해도 된다. index.html 은 매번 확인한다.
    response.setHeader(
      'Cache-Control',
      immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    createReadStream(file).pipe(response);
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
      sendFile(response, file, size, path.startsWith('/assets/'));
      return;
    }
    // 확장자가 없는 주소(/invite/... 등)는 화면 라우팅이므로 index.html 을 준다.
    const index = join(root, 'index.html');
    const indexSize = extname(path) ? undefined : fileSize(index);
    if (indexSize === undefined) {
      notFound();
      return;
    }
    sendFile(response, index, indexSize, false);
  };
}

if (import.meta.main) {
  const projectRoot = process.cwd();
  process.env.APP_MODE ||= 'server';
  const config = readBridgeConfig(process.env as Record<string, string>, projectRoot);
  const api = createApiMiddleware(config);
  const serveStatic = createStaticHandler(join(projectRoot, 'dist'));
  const server = createServer((request, response) =>
    api(request, response, () => serveStatic(request, response)),
  );
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
