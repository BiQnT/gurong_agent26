import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createAppServer } from './main.ts';

const INDEX = '<!doctype html><title>해풍</title><div id="root"></div>';
const SCRIPT = 'console.log("해풍");';

/** fetch 는 /..%2f 같은 주소를 정리해 버리므로 http.request 로 주소를 그대로 보낸다. */
function call(port: number, path: string, method = 'GET') {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port, path, method, agent: false },
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
      request.end();
    },
  );
}

async function startApp(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'haepung-main-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), INDEX);
  await writeFile(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(dist, 'assets', 'index-abc123.js'), SCRIPT);
  await writeFile(join(root, 'secret.txt'), 'outside dist');
  const server = createAppServer(
    {
      eumServiceKey: '',
      openaiApiKey: '',
      openaiModel: 'gpt-4.1-mini',
      llmBaseUrl: 'https://api.openai.com/v1',
      timezoneOffset: '+09:00',
      staleAfterMinutes: 30,
      projectRoot: root,
    },
    dist,
  );
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

test('the production server serves built files with the right type and cache policy', async (t) => {
  const port = await startApp(t);
  const script = await call(port, '/assets/index-abc123.js');
  assert.equal(script.status, 200);
  assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(script.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(script.headers['x-content-type-options'], 'nosniff');
  assert.equal(script.body, SCRIPT);
  const icon = await call(port, '/favicon.svg');
  assert.equal(icon.headers['content-type'], 'image/svg+xml');
  assert.equal(icon.headers['cache-control'], 'no-cache');
  const index = await call(port, '/');
  assert.equal(index.status, 200);
  assert.equal(index.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(index.headers['cache-control'], 'no-cache');
  assert.equal(index.body, INDEX);
  const head = await call(port, '/assets/index-abc123.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], String(Buffer.byteLength(SCRIPT)));
  assert.equal(head.body, '');
});

test('screen routes fall back to index.html while missing files stay 404', async (t) => {
  const port = await startApp(t);
  for (const path of ['/invite/AbC_-123', '/sites/abc/team', '/login?next=%2Fhome']) {
    const response = await call(port, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, INDEX, path);
    assert.equal(response.headers['cache-control'], 'no-cache', path);
  }
  for (const path of ['/assets/missing-xyz.js', '/missing.css', '/robots.txt']) {
    const response = await call(port, path);
    assert.equal(response.status, 404, path);
    assert.notEqual(response.body, INDEX, path);
  }
});

test('paths that escape dist are refused and index.html is never cached as an asset', async (t) => {
  const port = await startApp(t);
  for (const path of [
    '/..%2fsecret.txt',
    '/..%2F..%2Fsecret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/..%5csecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/%E0%A4%A.txt',
  ]) {
    const response = await call(port, path);
    assert.equal(response.status, 404, path);
    assert.ok(!response.body.includes('outside dist'), path);
  }
  const sneaky = await call(port, '/assets/..%2findex.html');
  assert.equal(sneaky.body, INDEX);
  assert.equal(sneaky.headers['cache-control'], 'no-cache');
});

test('the API is mounted before static files and static paths only accept GET or HEAD', async (t) => {
  const port = await startApp(t);
  const health = await call(port, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(health.body);
  assert.equal(payload.llm.provider, 'openai');
  assert.ok('commit' in payload);
  for (const path of ['/api/nope', '/api', '/.local-data/workspace.json']) {
    const response = await call(port, path);
    assert.equal(response.status, 404, path);
    assert.equal(JSON.parse(response.body).code, 'NOT_FOUND', path);
  }
  for (const [path, method] of [
    ['/', 'POST'],
    ['/assets/index-abc123.js', 'PUT'],
    ['/invite/abc', 'DELETE'],
  ]) {
    const response = await call(port, path, method);
    assert.equal(response.status, 405, `${method} ${path}`);
    assert.equal(response.headers.allow, 'GET, HEAD');
  }
});

test('node server/main.ts starts on loopback, reports the release commit and stops on SIGTERM', async (t) => {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const child = spawn(process.execPath, [join(import.meta.dirname, 'main.ts')], {
    env: { PATH: process.env.PATH, PORT: String(port), GIT_COMMIT: 'test-commit' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  let output = '';
  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk;
      if (output.includes('[server]')) resolve();
    });
    child.stderr.on('data', (chunk: Buffer) => (output += chunk));
    child.once('exit', (code) => reject(new Error(`server exited early (${code}): ${output}`)));
  });
  assert.ok(output.includes(`http://127.0.0.1:${port}`), output);
  const health = await call(port, '/api/health');
  assert.equal(health.status, 200);
  const payload = JSON.parse(health.body);
  assert.equal(payload.mode, 'server');
  assert.equal(payload.commit, 'test-commit');
  assert.equal(payload.llm.provider, 'openai');
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
});
