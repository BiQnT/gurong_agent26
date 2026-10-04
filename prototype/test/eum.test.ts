import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadCatalog } from '../src/eum/catalog.ts';
import { callEum, formatKst, normalizeServiceKey } from '../src/eum/client.ts';
import { EUM_TOOL_APIS } from '../src/eum/allowlist.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const catalog = loadCatalog(path.join(repoRoot, 'data', 'eum-api-catalog.json'));
// research/api-tests/raw 의 실제 응답 기록 (probe_eum_apis.py 생성물)
const recorded = (apiId: string) =>
  JSON.parse(readFileSync(path.join(repoRoot, 'research', 'api-tests', 'raw', `${apiId}.json`), 'utf8')).response;

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fixedNow = () => new Date('2026-12-08T21:41:00Z');

describe('allowlist', () => {
  it('모든 API 가 카탈로그에 있고 GET 이며 파라미터도 카탈로그에 있다', () => {
    for (const [apiId, { params }] of Object.entries(EUM_TOOL_APIS)) {
      const api = catalog.get(apiId);
      expect(api, apiId).toBeDefined();
      expect(api!.method).toBe('GET');
      for (const name of params) expect(api!.params.map((p) => p.name)).toContain(name);
    }
  });

  it('카탈로그 파라미터에서 serviceKey 를 뺀다', () => {
    expect(catalog.get('INT_S01_004')!.params.map((p) => p.name)).toEqual(['id']);
  });
});

describe('callEum', () => {
  const api = catalog.get('INT_S01_004')!;

  it('이미 퍼센트 인코딩된 키는 한 번 풀어서 다시 인코딩한다', async () => {
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo) => jsonResponse(recorded('INT_S01_004')));
    const result = await callEum(api, { id: '1' }, { serviceKey: 'ab%2Fcd%3D', fetchImpl: fetchImpl as typeof fetch, now: fixedNow });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get('serviceKey')).toBe('ab/cd=');
    expect(url.search).toContain('serviceKey=ab%2Fcd%3D');
    expect(url.searchParams.get('id')).toBe('1');
    expect(result).toMatchObject({ ok: true, fetchedAtKst: '2026-12-09 06:41:00', data: { devId: 1 } });
  });

  it('status 가 success 가 아니면 실패로 돌려준다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: '1', status: 'fail', data: null }));
    const result = await callEum(api, { id: '1' }, { serviceKey: 'k', fetchImpl: fetchImpl as typeof fetch });
    expect(result.ok).toBe(false);
  });

  it('4xx 는 재시도하지 않고, 에러에 키를 넣지 않는다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ rspns_rslt: { rslt_cd: '40102' } }, 401));
    const result = await callEum(api, { id: '1' }, { serviceKey: 'secret-key', fetchImpl: fetchImpl as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, httpStatus: 401 });
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('응답 본문에 키가 메아리쳐 와도 에러에서 가린다', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad key: secret-key', { status: 400 }));
    const result = await callEum(api, { id: '1' }, { serviceKey: 'secret-key', fetchImpl: fetchImpl as typeof fetch });
    expect(result).toMatchObject({ ok: false, error: 'HTTP 400: bad key: ***' });
  });

  it('params 로 serviceKey 를 덮어쓸 수 없다', async () => {
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo) => jsonResponse(recorded('INT_S01_004')));
    await callEum(api, { id: '1', serviceKey: 'other' }, { serviceKey: 'mine', fetchImpl: fetchImpl as typeof fetch });
    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get('serviceKey')).toBe('mine');
  });

  it('5xx 와 네트워크 오류는 한 번 더 시도한다', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(recorded('INT_S01_004')));
    const result = await callEum(api, { id: '1' }, { serviceKey: 'k', fetchImpl: fetchImpl as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });
});

describe('helpers', () => {
  it('normalizeServiceKey 는 잘못된 인코딩이면 원문을 둔다', () => {
    expect(normalizeServiceKey('plain')).toBe('plain');
    expect(normalizeServiceKey('bad%zz')).toBe('bad%zz');
  });

  it('formatKst 는 E-UM 시각과 같은 형식이다', () => {
    expect(formatKst(new Date('2026-08-05T18:00:31Z'))).toBe('2026-08-06 03:00:31');
  });
});
