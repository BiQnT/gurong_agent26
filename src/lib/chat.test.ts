import {
  createChatTransport,
  getDemoAssessment,
  readChatReply,
  recentChatHistory,
  type ChatRequest,
  type ProgressStep,
} from './chat.ts';

// Native Node can run this file without a test framework or Node-specific type packages.
// Run: node --experimental-strip-types --test src/lib/chat.test.ts
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectReject(operation: Promise<unknown>, expected: RegExp): Promise<void> {
  try {
    await operation;
  } catch (error) {
    assert(
      error instanceof Error && expected.test(`${error.name}: ${error.message}`),
      `Unexpected error: ${String(error)}`,
    );
    return;
  }
  throw new Error(`Expected rejection matching ${expected}`);
}

const request: ChatRequest = {
  message: '지금 건조해도 괜찮을까요?',
  siteId: 'guryongpo-01',
  scenario: 'normal',
  history: [],
};

const options = () => ({
  signal: new AbortController().signal,
  onProgress: (_steps: ProgressStep[]) => {},
});

async function runTests() {
  const longHistory: ChatRequest['history'] = Array.from({ length: 60 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `대화 ${index}`,
  }));
  const recent = recentChatHistory(longHistory);
  assert(recent.length === 12 && recent[0].content === '대화 48', 'Keep only recent context');
  assert(longHistory.length === 60, 'Trimming context must not remove saved messages');
  const koreanHistory = recentChatHistory(
    longHistory.map((entry) => ({ ...entry, content: '한'.repeat(1500) })),
  );
  assert(koreanHistory.length === 1, 'History limits must count UTF-8 bytes, not characters');
  const specialHistory = recentChatHistory(
    longHistory.map((entry) => ({ ...entry, content: '\u0000'.repeat(1500) })),
  );
  assert(specialHistory.length === 0, 'History limits must account for JSON escaping');

  const observation = {
    device: {
      id: '1',
      name: '관측기 테스트',
      address: '주소 테스트',
      latitude: 35.99,
      longitude: 129.56,
    },
    temperature: 26.4,
    humidity: 70,
    windSpeed: 2.1,
    observedAt: '2026-08-06T12:00:00+09:00',
    observedAtRaw: '2026-08-06 12:00:00',
    ageMinutes: 60000,
    status: 'stale',
    issues: ['보관된 과거 자료'],
  };
  const liveReply = readChatReply({
    content: '보관된 실측값을 확인했습니다.',
    suggestions: [],
    observation,
    provider: 'openai',
    sourceFetchedAt: '2026-10-03T00:00:00Z',
  });
  assert(
    liveReply.provider === 'openai' &&
      liveReply.observation?.observedAt === observation.observedAt &&
      liveReply.observation?.status === 'stale',
    'Actual source and stale timestamp must survive parsing',
  );
  assert(!liveReply.assessment, 'An actual observation must not create a drying grade');
  await expectReject(
    Promise.resolve().then(() =>
      readChatReply({
        content: '관측',
        suggestions: [],
        observation: { ...observation, humidity: 101 },
      }),
    ),
    /관측 데이터/,
  );
  await expectReject(
    Promise.resolve().then(() =>
      readChatReply({
        content: '관측',
        suggestions: [],
        observation: { ...observation, observedAt: '2026-08-06 12:00:00' },
      }),
    ),
    /관측 데이터/,
  );
  await expectReject(
    Promise.resolve().then(() =>
      readChatReply({
        content: '관측',
        suggestions: [],
        observation: { ...observation, temperature: null },
      }),
    ),
    /상태와 관측값/,
  );

  const fixture = getDemoAssessment();
  assert(
    fixture.grade === '적합' && fixture.distanceM === 320,
    'Normal assessment fixture changed',
  );
  assert(
    fixture.observedAt === '2026-01-15T09:00:00+09:00',
    'Fixture must use the explicit demo observation date',
  );
  fixture.reasons.push('mutation');
  fixture.temperature = 99;
  assert(
    !getDemoAssessment().reasons.includes('mutation') && getDemoAssessment().temperature === 3.2,
    'Each fixture must be independent',
  );
  assert(getDemoAssessment('caution').grade === '주의', 'Caution fixture missing');
  assert(getDemoAssessment('unsuitable').grade === '부적합', 'Unsuitable fixture missing');
  const unavailable = getDemoAssessment('unavailable');
  assert(
    unavailable.grade === '판정 불가' && (unavailable.distanceM ?? 0) > 1000,
    'Distant observation must prevent assessment',
  );
  assert(
    [unavailable.temperature, unavailable.humidity, unavailable.windSpeed].every(
      (value) => value === null,
    ),
    'Missing values must not be fabricated',
  );

  const mock = createChatTransport('');
  const cancelled = new AbortController();
  const received: ProgressStep[][] = [];
  const pending = mock.send(request, {
    signal: cancelled.signal,
    onProgress: (steps) => received.push(steps),
  });
  cancelled.abort();
  await expectReject(pending, /AbortError/);
  assert(
    received.length === 1 && received[0][0].status === 'running',
    'Cancellation must stop progress and prevent a result',
  );

  const preCancelled = new AbortController();
  preCancelled.abort();
  await expectReject(
    mock.send(request, {
      signal: preCancelled.signal,
      onProgress: () => {
        throw new Error('Unexpected progress');
      },
    }),
    /AbortError/,
  );
  await expectReject(mock.send({ ...request, message: '   ' }, options()), /메시지를 입력/);

  const progress: ProgressStep[][] = [];
  const naturalIntents = [
    ['널었어', 'start-batch'],
    ['널었다', 'start-batch'],
    ['다 널었어요', 'start-batch'],
    ['회수했어', 'end-batch'],
    ['회수했다', 'end-batch'],
    ['거뒀어', 'end-batch'],
    ['작업 안내', 'guidance'],
    ['습도 주의 사항을 베트남어로 보여줘', 'guidance'],
    ['건조 작업 번역', 'guidance'],
    ['근로자에게 바람 상태 알려줘', 'guidance'],
    ['오늘 건조 환경을 전달하고 싶어', 'guidance'],
  ] as const;
  const [
    assessmentReply,
    startReply,
    endReply,
    guidanceReply,
    longReply,
    forecastReply,
    ...extraReplies
  ] = await Promise.all([
    mock.send(request, { ...options(), onProgress: (steps) => progress.push(steps) }),
    mock.send({ ...request, message: '새 건조 작업 시작하기' }, options()),
    mock.send({ ...request, message: '작업 종료 기록하기' }, options()),
    mock.send({ ...request, message: '건조 판정 기준을 설명해 줘' }, options()),
    mock.send(
      {
        ...request,
        message: '지금 우리 팀에서 논의하고 있는 상황에 관해서 질문이 있습니다. '.repeat(80),
      },
      options(),
    ),
    mock.send({ ...request, message: '내일 바람은 어떨까요?' }, options()),
    ...naturalIntents.map(([message]) => mock.send({ ...request, message }, options())),
    ...(['caution', 'unsuitable', 'unavailable'] as const).map((scenario) =>
      mock.send({ ...request, scenario }, options()),
    ),
  ]);
  assert(
    assessmentReply.assessment?.grade === '적합' &&
      assessmentReply.content.includes('샘플 관측 기준'),
    'Assessment reply must identify its fixture status',
  );
  assert(
    assessmentReply.content.length < 180 && !assessmentReply.content.includes('3.2'),
    'Assessment content must be concise without duplicating card metrics',
  );
  assert(
    progress.length === 4 && progress.every((steps) => steps.length === 3),
    'Expected three stages plus completed state',
  );
  assert(
    progress[0][0].status === 'running' && progress[3].every((step) => step.status === 'done'),
    'Progress snapshots must be immutable',
  );
  assert(
    startReply.action === 'start-batch' && !!startReply.assessment,
    'Start action must include evidence',
  );
  assert(
    !startReply.content.includes('함께 남겨'),
    'Start reply must not claim assessment persistence',
  );
  assert(endReply.action === 'end-batch', 'End action missing');
  assert(
    !guidanceReply.action && !guidanceReply.assessment,
    'Criteria explanation should not open worker guidance',
  );
  assert(
    !longReply.action && longReply.content.includes('목업'),
    'Long unrelated messages must get scope guidance without a panel action',
  );
  assert(
    !forecastReply.action && forecastReply.content.includes('예측이 연결되어 있지'),
    'Future questions must not invent a forecast or panel action',
  );
  naturalIntents.forEach(([message, action], index) =>
    assert(extraReplies[index].action === action, `Natural intent failed: ${message}`),
  );
  const scenarioReplies = extraReplies.slice(naturalIntents.length);
  assert(
    scenarioReplies.map((reply) => reply.assessment?.grade).join(',') === '주의,부적합,판정 불가',
    'Scenario grades must remain deterministic',
  );
  assert(
    scenarioReplies[2].assessment?.temperature === null &&
      scenarioReplies[2].content.includes('추정하지 않았어요'),
    'Unavailable scenario must preserve missing data uncertainty',
  );
  console.log(
    'Mock transport: fixtures, stage snapshots, action intents, uncertainty, and cancellation passed.',
  );

  const originalFetch = globalThis.fetch;
  try {
    const http = createChatTransport('https://example.test/');
    let sentBody: ChatRequest | undefined;
    globalThis.fetch = async (input, init) => {
      assert(input === 'https://example.test/api/chat', 'API URL should have one separator');
      assert(init?.method === 'POST', 'Chat API must use POST');
      assert(init?.signal instanceof AbortSignal, 'Abort signal must reach fetch');
      sentBody = JSON.parse(String(init?.body)) as ChatRequest;
      return Response.json({
        content: '서버가 보낸 완성 응답이에요.',
        assessment: getDemoAssessment(),
        suggestions: ['작업 시작하기'],
      });
    };
    const actual = await http.send(request, options());
    assert(
      actual.content.includes('완성 응답') && actual.assessment?.humidity === 52,
      'HTTP reply was not read',
    );
    assert(
      sentBody?.message === request.message && sentBody?.siteId === request.siteId,
      'Request contract must be preserved',
    );

    globalThis.fetch = async (input) => {
      assert(input === '/api/chat', 'Default transport must use real same-origin HTTP');
      return Response.json({
        content: '실제 서버 응답',
        suggestions: [],
        observation,
        provider: 'openai',
      });
    };
    const defaultReply = await createChatTransport().send(request, options());
    assert(
      defaultReply.provider === 'openai' && defaultReply.observation?.humidity === 70,
      'Default application transport must preserve actual observation',
    );

    globalThis.fetch = async () => Response.json({ content: '', suggestions: [] });
    await expectReject(http.send(request, options()), /응답 형식/);
    globalThis.fetch = async () =>
      Response.json({
        content: '판정',
        suggestions: [],
        assessment: { ...getDemoAssessment(), distanceM: 6000 },
      });
    await expectReject(http.send(request, options()), /환경 판정/);
    globalThis.fetch = async () =>
      Response.json({
        content: '판정',
        suggestions: [],
        assessment: { ...getDemoAssessment(), temperature: null },
      });
    await expectReject(http.send(request, options()), /환경 판정/);
    globalThis.fetch = async () =>
      Response.json({ content: '작업', suggestions: [], action: 'delete-all' });
    await expectReject(http.send(request, options()), /작업 안내 형식/);
    globalThis.fetch = async () =>
      Response.json({ content: '작업', suggestions: [], action: ['start-batch'] });
    await expectReject(http.send(request, options()), /작업 안내 형식/);
    globalThis.fetch = async () =>
      Response.json({
        content: '판정',
        suggestions: [],
        assessment: { ...getDemoAssessment(), grade: ['적합'] },
      });
    await expectReject(http.send(request, options()), /환경 판정/);
    globalThis.fetch = async () =>
      Response.json({
        content: '판정',
        suggestions: [],
        assessment: { ...getDemoAssessment(), observedAt: '2026' },
      });
    await expectReject(http.send(request, options()), /환경 판정/);
    globalThis.fetch = async () => new Response('invalid json', { status: 200 });
    await expectReject(http.send(request, options()), /응답을 읽을/);
    globalThis.fetch = async () => new Response('rate limited', { status: 429 });
    await expectReject(http.send(request, options()), /요청이 잠시/);
    globalThis.fetch = async () => {
      throw new TypeError('network error');
    };
    await expectReject(http.send(request, options()), /서버에 연결/);

    const serverAbort = new AbortController();
    globalThis.fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Stopped', 'AbortError')),
          { once: true },
        );
      });
    const serverPending = http.send(request, { ...options(), signal: serverAbort.signal });
    serverAbort.abort();
    await expectReject(serverPending, /AbortError/);
    console.log(
      'HTTP transport: URL/body/signal contract, response validation, server errors, network errors, and cancellation passed.',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await runTests();
