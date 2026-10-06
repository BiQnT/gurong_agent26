import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceMeters } from '../src/lib/geo.ts';
import { readLiveSnapshot, type LiveObservation, type LiveSnapshot } from '../src/lib/live.ts';
import { attachSiteContext } from './site-observations.ts';
import { createLiveChat } from './chat.ts';

const site = { id: 'site-test', name: '테스트 덕장', latitude: 36, longitude: 129.5 };
function observation(
  id: string,
  latitude: number,
  status: LiveObservation['status'],
): LiveObservation {
  return {
    device: { id, name: id, latitude, longitude: 129.5, address: '테스트 관측소' },
    status,
    temperature: 12,
    humidity: 55,
    windSpeed: 2,
    observedAt: '2026-10-04T05:00:00Z',
    observedAtRaw: '2026-10-04T05:00:00Z',
    ageMinutes: 5,
    issues: [],
  };
}
function snapshot(observations: LiveObservation[]): LiveSnapshot {
  return {
    source: '테스트 자료',
    sourceUrl: 'https://pohang-eum.kr',
    fetchedAt: '2026-10-04T05:05:00Z',
    devices: observations.map((item) => item.device),
    observations,
    selected: observations[0] ?? null,
    status: 'ok',
    llm: { configured: false, model: 'test' },
    warnings: ['실제 덕장 좌표와 검증된 판정 기준 미연결'],
  };
}

test('registered site chooses nearby current evidence over stale/invalid closer stations without mutating source', () => {
  const source = snapshot([
    observation('stale', 36.0001, 'stale'),
    observation('invalid', 36, 'invalid'),
    observation('near', 36.001, 'current'),
    observation('far', 36.02, 'current'),
  ]);
  const result = attachSiteContext(source, site);
  assert.equal(result.selected?.device.id, 'near');
  assert.equal(result.selected?.distanceM, 111);
  assert.equal(source.selected?.distanceM, undefined);
  assert.ok(!result.warnings.some((warning) => warning.includes('1km 이내')));
  assert.deepEqual(readLiveSnapshot(result).site, site);
  assert.equal(readLiveSnapshot(result).selected?.distanceM, 111);
  assert.equal(attachSiteContext(source, site, 'far').selected?.device.id, 'far');
});

test('no valid nearby observation is clearly flagged, including empty and stale-only results', () => {
  for (const observations of [
    [],
    [observation('far', 36.02, 'current')],
    [observation('stale', 36, 'stale')],
  ]) {
    const result = attachSiteContext(snapshot(observations), site);
    assert.ok(result.warnings.some((warning) => warning.includes('1km 이내')));
    assert.ok(result.warnings.some((warning) => warning.includes('가설 기준으로 규칙 함수')));
    if (!observations.length) assert.equal(result.selected, null);
  }
  assert.equal(distanceMeters(site, site), 0);
  assert.ok(
    Math.abs(
      distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }) - 111194.927,
    ) < 1,
  );
});

test('model receives computed distance and registration status without private site coordinates', async () => {
  let context: Record<string, unknown> = {};
  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    context = JSON.parse(body.messages[0].content.split('OBSERVATION_CONTEXT\n')[1]) as Record<
      string,
      unknown
    >;
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 600);
    return Response.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content:
              '관측소와의 거리는 확인되지만 검증된 기준이 없어 건조 적합 여부는 판정할 수 없어요.',
          },
        },
      ],
    });
  };
  const result = await createLiveChat(
    {
      projectRoot: process.cwd(),
      openaiApiKey: 'test-only',
      openaiModel: 'test',
      llmBaseUrl: 'https://api.openai.com/v1',
      eumServiceKey: '',
      timezoneOffset: '+09:00',
      staleAfterMinutes: 30,
    },
    fakeFetch,
  )(
    { message: '관측 확인', siteId: site.id, history: [] },
    attachSiteContext(snapshot([observation('near', 36.001, 'current')]), site),
    new AbortController().signal,
  );
  assert.equal(result.provider, 'openai');
  assert.equal(context.siteRegistered, true);
  assert.equal((context.observation as { distanceM: number }).distanceM, 111);
  assert.equal(context.site, undefined);
  assert.equal(context.siteCoordinates, undefined);
  // 판정은 경로에서 규칙 함수가 붙인다. 여기서는 붙이지 않았으므로 null 이다.
  assert.equal(context.assessment, null);
});

test('E-UM comes first within 1 km; the KMA AWS fills in only when no recent E-UM value is near', () => {
  const kma = (latitude: number, temperature = 12): LiveObservation => ({
    ...observation('kma-aws-816', latitude, 'current'),
    device: {
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      address: '기상청 AWS 816',
      latitude,
      longitude: 129.5,
      provider: 'kma',
    },
    temperature,
  });
  // 1) 가까운 E-UM 이 최신이면 기상청이 더 가까워도 E-UM
  const both = attachSiteContext(
    snapshot([observation('eum', 36.005, 'current'), kma(36.001)]),
    site,
  );
  assert.equal(both.selected?.device.id, 'eum');
  assert.ok(!both.warnings.some((warning) => warning.includes('대신 보여드려요')));
  // 2) E-UM 이 오래됐으면 1km 안의 기상청 AWS 를 쓰고 알린다
  const fallback = attachSiteContext(
    snapshot([observation('eum', 36.001, 'stale'), kma(36.006)]),
    site,
  );
  assert.equal(fallback.selected?.device.id, 'kma-aws-816');
  assert.ok(fallback.warnings.some((warning) => /기상청 구룡포 AWS\(약 667m\)/.test(warning)));
  // 화면 검증을 통과하고 기관 표시가 남는다
  assert.equal(readLiveSnapshot(fallback).selected?.device.provider, 'kma');
  // 3) 기상청도 1km 밖이면 대신 쓰지 않는다
  const tooFar = attachSiteContext(
    snapshot([observation('eum', 36.001, 'stale'), kma(36.02)]),
    site,
  );
  assert.equal(tooFar.selected?.device.id, 'eum');
  assert.ok(tooFar.warnings.some((warning) => warning.includes('1km 이내')));
  // 4) 둘 다 최신인데 크게 다르면 E-UM 장비 이상으로 보고 기상청 값으로 판단한다
  const differ = attachSiteContext(
    snapshot([observation('eum', 36.001, 'current'), kma(36.002, 19)]),
    site,
  );
  assert.equal(differ.selected?.device.id, 'kma-aws-816');
  assert.equal(differ.selectionReason, 'kma-eum-anomaly');
  assert.ok(
    differ.warnings.some((warning) =>
      warning.includes(
        '(기온 12°C·습도 55%)이 비정상이거나 기상청 구룡포 AWS(기온 19°C·습도 55%)와 크게 달라',
      ),
    ),
  );
});

test('a selected device that is gone falls back to the normal preference, and an explicit AWS pick adds no fallback warning', () => {
  const kmaDevice = {
    ...observation('kma-aws-816', 36.002, 'current'),
    device: {
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      address: 'AWS',
      latitude: 36.002,
      longitude: 129.5,
      provider: 'kma' as const,
    },
  };
  const gone = attachSiteContext(
    snapshot([observation('far', 36.003, 'current'), observation('near', 36.001, 'current')]),
    site,
    'kma-aws-816',
  );
  assert.equal(gone.selected?.device.id, 'near');
  const picked = attachSiteContext(
    snapshot([observation('near', 36.001, 'current'), kmaDevice]),
    site,
    'kma-aws-816',
  );
  assert.equal(picked.selected?.device.id, 'kma-aws-816');
  assert.ok(!picked.warnings.some((warning) => warning.includes('대신 보여드려요')));
  // 모르는 기관은 화면 검증에서 거른다
  assert.throws(() =>
    readLiveSnapshot({
      ...snapshot([kmaDevice]),
      devices: [{ ...kmaDevice.device, provider: 'other' }],
    }),
  );
});

test('an E-UM reading of 0°C and 0% is not trusted: the AWS judges, or another E-UM device, or 판정 불가', async () => {
  const { withAssessment } = await import('./assessment.ts');
  const broken = {
    ...observation('남방파제 4', 36.0026, 'current'),
    temperature: 0,
    humidity: 0,
    windSpeed: 1.48,
  };
  const aws: LiveObservation = {
    ...observation('kma-aws-816', 36.006, 'current'),
    device: {
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      address: 'AWS',
      latitude: 36.006,
      longitude: 129.5,
      provider: 'kma',
    },
    temperature: 13.9,
    humidity: 83,
    windSpeed: 2.2,
  };
  // 기상청 AWS 가 1km 안에 있으면 그 값으로 판정한다 (주의: 기온·습도 높음)
  const withAws = withAssessment(attachSiteContext(snapshot([broken, aws]), site));
  assert.equal(withAws.selected?.device.id, 'kma-aws-816');
  assert.equal(withAws.selectionReason, 'kma-eum-anomaly');
  assert.equal(withAws.assessment?.grade, '주의');
  assert.equal(readLiveSnapshot(withAws).assessment?.grade, '주의');
  // 다른 E-UM 장비가 정상이면 그 장비를 쓰고 알린다
  const other = { ...observation('남방파제 2', 36.004, 'current'), temperature: 13, humidity: 80 };
  const nextEum = withAssessment(attachSiteContext(snapshot([broken, other]), site));
  assert.equal(nextEum.selected?.device.id, '남방파제 2');
  assert.ok(
    nextEum.warnings.some((warning) =>
      warning.includes('남방파제 4 값(기온 0°C·습도 0%)이 비정상'),
    ),
  );
  // 대신할 값이 없으면 판정 불가와 이유
  const alone = withAssessment(attachSiteContext(snapshot([broken]), site));
  assert.equal(alone.selected?.device.id, '남방파제 4');
  assert.equal(alone.assessment?.grade, '판정 불가');
  assert.match(alone.assessment?.summary ?? '', /비정상/);
});

test('a device id the screen picked automatically is not an explicit pick, and a broken KMA value is not a reference', () => {
  const aws = (humidity: number): LiveObservation => ({
    ...observation('kma-aws-816', 36.006, 'current'),
    device: {
      id: 'kma-aws-816',
      name: '기상청 구룡포 AWS',
      address: 'AWS',
      latitude: 36.006,
      longitude: 129.5,
      provider: 'kma',
    },
    humidity,
  });
  const stale = observation('eum', 36.001, 'stale');
  // 화면이 지난번 자동 선택(기상청)을 그대로 보내도 자동 선택의 이유가 남는다
  const echoed = attachSiteContext(snapshot([stale, aws(55)]), site, 'kma-aws-816');
  assert.equal(echoed.selected?.device.id, 'kma-aws-816');
  assert.equal(echoed.selectionReason, 'kma-no-recent-eum');
  // 사용자가 다른 장비를 고르면 explicit
  const picked = attachSiteContext(
    snapshot([observation('eum', 36.001, 'current'), aws(55)]),
    site,
    'kma-aws-816',
  );
  assert.equal(picked.selectionReason, 'explicit');
  // 기상청 값이 비정상(습도 2%)이면 정상 E-UM 을 비정상으로 몰지 않는다
  const brokenKma = attachSiteContext(
    snapshot([observation('eum', 36.001, 'current'), aws(2)]),
    site,
  );
  assert.equal(brokenKma.selected?.device.id, 'eum');
  assert.equal(brokenKma.selectionReason, 'eum');
  // 가까운 장비는 정상, 먼 장비가 비정상이면 '가까운 … 비정상' 경고를 내지 않는다
  const farBroken = { ...observation('far', 36.005, 'current'), humidity: 0 };
  const fine = attachSiteContext(
    snapshot([observation('near', 36.001, 'current'), farBroken]),
    site,
  );
  assert.equal(fine.selected?.device.id, 'near');
  assert.ok(!fine.warnings.some((warning) => warning.includes('가까운 E-UM')));
});
