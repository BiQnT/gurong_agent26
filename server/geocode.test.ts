import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BridgeError } from './eum.ts';
import { createGeocoder, koreanAddress, readGeocodeReverse, readGeocodeSearch } from './geocode.ts';

const raw = (name: string) =>
  readFileSync(new URL(`../research/api-tests/raw/${name}`, import.meta.url), 'utf8');

function fakeNominatim(reply: (url: URL) => Response) {
  const calls: { url: URL; userAgent: string | null; at: number }[] = [];
  let clock = 1_000_000;
  const waits: number[] = [];
  const geocoder = createGeocoder(
    () => 'haepung-test/1.0 (+https://example.test)',
    async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, userAgent: new Headers(init?.headers).get('user-agent'), at: clock });
      return reply(url);
    },
    () => clock,
    async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  );
  return { geocoder, calls, waits, advance: (ms: number) => (clock += ms) };
}

test('real reverse sample becomes a Korean-order address', async () => {
  const { geocoder, calls } = fakeNominatim(
    () => new Response(raw('nominatim-reverse-guryongpo.json')),
  );
  assert.equal(await geocoder.reverse(35.9812, 129.5402), '경상북도 포항시 남구 구룡포읍 호미로');
  assert.equal(calls[0].url.pathname, '/reverse');
  assert.equal(calls[0].url.searchParams.get('lat'), '35.981200');
  assert.equal(calls[0].url.searchParams.get('accept-language'), 'ko');
  assert.equal(calls[0].userAgent, 'haepung-test/1.0 (+https://example.test)');
  // 바다 위처럼 주소가 없으면 null
  const sea = fakeNominatim(() => new Response(raw('nominatim-reverse-sea.json')));
  assert.equal(await sea.geocoder.reverse(35.9, 129.9), null);
  // 같은 조각이 이어지면 한 번만, 마을 이름은 도로가 없을 때만
  assert.equal(
    koreanAddress({
      province: '경상북도',
      city: '포항시',
      borough: '남구',
      town: '구룡포읍',
      hamlet: '병포',
    }),
    '경상북도 포항시 남구 구룡포읍 병포',
  );
  assert.equal(
    koreanAddress({ city: '서울특별시', borough: '종로구', road: '세종대로', house_number: '1' }),
    '서울특별시 종로구 세종대로 1',
  );
});

test('real search sample becomes hits limited to Korea and biased to Guryongpo', async () => {
  const { geocoder, calls } = fakeNominatim(
    () => new Response(raw('nominatim-search-guryongpo.json')),
  );
  const hits = await geocoder.search('경상북도 포항시 남구 구룡포읍 구룡포길 117');
  assert.equal(hits.length, 3);
  assert.deepEqual(hits[0], {
    latitude: 35.988666,
    longitude: 129.550742,
    label: hits[0].label,
  });
  assert.match(hits[0].label, /^경상북도 포항시 남구 구룡포읍 .*구룡포길/);
  const params = calls[0].url.searchParams;
  assert.equal(params.get('countrycodes'), 'kr');
  assert.equal(params.get('viewbox'), '129.30,36.15,129.65,35.85');
  assert.equal(params.get('format'), 'jsonv2');
});

test('requests are spaced 1.1 s apart, cached, capped and fail as GEOCODER_UNAVAILABLE', async () => {
  const fake = fakeNominatim(() => new Response('[]'));
  await Promise.all([fake.geocoder.search('구룡포읍'), fake.geocoder.search('호미로')]);
  assert.equal(fake.calls.length, 2);
  assert.ok(fake.calls[1].at - fake.calls[0].at >= 1100);
  // 같은 검색은 캐시에서 준다
  await fake.geocoder.search('구룡포읍');
  assert.equal(fake.calls.length, 2);

  const failing = fakeNominatim(() => new Response('busy', { status: 503 }));
  await assert.rejects(failing.geocoder.search('구룡포읍'), (error: unknown) => {
    assert.ok(error instanceof BridgeError);
    assert.equal(error.status, 502);
    assert.equal(error.code, 'GEOCODER_UNAVAILABLE');
    return true;
  });
  const broken = fakeNominatim(() => new Response('<html>'));
  await assert.rejects(broken.geocoder.reverse(35.98, 129.54), { code: 'GEOCODER_UNAVAILABLE' });

  // 줄이 너무 길면 Nominatim 에 보내지 않고 429
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  const slow = createGeocoder(
    () => 'ua',
    async () => {
      await gate;
      return new Response('[]');
    },
    () => 0,
    async () => undefined,
  );
  const pending = Array.from({ length: 20 }, (_, index) => slow.search(`주소 ${index}`));
  await assert.rejects(slow.search('하나 더'), { code: 'GEOCODER_BUSY' });
  release();
  await Promise.all(pending);
});

test('query and coordinates are validated before calling out', () => {
  assert.equal(
    readGeocodeSearch(new URLSearchParams({ q: '  구룡포읍   호미로 ' })),
    '구룡포읍 호미로',
  );
  for (const q of ['', 'a', 'x'.repeat(201)])
    assert.throws(() => readGeocodeSearch(new URLSearchParams({ q })), { code: 'INVALID_ADDRESS' });
  assert.deepEqual(readGeocodeReverse(new URLSearchParams({ lat: '35.98', lng: '129.54' })), {
    latitude: 35.98,
    longitude: 129.54,
  });
  for (const params of [
    { lat: '', lng: '129' },
    { lat: '91', lng: '129' },
    { lat: '35', lng: 'x' },
  ])
    assert.throws(() => readGeocodeReverse(new URLSearchParams(params)), {
      code: 'INVALID_LOCATION',
    });
});

test('the geocode routes need a logged-in account and return the geocoder result', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServer } = await import('node:http');
  const { createWorkspaceService } = await import('./workspace.ts');
  const { createApiMiddleware } = await import('./vite-api.ts');
  const directory = await mkdtemp(join(tmpdir(), 'haepung-geocode-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const asked: string[] = [];
  const middleware = createApiMiddleware(
    {
      projectRoot: directory,
      eumServiceKey: '',
      openaiApiKey: '',
      openaiModel: 'test-model',
      llmBaseUrl: 'https://api.openai.com/v1',
      staleAfterMinutes: 30,
      timezoneOffset: '+09:00',
    },
    createWorkspaceService({ dataFile: join(directory, 'workspace.json') }),
    {
      search: async (query) => {
        asked.push(query);
        return [
          { latitude: 35.98, longitude: 129.55, label: '경상북도 포항시 남구 구룡포읍 구룡포길' },
        ];
      },
      reverse: async () => '경상북도 포항시 남구 구룡포읍 호미로',
    },
  );
  const server = createServer((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    }),
  );
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  let cookie = '';
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(base + path, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  const anonymous = await call('/geocode/search?q=구룡포읍');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.code, 'AUTH_REQUIRED');
  assert.equal(asked.length, 0);
  const signup = await call('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '김덕장',
      email: 'geo@example.test',
      password: 'geo-test-password-2026',
    }),
  });
  assert.equal(signup.status, 200);
  const search = await call('/geocode/search?q=' + encodeURIComponent('구룡포읍 구룡포길'));
  assert.equal(search.status, 200);
  assert.deepEqual(search.body, {
    results: [
      { latitude: 35.98, longitude: 129.55, label: '경상북도 포항시 남구 구룡포읍 구룡포길' },
    ],
  });
  assert.deepEqual(asked, ['구룡포읍 구룡포길']);
  const reverse = await call('/geocode/reverse?lat=35.9812&lng=129.5402');
  assert.deepEqual(reverse, {
    status: 200,
    body: { address: '경상북도 포항시 남구 구룡포읍 호미로' },
  });
  assert.equal((await call('/geocode/reverse?lat=99&lng=129')).body.code, 'INVALID_LOCATION');
  assert.equal(
    (
      await call('/geocode/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    405,
  );
});
