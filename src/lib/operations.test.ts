import {
  appendLiveObservation,
  closeBatchWithApproval,
  createInitialOperationsData,
  factsFromObservation,
  getBatchReport,
  observationRecordIssue,
  OPERATIONS_STORAGE_KEY,
  recordWorkerReply,
  restoreOperationsData,
  validateOperationsData,
  commitWorkspaceOperations,
  type Batch,
  type Guidance,
  type GuidanceReply,
  type OperationsData,
} from './operations.ts';
import type { LiveObservation } from './live.ts';
import { WorkspaceError, type OperationsEnvelope } from './workspace.ts';

// Deterministic unit fixtures are used only in this test file, never in the application.
// Run: node --experimental-strip-types --test src/lib/operations.test.ts
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: ${JSON.stringify(actual)}`,
  );
}
const recordingTime = '2026-10-03T01:05:00Z';
const current: LiveObservation = {
  device: {
    id: 'device-test',
    name: '관측기 테스트',
    address: '테스트 주소',
    latitude: 35.9,
    longitude: 129.5,
  },
  temperature: 12.6,
  humidity: 65,
  windSpeed: 2.4,
  observedAt: '2026-10-03T01:00:00Z',
  observedAtRaw: '2026-10-03T01:00:00Z',
  ageMinutes: 5,
  status: 'current',
  issues: [],
};
function emptyBatch(): Batch {
  return {
    id: 'batch-test',
    name: '운영자가 입력한 배치',
    fish: '꽁치',
    quantity: 37,
    status: 'ongoing',
    startedAt: '2026-10-03T00:50:00Z',
    note: '직접 입력한 메모',
    observations: [],
    logs: [
      {
        id: 'start-log',
        at: '2026-10-03T00:50:00Z',
        title: '시작 승인',
        detail: '운영자 입력',
        kind: 'approval',
      },
    ],
  };
}
const preparedGuidance = (): Guidance => ({
  id: 'guide-test',
  batchId: 'batch-test',
  title: '건조 상태 확인',
  original: '건조 상태를 확인해주세요.',
  translated: 'Vui lòng kiểm tra tình trạng cá.',
  language: 'vi',
  facts: factsFromObservation(current),
  approvedAt: recordingTime,
  preparedAt: recordingTime,
  channel: 'local-preview',
  status: 'prepared',
  replies: [],
});
const serialize = (data: OperationsData | Record<string, unknown>) =>
  JSON.stringify({ version: 2, ...data });

assert(
  OPERATIONS_STORAGE_KEY === 'guryongpo.operations.live.v2',
  'Actual records must use a new namespace instead of the former demonstration history',
);
equal(
  createInitialOperationsData(),
  { batches: [], guidance: [] },
  'Fresh workspace must contain no fictional production or worker records',
);
for (const raw of [null, '', '{', 'null', '[]', '{"version":1,"batches":[],"guidance":[]}']) {
  equal(
    restoreOperationsData(raw),
    { batches: [], guidance: [] },
    'Missing, invalid, or old-version data must start empty',
  );
}
const noFacts = factsFromObservation(null);
assert(
  noFacts.grade === '판정 불가' && noFacts.observedAt === null && noFacts.distanceM === null,
  'No source must never fabricate a grade, observation clock, or site distance',
);
assert(
  [noFacts.temperature, noFacts.humidity, noFacts.wind].every((value) => value === null),
  'No source must leave all measurements empty',
);
console.log(
  'Workspace: empty defaults, new storage namespace, old-version isolation, and no fabricated facts passed.',
);

assert(
  observationRecordIssue(current, recordingTime) === null,
  'A recent complete observation with a known timestamp must be recordable',
);
const recorded = appendLiveObservation(emptyBatch(), current, recordingTime, 'observation-log');
assert(
  recorded.observations.length === 1 &&
    recorded.observations[0].temperature === current.temperature,
  'Recording must preserve the actual source measurement',
);
assert(
  recorded.observations[0].at === recordingTime &&
    recorded.observations[0].observedAt === current.observedAt,
  'Recording time and source observation time must remain distinct',
);
assert(
  recorded.observations[0].sourceDeviceId === current.device.id &&
    recorded.observations[0].sourceDeviceName === current.device.name,
  'Actual source identity must be retained',
);
assert(
  recorded.observations[0].distanceM === null,
  'Unknown site coordinates must not produce a made-up distance',
);
assert(
  appendLiveObservation(recorded, current, recordingTime, 'duplicate') === recorded,
  'The same source observation must not be recorded twice',
);
const invalidSources: LiveObservation[] = [
  { ...current, status: 'stale' },
  { ...current, status: 'invalid' },
  { ...current, observedAt: '2026-01-15T01:00:00Z', ageMinutes: 400000, status: 'current' },
  { ...current, observedAt: '2026-10-03T01:06:00Z', ageMinutes: 0 },
  { ...current, temperature: null },
  { ...current, humidity: 101 },
  { ...current, windSpeed: Number.NaN },
  { ...current, observedAt: null },
  { ...current, issues: ['원천 시각의 시간대가 없어 확인 필요'] },
  { ...current, device: { ...current.device, id: '' } },
];
for (const [index, live] of invalidSources.entries()) {
  assert(
    observationRecordIssue(live, recordingTime) !== null,
    `Untrustworthy source ${index} must explain why it cannot be recorded`,
  );
  const initial = emptyBatch();
  assert(
    appendLiveObservation(initial, live, recordingTime, 'invalid') === initial,
    `Untrustworthy source ${index} must never become production evidence`,
  );
}
assert(
  observationRecordIssue(current, '2026-10-03T01:31:00Z') !== null,
  'A formerly current response must be rechecked against the actual recording time',
);
assert(
  observationRecordIssue(current, '2026-10-03T01:30:00Z') === null,
  'The 30-minute UI freshness boundary is inclusive',
);
const archivedFacts = factsFromObservation({ ...current, status: 'stale' });
assert(
  archivedFacts.temperature === current.temperature &&
    archivedFacts.sourceStatus === 'stale' &&
    archivedFacts.grade === '판정 불가',
  'Archived observations may remain reference values without becoming a current grade',
);
const timezoneIssue =
  '원천 시각에 시간대가 없어 +09:00으로 해석했습니다. 원자료 확인이 필요합니다.';
const uncertainSource = { ...current, status: 'stale' as const, issues: [timezoneIssue] };
const provenanceFacts = factsFromObservation(uncertainSource);
const provenanceData: OperationsData = {
  batches: [emptyBatch()],
  guidance: [{ ...preparedGuidance(), facts: provenanceFacts }],
};
assert(
  restoreOperationsData(serialize(provenanceData)).guidance[0].facts.sourceIssues?.[0] ===
    timezoneIssue,
  'An approved reference must preserve the original source timezone warning across persistence',
);
uncertainSource.issues.push('나중에 추가한 경고');
assert(
  provenanceFacts.sourceIssues?.length === 1,
  'Approved source warnings must be an independent snapshot',
);
console.log(
  'Observations: actual timestamps and devices, missing site distance, duplicate protection, current-age boundary, and archived/invalid rejection passed.',
);

const source = recorded.observations[0];
const mixed: Batch = {
  ...recorded,
  observations: [
    { ...source, temperature: 2, humidity: 40, wind: 2 },
    { ...source, temperature: 6, humidity: null, wind: 6, alert: true },
    { ...source, temperature: 90, humidity: 90, wind: 90, distanceM: 1001, alert: true },
    { ...source, temperature: 4, humidity: 60, wind: 4, distanceM: 1000 },
  ],
};
const report = getBatchReport(mixed);
equal(
  report.temperature,
  { mean: 4, min: 2, max: 6 },
  'Distant measurements must not affect temperature statistics',
);
equal(
  report.humidity,
  { mean: 50, min: 40, max: 60 },
  'Null humidity must not erase available values from other fields',
);
equal(
  report.wind,
  { mean: 4, min: 2, max: 6 },
  'Wind range must preserve finite partial observations',
);
assert(
  report.totalSamples === 4 && report.validSamples === 2 && report.missingRate === 50,
  'Missing and known-out-of-range observations must be excluded from valid count',
);
assert(
  report.distanceM === 1001 && !report.distanceValidated,
  'Unknown distance must remain explicitly unvalidated even when other source distances are present',
);
const actualSummary = getBatchReport(recorded);
assert(
  actualSummary.validSamples === 1 &&
    actualSummary.distanceM === null &&
    !actualSummary.distanceValidated,
  'An actual observation can be retained without falsely claiming distance validation',
);
const emptyReport = getBatchReport(emptyBatch());
assert(
  emptyReport.temperature.mean === null &&
    emptyReport.distanceM === null &&
    emptyReport.totalSamples === 0,
  'An empty batch must not invent zero-valued measurements',
);
console.log(
  'Reports: partial nulls, range statistics, distance boundary, unvalidated location, and empty measurements passed.',
);

const closeAt = '2026-10-03T01:06:00Z';
const closed = closeBatchWithApproval(recorded, 'completed', '회수 완료 메모', closeAt, 'end-log');
assert(
  closed.status === 'completed' &&
    closed.endedAt === closeAt.replace('Z', '.000Z') &&
    closed.quantity === 37,
  'Operator completion must preserve actual time and entered quantity',
);
assert(
  recorded.status === 'ongoing' && recorded.endedAt === undefined,
  'Completion must not mutate the previous batch',
);
assert(
  closeBatchWithApproval(closed, 'cancelled', '', closeAt, 'other') === closed,
  'A terminal batch must not transition again',
);
const adjusted = closeBatchWithApproval(
  recorded,
  'completed',
  '',
  '2026-10-03T01:04:00Z',
  'clock-adjusted',
);
assert(
  Date.parse(adjusted.endedAt!) >= Date.parse(recordingTime),
  'System-clock adjustment must not move the end before an existing observation record',
);
const data: OperationsData = { batches: [recorded], guidance: [preparedGuidance()] };
const reply: GuidanceReply = {
  id: 'reply-test',
  at: closeAt,
  kind: 'completed',
  text: 'Đã hoàn thành',
  simulated: true,
};
const responded = recordWorkerReply(data, data.guidance[0].id, reply);
assert(
  responded.guidance[0].status === 'completed' && responded.guidance[0].replies[0].simulated,
  'A simulated completion must remain explicitly marked',
);
assert(
  responded.batches[0].status === 'ongoing' &&
    !responded.batches[0].endedAt &&
    !responded.batches[0].report,
  'A worker response simulation must never complete production',
);
assert(
  responded.batches[0].logs[responded.batches[0].logs.length - 1].title.includes('시뮬레이션'),
  'Simulation history must never look like a received worker event',
);
assert(
  data.guidance[0].status === 'prepared' &&
    data.batches[0].logs.length + 1 === responded.batches[0].logs.length,
  'Worker transition must preserve prior state',
);
assert(
  recordWorkerReply(responded, data.guidance[0].id, { ...reply, id: 'duplicate-reply' }) ===
    responded,
  'Repeated completion must not duplicate activity',
);
console.log(
  'Transitions: operator approval, actual entered quantities, event chronology, explicit simulation, and unchanged batch state passed.',
);

const savedText = serialize(data);
assert(
  restoreOperationsData(savedText).batches[0].name === data.batches[0].name,
  'Valid actual local records must round trip',
);
const absentObservationData: OperationsData = {
  batches: [emptyBatch()],
  guidance: [{ ...preparedGuidance(), facts: noFacts }],
};
assert(
  restoreOperationsData(serialize(absentObservationData)).guidance[0].facts.observedAt === null,
  'Prepared guidance with no observation must survive reload',
);
const partialFactsData: OperationsData = {
  ...data,
  guidance: [
    {
      ...preparedGuidance(),
      facts: factsFromObservation({ ...current, windSpeed: null, status: 'invalid' }),
    },
  ],
};
assert(
  restoreOperationsData(serialize(partialFactsData)).guidance[0].facts.wind === null,
  'Partial source measurements must remain reference data on reload',
);
const invalidStates: Record<string, unknown>[] = [
  { ...data, batches: [{ ...recorded, quantity: undefined }] },
  { ...data, batches: [{ ...recorded, quantity: '37' }] },
  { ...data, batches: [{ ...recorded, status: 'waiting' }] },
  { ...data, batches: [{ ...recorded, startedAt: '2026-02-30T00:00:00Z' }] },
  { ...data, batches: [{ ...recorded, observations: [{ ...source, sourceDeviceId: null }] }] },
  { ...data, batches: [{ ...recorded, observations: [{ ...source, observedAt: null }] }] },
  { ...data, batches: [{ ...recorded, observations: [{ ...source, humidity: 101 }] }] },
  { ...data, guidance: [{ ...data.guidance[0], channel: 'sent' }] },
  { ...data, guidance: [{ ...data.guidance[0], preparedAt: 'invalid' }] },
  { ...data, guidance: [{ ...data.guidance[0], replies: [{ ...reply, simulated: false }] }] },
  { ...data, guidance: [{ ...data.guidance[0], facts: { ...noFacts, distanceM: -1 } }] },
];
for (const [index, invalid] of invalidStates.entries()) {
  equal(
    restoreOperationsData(serialize(invalid)),
    createInitialOperationsData(),
    `Malformed nested state ${index} must fall back without inventing history`,
  );
}
console.log(
  'Persistence: real records, nullable reference facts, nested source validation, simulated replies, and empty fallback passed.',
);

const shared: OperationsData = {
  batches: [recorded],
  guidance: [{ ...preparedGuidance(), channel: 'workspace' }],
};
const firstWorker: GuidanceReply = {
  ...reply,
  id: 'worker-one-completed',
  simulated: false,
  userId: 'worker-one',
  userName: '응우옌',
};
const firstRealResponse = recordWorkerReply(shared, 'guide-test', firstWorker);
const secondRealResponse = recordWorkerReply(firstRealResponse, 'guide-test', {
  ...firstWorker,
  id: 'worker-two-completed',
  userId: 'worker-two',
  userName: '린',
});
assert(
  validateOperationsData(secondRealResponse),
  'Shared records with identified real replies must validate',
);
assert(
  secondRealResponse.guidance[0].replies.length === 2,
  'Each worker must be able to report completion independently',
);
assert(
  secondRealResponse.batches[0].status === 'ongoing',
  'Real worker completion must never terminate a batch',
);
assert(
  secondRealResponse.batches[0].logs.at(-1)?.title.includes('린') &&
    !secondRealResponse.batches[0].logs.at(-1)?.title.includes('시뮬레이션'),
  'Real activity must name the responding worker',
);
assert(
  recordWorkerReply(secondRealResponse, 'guide-test', {
    ...firstWorker,
    id: 'repeat-worker-one',
  }) === secondRealResponse,
  'A repeated completion from the same worker must not duplicate activity',
);
assert(
  !validateOperationsData({
    ...shared,
    guidance: [{ ...shared.guidance[0], replies: [{ ...firstWorker, userId: undefined }] }],
  }),
  'A real response without an account identity must be rejected',
);
assert(
  !validateOperationsData({
    ...shared,
    guidance: [{ ...shared.guidance[0], replies: [{ ...firstWorker, userName: '' }] }],
  }),
  'A real response without a display name must be rejected',
);
const located = appendLiveObservation(
  emptyBatch(),
  { ...current, distanceM: 280 },
  recordingTime,
  'located-log',
);
assert(
  located.observations[0].distanceM === 280 &&
    factsFromObservation({ ...current, distanceM: 280 }).distanceM === 280,
  'Registered-site geometry must survive observation and guidance snapshots',
);
assert(
  getBatchReport(located).distanceValidated,
  'A known nearby site distance must be represented in reports',
);
const withGap: Batch = {
  ...located,
  observations: [
    ...located.observations,
    {
      ...located.observations[0],
      sourceDeviceId: 'collector-missing',
      temperature: null,
      humidity: null,
      wind: null,
      distanceM: null,
    },
  ],
};
assert(
  getBatchReport(withGap).distanceValidated && getBatchReport(withGap).missingRate === 50,
  'A missing sample counts toward the missing rate, not against distance validation',
);
assert(
  !getBatchReport({ ...withGap, observations: withGap.observations.slice(1) }).distanceValidated,
  'A batch with only missing samples has no validated distance',
);

let remote: OperationsEnvelope = { data: shared, revision: 1 };
let writes = 0;
let transforms = 0;
const newBatch = { ...emptyBatch(), id: 'concurrent-new-batch' };
const committed = await commitWorkspaceOperations(
  'site-one',
  (latest) => {
    transforms += 1;
    return { ...latest, batches: [...latest.batches, newBatch] };
  },
  {
    operations: async () => structuredClone(remote),
    saveOperations: async (_siteId, envelope) => {
      writes += 1;
      if (writes === 1) {
        remote = { data: recordWorkerReply(remote.data, 'guide-test', firstWorker), revision: 2 };
        throw new WorkspaceError('다른 응답이 먼저 도착했어요.', 409);
      }
      assert(envelope.revision === remote.revision, 'Retry must use the newly fetched revision');
      remote = { data: envelope.data, revision: remote.revision + 1 };
      return structuredClone(remote);
    },
  },
);
assert(
  writes === 2 && transforms === 2,
  'An owner transform must rebase after a revision conflict',
);
assert(
  committed.data.guidance[0].replies[0].userId === 'worker-one',
  'Concurrent worker responses must survive owner saves',
);
assert(
  committed.data.batches[0].logs.some((log) => log.title.includes('응우옌')),
  'Concurrent worker activity logs must survive owner saves',
);
assert(
  committed.data.batches.filter((batch) => batch.id === newBatch.id).length === 1,
  'Retry must not duplicate an owner-created batch',
);

let failedSave = false;
try {
  await commitWorkspaceOperations('site-one', (latest) => ({ ...latest, batches: [] }), {
    operations: async () => ({ data: createInitialOperationsData(), revision: 0 }),
    saveOperations: async () => {
      throw new WorkspaceError('연결이 끊어졌어요.', 0);
    },
  });
} catch {
  failedSave = true;
}
assert(failedSave, 'A failed shared save must reject instead of returning a successful envelope');
let currentScope = true;
let staleWrites = 0;
try {
  await commitWorkspaceOperations(
    'old-site',
    (latest) => ({ ...latest, batches: [newBatch] }),
    {
      operations: async () => {
        currentScope = false;
        return { data: createInitialOperationsData(), revision: 0 };
      },
      saveOperations: async (siteId, envelope) => {
        staleWrites += 1;
        assert(siteId === 'old-site', 'Scope is explicit');
        return envelope;
      },
    },
    () => currentScope,
  );
} catch {
  /* Changing sites cancels the pending transform before a write. */
}
assert(
  staleWrites === 0,
  'A site change while loading must prevent the old operation from being written',
);
console.log(
  'Shared operations: account-stamped replies, per-worker deduplication, unchanged batch state, geometry snapshots, conflict rebasing, failure reporting, and scope cancellation passed.',
);

const answeredQuestion: GuidanceReply = {
  ...firstWorker,
  id: 'worker-question',
  kind: 'question',
  text: '어느 건조대부터 확인할까요?',
  answer: {
    text: '입구 쪽 건조대부터 확인해 주세요.',
    at: closeAt,
    userId: 'owner-one',
    userName: '운영자',
  },
};
const answeredData: OperationsData = {
  ...shared,
  guidance: [{ ...shared.guidance[0], replies: [answeredQuestion] }],
};
assert(
  validateOperationsData(answeredData),
  'A real question may contain a timestamped owner answer',
);
assert(
  restoreOperationsData(serialize(answeredData)).guidance[0].replies[0].answer?.text ===
    answeredQuestion.answer?.text,
  'The answer must survive record validation and persistence',
);
const answerAfterResponse = recordWorkerReply(answeredData, 'guide-test', {
  ...firstWorker,
  id: 'completion-after-answer',
});
equal(
  answerAfterResponse.guidance[0].replies[0].answer,
  answeredQuestion.answer,
  'A later worker response must preserve the owner answer unchanged',
);
assert(
  answerAfterResponse.batches[0].status === 'ongoing',
  'Answering and responding must not end a batch',
);
const invalidAnswers: unknown[] = [
  { ...answeredQuestion, kind: 'completed' },
  { ...answeredQuestion, simulated: true },
  { ...answeredQuestion, answer: null },
  { ...answeredQuestion, answer: { ...answeredQuestion.answer, text: ' ' } },
  { ...answeredQuestion, answer: { ...answeredQuestion.answer, text: 'x'.repeat(1001) } },
  { ...answeredQuestion, answer: { ...answeredQuestion.answer, at: '2026-02-30T00:00:00Z' } },
  { ...answeredQuestion, answer: { ...answeredQuestion.answer, at: recordingTime } },
  { ...answeredQuestion, answer: { ...answeredQuestion.answer, userId: '' } },
  { ...answeredQuestion, answer: { ...answeredQuestion.answer, userName: undefined } },
];
for (const [index, invalidAnswer] of invalidAnswers.entries()) {
  assert(
    !validateOperationsData({
      ...shared,
      guidance: [{ ...shared.guidance[0], replies: [invalidAnswer] }],
    }),
    `Malformed or unauthorized answer shape ${index} must fail validation`,
  );
}
assert(
  validateOperationsData({
    ...shared,
    guidance: [
      {
        ...shared.guidance[0],
        replies: [
          { ...answeredQuestion, answer: { ...answeredQuestion.answer, text: 'x'.repeat(1000) } },
        ],
      },
    ],
  }),
  'The 1000-character answer boundary must be inclusive',
);
const answerPreservingSave = await commitWorkspaceOperations(
  'site-one',
  (latest) => ({
    ...latest,
    batches: latest.batches.map((batch) => ({ ...batch, note: '추가 메모' })),
  }),
  {
    operations: async () => ({ data: structuredClone(answeredData), revision: 5 }),
    saveOperations: async (_siteId, envelope) => ({ ...envelope, revision: envelope.revision + 1 }),
  },
);
equal(
  answerPreservingSave.data.guidance[0].replies[0].answer,
  answeredQuestion.answer,
  'An owner production update must retain existing question answers',
);
console.log(
  'Owner answers: real questions only, identified authors, ordered timestamps, length boundary, round-trip persistence, and worker/owner update preservation passed.',
);

// 기상청 대체 관측 (ADR 0013): 출처마다 거리·시각 한도가 다르다.
const gridLive: LiveObservation = {
  ...current,
  device: {
    ...current.device,
    id: 'kma-grid-105-94',
    name: '기상청 초단기실황 (격자 105,94)',
    provider: 'kma-grid',
  },
  observedAt: '2026-10-03T00:00:00Z',
  ageMinutes: 65,
  distanceM: 2400,
};
assert(
  observationRecordIssue(gridLive, recordingTime) === null,
  'An hourly grid nowcast up to 120 minutes old can be recorded',
);
assert(
  observationRecordIssue(
    { ...gridLive, observedAt: '2026-10-02T22:50:00Z', ageMinutes: 135 },
    recordingTime,
  ) !== null,
  'An older grid nowcast is not recorded',
);
assert(
  observationRecordIssue(
    {
      ...current,
      device: { ...current.device, id: 'kma-aws-816', provider: 'kma' },
      observedAt: '2026-10-03T00:20:00Z',
      ageMinutes: 45,
    },
    recordingTime,
  ) !== null,
  'A 1-minute station still needs a value within 30 minutes',
);
const kmaReport = getBatchReport({
  ...emptyBatch(),
  observations: [
    {
      at: recordingTime,
      observedAt: '2026-10-03T01:00:00Z',
      sourceDeviceId: 'kma-aws-816',
      sourceDeviceName: '기상청 구룡포 AWS',
      temperature: 5,
      humidity: 50,
      wind: 3,
      distanceM: 2200,
      alert: false,
    },
  ],
});
assert(
  kmaReport.distanceValidated && kmaReport.temperature.mean === 5,
  'A KMA sample within 5 km counts in the batch report',
);
const gradedFacts = {
  grade: '주의',
  temperature: 12.6,
  humidity: 65,
  wind: 2.4,
  distanceM: 3200,
  observedAt: '2026-10-03T01:00:00Z',
  sourceDeviceName: '기상청 구룡포 AWS',
  sourceStatus: 'current' as const,
  sourceIssues: [],
};
assert(
  validateOperationsData({
    batches: [emptyBatch()],
    guidance: [{ ...preparedGuidance(), facts: gradedFacts }],
  }),
  'Guidance facts graded from a KMA source within 5 km are stored (widened rule, ADR 0006 order)',
);
assert(
  !validateOperationsData({
    batches: [emptyBatch()],
    guidance: [{ ...preparedGuidance(), facts: { ...gradedFacts, distanceM: 5200 } }],
  }),
  'Graded facts beyond the widest 5 km limit are rejected',
);
console.log(
  'KMA fallback: per-source record age, 5 km report gate and widened facts limit passed.',
);
