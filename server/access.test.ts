import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createServer as createViteServer, type Connect } from 'vite';
import type { BridgeConfig } from './eum.ts';
import { createApiMiddleware, localApiPlugin } from './vite-api.ts';
import { isLocalWorkspaceRequest } from './workspace.ts';

const PROD = 'https://35-192-216-232.sslip.io';
const DEV = 'https://35-192-216-232.sslip.io:440';
const PROD_HOST = '35-192-216-232.sslip.io';
const DEV_HOST = '35-192-216-232.sslip.io:440';
const DEV_PASSWORD = 'team:바다-덕장 2026';

function useEnv(t: TestContext, values: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const apply = (next: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(values);
  t.after(() => apply(saved));
}

async function testConfig(
  t: TestContext,
  extra: Partial<BridgeConfig> = {},
): Promise<BridgeConfig> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'haepung-access-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return {
    eumServiceKey: '',
    openaiApiKey: '',
    openaiModel: 'gpt-4.1-mini',
    llmBaseUrl: 'https://api.openai.com/v1',
    timezoneOffset: '+09:00',
    staleAfterMinutes: 30,
    projectRoot,
    ...extra,
  };
}

function fakeRequest(headers: Record<string, string>, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

const allowed = (headers: Record<string, string>, remote?: string) =>
  isLocalWorkspaceRequest(fakeRequest(headers, remote));

async function listen(t: TestContext, server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

/** fetch 는 Host 를 바꿀 수 없으므로 http.request 로 프록시(Caddy)가 넘긴 요청을 흉내 낸다. */
function call(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path,
          method: options.method ?? 'GET',
          headers: options.headers,
          agent: false,
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (body += chunk));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
          );
        },
      );
      request.on('error', reject);
      request.end(options.body);
    },
  );
}

const basic = (value: string) => `Basic ${Buffer.from(value, 'utf8').toString('base64')}`;

function installed(hook: unknown): Connect.NextHandleFunction[] {
  assert.equal(typeof hook, 'function');
  const used: Connect.NextHandleFunction[] = [];
  (hook as (server: unknown) => void)({
    middlewares: { use: (middleware: Connect.NextHandleFunction) => used.push(middleware) },
  });
  return used;
}

function chain(middlewares: Connect.NextHandleFunction[]) {
  return createServer((request, response) => {
    const run = (index: number) => {
      const middleware = middlewares[index];
      if (middleware) middleware(request, response, () => run(index + 1));
      else response.end('repository source file');
    };
    run(0);
  });
}

test('a configured public origin passes from its own page with or without an Origin header', (t) => {
  useEnv(t, { PUBLIC_ORIGINS: `${PROD}, ${DEV}/`, PUBLIC_TUNNEL_HOSTS: undefined });
  assert.equal(allowed({ host: PROD_HOST }), true);
  assert.equal(allowed({ host: PROD_HOST, origin: PROD, 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(allowed({ host: PROD_HOST, 'sec-fetch-site': 'none' }), true);
  assert.equal(allowed({ host: DEV_HOST }), true);
  assert.equal(allowed({ host: DEV_HOST, origin: DEV, 'sec-fetch-site': 'same-origin' }), true);
  // 기본 포트는 Host 에 붙어 와도 같은 출처다. 대소문자도 구분하지 않는다.
  assert.equal(allowed({ host: `${PROD_HOST}:443`, origin: PROD }), true);
  assert.equal(allowed({ host: DEV_HOST.toUpperCase(), origin: DEV }), true);
  useEnv(t, { PUBLIC_ORIGINS: `${PROD}:443` });
  assert.equal(allowed({ host: PROD_HOST, origin: PROD }), true);
});

test('the same hostname on another port is another origin, so dev and prod pages reject each other', (t) => {
  // 터널 규칙(호스트 이름만 비교)이 공개 주소에 섞여 들어오지 않는지도 함께 본다.
  useEnv(t, { PUBLIC_ORIGINS: `${PROD},${DEV}`, PUBLIC_TUNNEL_HOSTS: '.sslip.io' });
  assert.equal(allowed({ host: PROD_HOST, origin: DEV }), false);
  assert.equal(allowed({ host: DEV_HOST, origin: PROD }), false);
  assert.equal(allowed({ host: PROD_HOST, origin: `http://${PROD_HOST}` }), false);
  assert.equal(allowed({ host: PROD_HOST, origin: `${PROD}:8443` }), false);
  assert.equal(allowed({ host: PROD_HOST, origin: 'null' }), false);
  // Origin 이 없는 요청도 브라우저가 다른 출처라고 알리면 막는다 (dev 화면의 img·form 등).
  assert.equal(allowed({ host: PROD_HOST, 'sec-fetch-site': 'same-site' }), false);
  assert.equal(allowed({ host: PROD_HOST, 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(allowed({ host: `${PROD_HOST}:3000` }), false);
  assert.equal(allowed({ host: `user@${DEV_HOST}`, origin: DEV }), false);
  useEnv(t, { PUBLIC_ORIGINS: PROD });
  assert.equal(allowed({ host: DEV_HOST }), false);
  assert.equal(allowed({ host: DEV_HOST, origin: DEV }), false);
});

test('hosts outside the public origin list and non-loopback peers are rejected', (t) => {
  useEnv(t, { PUBLIC_ORIGINS: `${PROD},${DEV}`, PUBLIC_TUNNEL_HOSTS: undefined });
  assert.equal(allowed({ host: 'evil.example', origin: 'https://evil.example' }), false);
  assert.equal(allowed({ host: '35-192-216-233.sslip.io' }), false);
  assert.equal(allowed({ host: '35.192.216.232' }), false);
  assert.equal(allowed({}), false);
  // 앱은 Caddy 뒤 루프백에만 열린다. 직접 들어온 요청이 Host 를 꾸며도 받지 않는다.
  assert.equal(allowed({ host: PROD_HOST, origin: PROD }, '203.0.113.7'), false);
  useEnv(t, { PUBLIC_ORIGINS: undefined });
  assert.equal(allowed({ host: PROD_HOST }), false);
  useEnv(t, { PUBLIC_ORIGINS: 'not a url, ftp://35-192-216-232.sslip.io' });
  assert.equal(allowed({ host: PROD_HOST }), false);
});

test('loopback and tunnel rules are unchanged by public origins', (t) => {
  useEnv(t, { PUBLIC_ORIGINS: `${PROD},${DEV}`, PUBLIC_TUNNEL_HOSTS: '.trycloudflare.com' });
  assert.equal(allowed({ host: '127.0.0.1:3000' }), true);
  assert.equal(allowed({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }), true);
  assert.equal(allowed({ host: 'localhost:3001', 'sec-fetch-site': 'same-site' }), true);
  assert.equal(allowed({ host: '[::1]:3000' }, '::1'), true);
  assert.equal(allowed({ host: 'localhost:3000', origin: 'http://localhost:5173' }), false);
  assert.equal(allowed({ host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(allowed({ host: '127.0.0.1:3000' }, '10.0.0.5'), false);
  // 터널은 원래대로 호스트 이름만 비교한다.
  assert.equal(
    allowed({ host: 'abc.trycloudflare.com', origin: 'https://abc.trycloudflare.com' }),
    true,
  );
  assert.equal(
    allowed({ host: 'abc.trycloudflare.com', origin: 'https://other.trycloudflare.com' }),
    false,
  );
  assert.equal(allowed({ host: 'abc.trycloudflare.com' }, '198.51.100.4'), false);
});

test('public API requests get no CORS grant, need JSON bodies and keep health fields', async (t) => {
  useEnv(t, {
    PUBLIC_ORIGINS: `${PROD},${DEV}`,
    PUBLIC_TUNNEL_HOSTS: undefined,
    GIT_COMMIT: 'abc1234',
    APP_MODE: undefined,
  });
  const port = await listen(
    t,
    chain([createApiMiddleware(await testConfig(t, { eumServiceKey: 'test-eum-secret' }))]),
  );
  const prod = { Host: PROD_HOST, Origin: PROD, 'Sec-Fetch-Site': 'same-origin' };
  for (const [path, headers] of [
    ['/api/health', { Host: DEV_HOST, Origin: DEV }],
    ['/api/auth/login', { Host: PROD_HOST, Origin: PROD }],
    ['/api/sites', { Host: PROD_HOST, Origin: PROD }],
    ['/api/auth/login', { Host: PROD_HOST, Origin: DEV }],
  ] as const) {
    const response = await call(port, path, {
      method: 'OPTIONS',
      headers: {
        ...headers,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.ok([403, 405].includes(response.status), `${path} ${response.status}`);
    assert.equal(response.headers['access-control-allow-origin'], undefined, path);
    assert.equal(response.headers['access-control-allow-credentials'], undefined, path);
  }
  for (const path of ['/api/auth/signup', '/api/auth/login', '/api/sites', '/api/chat']) {
    const response = await call(port, path, {
      method: 'POST',
      headers: { ...prod, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '{"email":"a@example.com"}',
    });
    assert.equal(response.status, 415, path);
    assert.equal(JSON.parse(response.body).code, 'JSON_REQUIRED', path);
  }
  const crossPort = await call(port, '/api/auth/login', {
    method: 'POST',
    headers: { Host: PROD_HOST, Origin: DEV, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(crossPort.status, 403);
  assert.equal(JSON.parse(crossPort.body).code, 'LOCAL_ORIGIN_REQUIRED');
  const health = await call(port, '/api/health', { headers: prod });
  assert.equal(health.status, 200);
  const payload = JSON.parse(health.body);
  assert.equal(payload.mode, 'local-bridge');
  assert.deepEqual(payload.eum, { configured: true });
  assert.deepEqual(payload.llm, { provider: 'openai', configured: false, model: 'gpt-4.1-mini' });
  assert.equal(payload.commit, 'abc1234');
  assert.ok(!health.body.includes('secret'));
  const unknown = await call(port, '/api/does-not-exist', { headers: prod });
  assert.equal(unknown.status, 404);
  assert.equal(JSON.parse(unknown.body).code, 'NOT_FOUND');
});

test('dev basic auth guards every dev request with UTF-8 credentials, but not preview', async (t) => {
  useEnv(t, { PUBLIC_ORIGINS: undefined, PUBLIC_TUNNEL_HOSTS: undefined });
  const config = await testConfig(t, { devBasicAuth: DEV_PASSWORD });
  const dev = installed(localApiPlugin(config).configureServer);
  assert.equal(dev.length, 2);
  const port = await listen(t, chain(dev));
  for (const authorization of [
    undefined,
    basic('team:wrong'),
    basic('team:바다-덕장 2026 '),
    basic('team:'),
    `Basic ${Buffer.from(DEV_PASSWORD, 'latin1').toString('base64')}`,
    `Bearer ${Buffer.from(DEV_PASSWORD, 'utf8').toString('base64')}`,
    'Basic !!!',
  ]) {
    for (const path of ['/server/workspace.ts', '/.env.local', '/api/health']) {
      const response = await call(port, path, {
        headers: authorization ? { Authorization: authorization } : {},
      });
      assert.equal(response.status, 401, `${path} ${authorization}`);
      assert.equal(
        response.headers['www-authenticate'],
        'Basic realm="haepung-dev", charset="UTF-8"',
      );
      assert.ok(!response.body.includes('repository source file'));
    }
  }
  const source = await call(port, '/server/workspace.ts', {
    headers: { Authorization: basic(DEV_PASSWORD) },
  });
  assert.equal(source.status, 200);
  assert.equal(source.body, 'repository source file');
  const health = await call(port, '/api/health', {
    headers: {
      Authorization: `basic ${Buffer.from(DEV_PASSWORD).toString('base64')}`,
      Host: `127.0.0.1:${port}`,
    },
  });
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).llm.provider, 'openai');

  const preview = installed(localApiPlugin(config).configurePreviewServer);
  assert.equal(preview.length, 1);
  const previewPort = await listen(t, chain(preview));
  assert.equal((await call(previewPort, '/index.html')).status, 200);
  const open = installed(localApiPlugin(await testConfig(t)).configureServer);
  assert.equal(open.length, 1);
});

test('the real Vite dev server asks for the password before serving repository files', async (t) => {
  useEnv(t, { PUBLIC_ORIGINS: `${PROD},${DEV}`, PUBLIC_TUNNEL_HOSTS: undefined });
  const vite = await createViteServer({
    configFile: false,
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'spa',
    plugins: [localApiPlugin(await testConfig(t, { devBasicAuth: DEV_PASSWORD }))],
    server: { middlewareMode: true, hmr: false, allowedHosts: [PROD_HOST] },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  const port = await listen(t, createServer(vite.middlewares));
  for (const path of ['/server/workspace.ts', '/.env.local', '/@fs/etc/hosts', '/index.html']) {
    const response = await call(port, path, { headers: { Host: DEV_HOST } });
    assert.equal(response.status, 401, path);
  }
  const preflight = await call(port, '/api/auth/login', {
    method: 'OPTIONS',
    headers: { Host: DEV_HOST, Origin: DEV, 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  const health = await call(port, '/api/health', {
    headers: { Host: DEV_HOST, Origin: DEV, Authorization: basic(DEV_PASSWORD) },
  });
  assert.equal(health.status, 200);
  const prodPage = await call(port, '/api/health', {
    headers: { Host: DEV_HOST, Origin: PROD, Authorization: basic(DEV_PASSWORD) },
  });
  assert.equal(prodPage.status, 403);
});
