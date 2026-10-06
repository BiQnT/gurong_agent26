import { readAssessment, type Assessment } from './drying.ts';
import { readLiveObservation, type LiveObservation } from './live.ts';

export type Scenario = 'normal' | 'caution' | 'unsuitable' | 'unavailable';

export type { Assessment } from './drying.ts';

export type ChatReply = {
  content: string;
  assessment?: Assessment;
  observation?: LiveObservation;
  provider?: 'openai' | 'compatible' | 'claude' | 'local';
  providerNotice?: string;
  sourceFetchedAt?: string;
  action?: 'start-batch' | 'end-batch' | 'guidance';
  suggestions: string[];
};

export type ChatRequest = {
  message: string;
  siteId: string;
  scenario?: Scenario;
  deviceId?: string;
  history: { role: 'user' | 'assistant'; content: string }[];
};

/** Keep a recent, contiguous context within the local API's request-size limit. */
export function recentChatHistory(messages: ChatRequest['history']): ChatRequest['history'] {
  const history: ChatRequest['history'] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const { role, content } of messages.slice(-12).reverse()) {
    const entry = { role, content };
    const size = encoder.encode(JSON.stringify(entry)).length + 1;
    if (bytes + size > 6000) break;
    history.unshift(entry);
    bytes += size;
  }
  return history;
}

export type ProgressStep = {
  id: string;
  label: string;
  detail: string;
  status: 'pending' | 'running' | 'done';
};

export interface ChatTransport {
  send(
    request: ChatRequest,
    options: { signal: AbortSignal; onProgress: (steps: ProgressStep[]) => void },
  ): Promise<ChatReply>;
}

const DEMO_OBSERVED_AT = '2026-01-15T09:00:00+09:00';
const SHARED_DEMO = {
  observedAt: DEMO_OBSERVED_AT,
  // The fixture clock is 2026-01-15 09:05 KST, not the user's current time.
  ageMinutes: 5,
  distanceM: 320,
  deviceName: '구룡포 해안 관측기 03',
  source: '구룡포 디지털 트윈 · 시연용 샘플',
};

const DEMO_ASSESSMENTS: Record<Scenario, Assessment> = {
  normal: {
    ...SHARED_DEMO,
    grade: '적합',
    summary: '세 가지 환경 조건이 안정적인 예시 상황이에요.',
    temperature: 3.2,
    humidity: 52,
    windSpeed: 4.1,
    reasons: [
      '온도 3.2°C · 안정적인 온도 조건을 가정한 시연 값이에요.',
      '습도 52% · 습기 정체가 크지 않은 조건을 가정했어요.',
      '풍속 4.1m/s · 바람이 유지되는 조건을 가정했어요.',
      '관측기와 덕장 거리는 320m로, 1km 이내예요.',
      '관측 후 5분은 시연 기준시각 2026-01-15 09:05에 대한 값이에요. 실제 현장 상태는 확인하지 않았어요.',
    ],
  },
  caution: {
    ...SHARED_DEMO,
    grade: '주의',
    summary: '습도가 높고 바람이 약한 예시 상황이에요.',
    temperature: 7.8,
    humidity: 78,
    windSpeed: 1.5,
    reasons: [
      '온도 7.8°C · 온도 변화를 살펴봐야 하는 조건을 가정했어요.',
      '습도 78% · 습기가 잘 빠지지 않는 조건을 가정했어요.',
      '풍속 1.5m/s · 통풍 상태를 함께 확인할 상황이에요.',
      '관측기와 덕장 거리는 320m예요. 가까운 관측기라도 덕장 내부 환경과 차이가 날 수 있어요.',
      '고정된 시연 데이터로 만든 판정이며, 실제 작업 판단에는 최신 관측값과 현장 확인이 필요해요.',
    ],
  },
  unsuitable: {
    ...SHARED_DEMO,
    grade: '부적합',
    summary: '높은 습도와 약한 바람이 겹친 예시 상황이에요.',
    temperature: 12.5,
    humidity: 90,
    windSpeed: 0.4,
    reasons: [
      '온도 12.5°C · 온도가 높은 상황을 가정한 시연 값이에요.',
      '습도 90% · 습기가 많이 머무르는 상황을 가정했어요.',
      '풍속 0.4m/s · 바람이 거의 없는 상황을 가정했어요.',
      '관측기와 덕장 거리는 320m예요. 관측값만으로 원물의 품질이나 식품 안전을 보장할 수 없어요.',
      '이 등급은 화면 시연을 위한 고정 결과예요. 실제 운영 기준을 검증한 판정은 아니에요.',
    ],
  },
  unavailable: {
    ...SHARED_DEMO,
    grade: '판정 불가',
    summary: '1km 이내에서 사용할 수 있는 관측 데이터를 찾지 못했어요.',
    temperature: null,
    humidity: null,
    windSpeed: null,
    ageMinutes: 60,
    distanceM: 1470,
    deviceName: '인근 관측기 없음 · 시연',
    reasons: [
      '가장 가까운 관측기가 1,470m 떨어져 있어 1km 거리 기준을 충족하지 못해요.',
      '온도·습도·풍속 값이 없어 건조 환경 등급을 추정하지 않았어요.',
      '덕장 위치와 관측기 연결을 확인한 뒤 다시 요청해 주세요.',
    ],
  },
};

/** Static UI fixtures only. These values do not implement a drying safety model. */
export function getDemoAssessment(scenario: Scenario = 'normal'): Assessment {
  const assessment = DEMO_ASSESSMENTS[scenario];
  return { ...assessment, reasons: [...assessment.reasons] };
}

const MOCK_STEPS = [
  { id: 'observations', label: '관측값 확인', detail: '관측 시각과 덕장까지의 거리를 확인해요.' },
  {
    id: 'assessment',
    label: '환경 판정 확인',
    detail: '온도·습도·풍속과 데이터 신뢰도를 살펴봐요.',
  },
  { id: 'explanation', label: '답변 정리', detail: '판정 근거와 현장 확인 사항을 정리해요.' },
];

function progressAt(steps: Omit<ProgressStep, 'status'>[], activeIndex: number): ProgressStep[] {
  return steps.map((step, index) => ({
    ...step,
    status: index < activeIndex ? 'done' : index === activeIndex ? 'running' : 'pending',
  }));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('요청을 중단했어요.', 'AbortError');
}

function waitForStep(durationMs: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', handleAbort);
      reject(new DOMException('요청을 중단했어요.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, durationMs);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function demoReply(request: ChatRequest): ChatReply {
  const message = request.message.trim();
  const assessment = getDemoAssessment(request.scenario);
  const suggestions = ['지금 건조해도 괜찮을까요?', '새 건조 작업 시작하기', '작업 종료 기록하기'];

  if (/작업\s*안내|베트남|번역|근로자|전달/.test(message)) {
    return {
      content:
        '작업 안내에서 한국어·베트남어 안내문을 확인할 수 있어요. 현장 상황에 맞는 내용을 확인하고 작업자에게 전달해 주세요.',
      action: 'guidance',
      suggestions: ['지금 건조 환경 확인하기', '새 건조 작업 시작하기'],
    };
  }

  if (/기준|방법|어떻게|설명|신뢰|관측기|데이터|거리|사용법|이유/.test(message)) {
    return {
      content:
        '온도·습도·풍속과 관측 시각, 관측기 거리를 함께 확인해요. 1km 이내 관측값이 없거나 데이터가 부족하면 “판정 불가”로 안내해요. 지금 등급은 샘플 관측 기준이며, 실제 연동에서는 검증된 규칙의 판정 근거를 AI가 설명해요.',
      suggestions: ['지금 건조해도 괜찮을까요?', '새 건조 작업 시작하기', '작업 종료 기록하기'],
    };
  }

  if (
    /회수했|거뒀|거두었|(종료|완료|마무리|끝).*(작업|건조|기록|배치)|(작업|건조|배치).*(종료|완료|마무리|끝)/.test(
      message,
    )
  ) {
    return {
      content:
        '종료할 건조 작업을 선택해 주세요. 종료 시점과 현장 메모를 확인한 뒤 저장하면 작업 기록에 반영돼요.',
      action: 'end-batch',
      suggestions: ['작업 종료 기록하기', '지금 건조 환경 확인하기'],
    };
  }

  if (/널었|(시작|새로운|새|등록).*(작업|건조|배치)|(작업|건조|배치).*(시작|등록)/.test(message)) {
    return {
      content:
        '새 건조 작업을 등록할 수 있어요. 원물, 수량, 시작 시점과 현장 메모를 확인한 뒤 저장해 주세요.',
      assessment,
      action: 'start-batch',
      suggestions: ['새 건조 작업 시작하기', '판정 기준 설명해 줘'],
    };
  }

  if (
    /건조|환경|날씨|바람|풍속|온도|습도|기온|적합|판정|덕장/.test(message) ||
    /^(오늘|지금).{0,10}(어때|어떤|상황|상태|괜찮)/.test(message)
  ) {
    if (/내일|모레|다음|예보|예측|몇 시간|시간 뒤|나중/.test(message)) {
      return {
        content:
          '아직 미래 날씨 예보나 건조 완료 시점 예측이 연결되어 있지 않아요. 지금은 선택한 샘플 관측 기준의 환경 판정을 확인할 수 있어요.',
        suggestions: ['지금 건조 환경 확인하기', '판정 기준 설명해 줘'],
      };
    }
    const explanation: Record<Assessment['grade'], string> = {
      적합: '기상 조건은 안정적이에요. 작업 전 덕장 내부와 원물 상태를 확인해 주세요.',
      주의: '습도가 높고 바람이 약해요. 작업 전 덕장 내부의 습기와 통풍 상태를 확인해 주세요.',
      부적합: '습도가 높고 바람이 거의 없어요. 작업 여부는 현장 상태를 확인한 뒤 결정해 주세요.',
      '판정 불가':
        '1km 이내 관측값이 없어 환경을 추정하지 않았어요. 덕장 위치와 현장 상태를 확인해 주세요.',
    };
    const content = `샘플 관측 기준, 건조 환경은 “${assessment.grade}”이에요. ${explanation[assessment.grade]}`;
    return { content, assessment, suggestions };
  }

  return {
    content:
      '이 목업에서는 건조 환경 확인과 작업 시작·종료 기록을 체험할 수 있어요. 덕장을 선택하고 “지금 건조해도 괜찮을까요?”라고 물어보세요.',
    suggestions,
  };
}

function createMockTransport(): ChatTransport {
  return {
    async send(request, { signal, onProgress }) {
      throwIfAborted(signal);
      if (!request.message.trim()) throw new Error('메시지를 입력해 주세요.');
      for (let index = 0; index < MOCK_STEPS.length; index += 1) {
        throwIfAborted(signal);
        onProgress(progressAt(MOCK_STEPS, index));
        await waitForStep([1000, 1300, 1200][index], signal);
      }
      throwIfAborted(signal);
      const reply = demoReply(request);
      onProgress(progressAt(MOCK_STEPS, MOCK_STEPS.length));
      throwIfAborted(signal);
      return reply;
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText);
}

/** Validate API or persisted replies before presenting their structured evidence. */
export function readChatReply(value: unknown): ChatReply {
  if (!isObject(value) || !isText(value.content) || !isStringArray(value.suggestions)) {
    throw new Error('서버 응답 형식이 올바르지 않아요. 다시 요청해 주세요.');
  }
  const assessment = value.assessment === undefined ? undefined : readAssessment(value.assessment);
  if (assessment === null) {
    throw new Error('서버의 환경 판정 데이터를 확인할 수 없어요. 다시 요청해 주세요.');
  }
  if (
    value.action !== undefined &&
    (!isText(value.action) || !['start-batch', 'end-batch', 'guidance'].includes(value.action))
  ) {
    throw new Error('서버의 작업 안내 형식이 올바르지 않아요.');
  }
  return {
    content: value.content,
    suggestions: [...value.suggestions],
    ...(value.observation === undefined
      ? {}
      : { observation: readLiveObservation(value.observation) }),
    ...(value.provider === 'openai' ||
    value.provider === 'compatible' ||
    value.provider === 'claude' ||
    value.provider === 'local'
      ? { provider: value.provider }
      : {}),
    ...(typeof value.providerNotice === 'string' ? { providerNotice: value.providerNotice } : {}),
    ...(typeof value.sourceFetchedAt === 'string'
      ? { sourceFetchedAt: value.sourceFetchedAt }
      : {}),
    ...(assessment ? { assessment } : {}),
    ...(value.action === undefined ? {} : { action: value.action as ChatReply['action'] }),
  };
}

const HTTP_STEPS = [
  { id: 'request', label: '요청 전달', detail: '선택한 관측소와 대화 내용을 서버에 전달했어요.' },
  {
    id: 'response',
    label: '응답 기다리는 중',
    detail: '서버에서 요청을 처리하고 있어요. 결과가 준비되면 한 번에 보여드려요.',
  },
  {
    id: 'validation',
    label: '응답 확인',
    detail: '받은 응답과 관측 정보의 형식을 확인하고 있어요.',
  },
];

function createHttpTransport(baseUrl: string): ChatTransport {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/chat`;
  return {
    async send(request, { signal, onProgress }) {
      throwIfAborted(signal);
      if (!request.message.trim()) throw new Error('메시지를 입력해 주세요.');
      onProgress(progressAt(HTTP_STEPS, 1));
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(request),
          signal,
        });
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new Error('서버에 연결하지 못했어요. 연결 상태를 확인한 뒤 다시 요청해 주세요.');
      }
      throwIfAborted(signal);
      if (!response.ok) {
        throw new Error(
          response.status === 429
            ? '요청이 잠시 몰렸어요. 조금 뒤에 다시 시도해 주세요.'
            : `서버가 요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요. (${response.status})`,
        );
      }
      onProgress(progressAt(HTTP_STEPS, 2));
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throwIfAborted(signal);
        throw new Error('서버 응답을 읽을 수 없어요. 다시 요청해 주세요.');
      }
      throwIfAborted(signal);
      const reply = readChatReply(payload);
      onProgress(progressAt(HTTP_STEPS, HTTP_STEPS.length));
      throwIfAborted(signal);
      return reply;
    },
  };
}

/** An explicit baseUrl is useful for integration tests; omitted uses Vite's public API origin. */
export function createChatTransport(baseUrl?: string): ChatTransport {
  const environment = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env;
  // Mock is opt-in for isolated tests; the application always requests real data by default.
  if (baseUrl === '' || baseUrl === 'mock') return createMockTransport();
  const configuredUrl = baseUrl ?? environment?.VITE_API_BASE_URL ?? '/';
  return createHttpTransport(configuredUrl.trim() || '/');
}
