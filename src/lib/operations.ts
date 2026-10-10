import { DRYING_THRESHOLDS, distanceLimit, kst, sourceName } from './drying.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Assessment } from './chat.ts';
import { GRID_STALE_MINUTES, type LiveObservation } from './live.ts';
import { createId as uid } from './id.ts';
import { workspaceApi, WorkspaceError, type OperationsEnvelope } from './workspace.ts';

export type BatchStatus = 'ongoing' | 'completed' | 'cancelled';
export type BatchLog = {
  id: string;
  at: string;
  title: string;
  detail: string;
  kind: 'observation' | 'approval' | 'worker' | 'alert';
};
export type Observation = {
  at: string;
  observedAt: string;
  sourceDeviceId: string;
  sourceDeviceName: string;
  temperature: number | null;
  humidity: number | null;
  wind: number | null;
  distanceM: number | null;
  alert: boolean;
};
export type MetricSummary = { mean: number | null; min: number | null; max: number | null };
export type BatchReport = {
  temperature: MetricSummary;
  humidity: MetricSummary;
  wind: MetricSummary;
  totalSamples: number;
  validSamples: number;
  missingRate: number | null;
  distanceM: number | null;
  alertCount: number;
  distanceValidated: boolean;
};
export type Batch = {
  id: string;
  name: string;
  fish: '꽁치' | '청어';
  quantity: number;
  status: BatchStatus;
  startedAt: string;
  endedAt?: string;
  note: string;
  observations: Observation[];
  logs: BatchLog[];
  report?: BatchReport;
};
export type GuidanceFacts = Readonly<{
  grade: string;
  temperature: number | null;
  humidity: number | null;
  wind: number | null;
  distanceM: number | null;
  observedAt: string | null;
  sourceDeviceName: string | null;
  sourceStatus: LiveObservation['status'] | 'unavailable';
  sourceIssues?: readonly string[];
}>;
export type GuidanceReply = {
  id: string;
  at: string;
  kind: 'read' | 'completed' | 'question';
  text: string;
  simulated: boolean;
  userId?: string;
  userName?: string;
  answer?: { text: string; at: string; userId: string; userName: string };
};
export type Guidance = {
  id: string;
  batchId?: string;
  title: string;
  original: string;
  translated: string;
  language: 'vi';
  facts: GuidanceFacts;
  approvedAt: string;
  preparedAt: string;
  channel: 'local-preview' | 'workspace';
  status: 'prepared' | 'read' | 'completed';
  replies: GuidanceReply[];
};
export type OperationsData = { batches: Batch[]; guidance: Guidance[] };
/** 채팅에서 "꽁치 300마리 널었어"처럼 말한 값을 시작 창에 미리 채운다. 저장은 사람이 확인한 뒤에만 한다. */
export type StartPrefill = { fish?: Batch['fish']; quantity?: number };
export type OperationsDialog =
  | { type: 'start'; prefill?: StartPrefill }
  | { type: 'guidance'; facts: GuidanceFacts }
  | { type: 'end' | 'cancel' | 'report'; batchId: string }
  | null;

export const OPERATIONS_STORAGE_KEY = 'guryongpo.operations.live.v2';
export const GUIDANCE_FACTS: GuidanceFacts = Object.freeze({
  grade: '판정 불가',
  temperature: null,
  humidity: null,
  wind: null,
  distanceM: null,
  observedAt: null,
  sourceDeviceName: null,
  sourceStatus: 'unavailable',
  sourceIssues: [],
});

export const GUIDANCE_TEMPLATES = [
  {
    id: 'spread',
    title: '과메기 널기',
    original: '준비된 과메기를 건조대에 간격을 두고 널어주세요. 작업을 마치면 완료를 알려주세요.',
    translated:
      'Vui lòng treo cá đã chuẩn bị lên giàn phơi, chừa khoảng cách giữa các con cá. Hãy báo lại khi hoàn thành công việc.',
  },
  {
    id: 'collect',
    title: '과메기 회수',
    original: '건조대의 과메기를 회수해주세요. 회수를 마치면 완료를 알려주세요.',
    translated: 'Vui lòng thu cá trên giàn phơi. Hãy báo lại khi hoàn tất việc thu cá.',
  },
  {
    id: 'check',
    title: '건조 상태 확인',
    original: '건조대의 과메기 상태를 확인해주세요. 이상이 있으면 운영자에게 알려주세요.',
    translated:
      'Vui lòng kiểm tra tình trạng cá trên giàn phơi. Nếu có bất thường, hãy báo cho người quản lý.',
  },
] as const;

const now = () => new Date().toISOString();
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
// 출처마다 거리 한도가 다르다: E-UM 1km, 기상청 AWS·초단기실황 격자 5km (ADR 0013).
const inDistanceGate = (observation: Observation) =>
  observation.distanceM === null ||
  (finite(observation.distanceM) &&
    observation.distanceM >= 0 &&
    observation.distanceM <= distanceLimit({ deviceId: observation.sourceDeviceId }));
const summarize = (values: (number | null)[]): MetricSummary => {
  const valid = values.filter(finite);
  if (!valid.length) return { mean: null, min: null, max: null };
  const average = valid.reduce((sum, value) => sum + value / valid.length, 0);
  return {
    mean: finite(average * 10) ? Math.round(average * 10) / 10 : average,
    min: valid.reduce((minimum, value) => Math.min(minimum, value), valid[0]),
    max: valid.reduce((maximum, value) => Math.max(maximum, value), valid[0]),
  };
};

/** 값이 하나라도 있는 표본. 자동 수집이 관측값을 못 받은 회차(값이 모두 빈 결측 표본)는 빠진다. */
export function measuredObservations(batch: Batch): Observation[] {
  return batch.observations.filter((item) =>
    [item.temperature, item.humidity, item.wind].some(finite),
  );
}

export function getBatchReport(batch: Batch): BatchReport {
  const observations = batch.observations;
  const nearby = observations.filter(inDistanceGate);
  const validSamples = nearby.filter(
    (item) => finite(item.temperature) && finite(item.humidity) && finite(item.wind),
  ).length;
  const distances = observations.map((item) => item.distanceM).filter(finite);
  // 결측 표본은 결측률에 잡히므로 거리 검증에서는 뺀다.
  const measured = measuredObservations(batch);
  return {
    temperature: summarize(nearby.map((item) => item.temperature)),
    humidity: summarize(nearby.map((item) => item.humidity)),
    wind: summarize(nearby.map((item) => item.wind)),
    totalSamples: observations.length,
    validSamples,
    missingRate: observations.length
      ? Math.round(((observations.length - validSamples) / observations.length) * 1000) / 10
      : null,
    distanceM: distances.length
      ? distances.reduce((maximum, value) => Math.max(maximum, value), distances[0])
      : null,
    alertCount: observations.filter((item) => item.alert).length,
    distanceValidated:
      measured.length > 0 &&
      measured.every((item) => finite(item.distanceM) && inDistanceGate(item)),
  };
}

/** A new workspace contains only records the operator creates. */
export function createInitialOperationsData(): OperationsData {
  return { batches: [], guidance: [] };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, maxLength = 10000): value is string =>
  typeof value === 'string' && value.length <= maxLength;
const nonempty = (value: unknown, maxLength = 10000): value is string =>
  text(value, maxLength) && value.trim().length > 0;
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour < 24 &&
    minute < 60 &&
    second < 60
  );
}
const nullableFinite = (value: unknown): value is number | null => value === null || finite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const integer = (value: unknown): value is number =>
  nonnegative(value) && Number.isSafeInteger(value);
const uniqueIds = (items: { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length;

function validObservation(value: unknown): value is Observation {
  return (
    record(value) &&
    timestamp(value.at) &&
    timestamp(value.observedAt) &&
    Date.parse(value.observedAt) <= Date.parse(value.at) &&
    nonempty(value.sourceDeviceId, 200) &&
    nonempty(value.sourceDeviceName, 500) &&
    nullableFinite(value.temperature) &&
    nullableFinite(value.humidity) &&
    (value.humidity === null || (value.humidity >= 0 && value.humidity <= 100)) &&
    nullableFinite(value.wind) &&
    (value.wind === null || value.wind >= 0) &&
    (value.distanceM === null || nonnegative(value.distanceM)) &&
    typeof value.alert === 'boolean'
  );
}

function validMetric(value: unknown): value is MetricSummary {
  if (!record(value)) return false;
  if (value.min === null || value.max === null || value.mean === null)
    return value.min === null && value.max === null && value.mean === null;
  return (
    finite(value.mean) &&
    finite(value.min) &&
    finite(value.max) &&
    value.min <= value.mean &&
    value.mean <= value.max
  );
}

function validReport(value: unknown): value is BatchReport {
  return (
    record(value) &&
    validMetric(value.temperature) &&
    validMetric(value.humidity) &&
    validMetric(value.wind) &&
    integer(value.totalSamples) &&
    integer(value.validSamples) &&
    value.validSamples <= value.totalSamples &&
    (value.missingRate === null ||
      (finite(value.missingRate) && value.missingRate >= 0 && value.missingRate <= 100)) &&
    (value.distanceM === null || nonnegative(value.distanceM)) &&
    integer(value.alertCount) &&
    value.alertCount <= value.totalSamples &&
    typeof value.distanceValidated === 'boolean'
  );
}

function validLog(value: unknown): value is BatchLog {
  return (
    record(value) &&
    nonempty(value.id, 200) &&
    timestamp(value.at) &&
    nonempty(value.title) &&
    text(value.detail) &&
    typeof value.kind === 'string' &&
    ['observation', 'approval', 'worker', 'alert'].includes(value.kind)
  );
}

function validBatch(value: unknown): value is Batch {
  if (
    !record(value) ||
    !nonempty(value.id, 200) ||
    !nonempty(value.name, 200) ||
    !['꽁치', '청어'].includes(String(value.fish)) ||
    typeof value.fish !== 'string' ||
    !integer(value.quantity) ||
    value.quantity < 1 ||
    value.quantity > 100000 ||
    typeof value.status !== 'string' ||
    !['ongoing', 'completed', 'cancelled'].includes(value.status) ||
    !timestamp(value.startedAt) ||
    !text(value.note) ||
    !Array.isArray(value.observations) ||
    !value.observations.every(validObservation) ||
    !Array.isArray(value.logs) ||
    !value.logs.every(validLog) ||
    !uniqueIds(value.logs) ||
    (value.report !== undefined && !validReport(value.report))
  )
    return false;
  if (
    value.observations.some((item) => Date.parse(item.at) < Date.parse(value.startedAt as string))
  )
    return false;
  if (value.status === 'ongoing') return value.endedAt === undefined;
  return (
    timestamp(value.endedAt) &&
    Date.parse(value.endedAt) >= Date.parse(value.startedAt) &&
    value.observations.every((item) => Date.parse(item.at) <= Date.parse(value.endedAt as string))
  );
}

function validFacts(value: unknown): value is GuidanceFacts {
  if (
    !record(value) ||
    typeof value.grade !== 'string' ||
    !['적합', '주의', '부적합', '판정 불가'].includes(value.grade) ||
    !nullableFinite(value.temperature) ||
    !nullableFinite(value.humidity) ||
    !nullableFinite(value.wind) ||
    (value.humidity !== null && (value.humidity < 0 || value.humidity > 100)) ||
    (value.wind !== null && value.wind < 0) ||
    !(value.distanceM === null || nonnegative(value.distanceM)) ||
    !(value.observedAt === null || timestamp(value.observedAt)) ||
    !(value.sourceDeviceName === null || nonempty(value.sourceDeviceName, 500)) ||
    (value.sourceIssues !== undefined &&
      (!Array.isArray(value.sourceIssues) ||
        !value.sourceIssues.every((issue) => nonempty(issue)))) ||
    typeof value.sourceStatus !== 'string' ||
    !['current', 'stale', 'invalid', 'unavailable'].includes(value.sourceStatus)
  )
    return false;
  return value.grade === '판정 불가'
    ? true
    : finite(value.temperature) &&
        finite(value.humidity) &&
        value.humidity >= 0 &&
        value.humidity <= 100 &&
        nonnegative(value.wind) &&
        finite(value.distanceM) &&
        // 출처를 따로 남기지 않으므로 가장 넓은 한도(기상청 5km)로 본다 (ADR 0013, 저장 규칙을 넓힘).
        value.distanceM <= DRYING_THRESHOLDS.maxFallbackDistanceM;
}

function validReply(value: unknown): value is GuidanceReply {
  return (
    record(value) &&
    nonempty(value.id, 200) &&
    timestamp(value.at) &&
    nonempty(value.text) &&
    typeof value.simulated === 'boolean' &&
    (value.userId === undefined || nonempty(value.userId, 200)) &&
    (value.userName === undefined || nonempty(value.userName, 200)) &&
    (value.simulated || (nonempty(value.userId, 200) && nonempty(value.userName, 200))) &&
    typeof value.kind === 'string' &&
    ['read', 'completed', 'question'].includes(value.kind) &&
    (value.answer === undefined ||
      (value.kind === 'question' &&
        value.simulated === false &&
        record(value.answer) &&
        nonempty(value.answer.text, 1000) &&
        timestamp(value.answer.at) &&
        Date.parse(value.answer.at) >= Date.parse(value.at) &&
        nonempty(value.answer.userId, 200) &&
        nonempty(value.answer.userName, 200)))
  );
}

function validGuidance(value: unknown): value is Guidance {
  return (
    record(value) &&
    nonempty(value.id, 200) &&
    (value.batchId === undefined || nonempty(value.batchId, 200)) &&
    nonempty(value.title) &&
    nonempty(value.original) &&
    nonempty(value.translated) &&
    value.language === 'vi' &&
    validFacts(value.facts) &&
    timestamp(value.approvedAt) &&
    timestamp(value.preparedAt) &&
    Date.parse(value.preparedAt) >= Date.parse(value.approvedAt) &&
    typeof value.status === 'string' &&
    (value.channel === 'local-preview' || value.channel === 'workspace') &&
    ['prepared', 'read', 'completed'].includes(value.status) &&
    Array.isArray(value.replies) &&
    value.replies.every(validReply) &&
    uniqueIds(value.replies)
  );
}

/** Shared by the browser and server; real replies must carry an identified account. */
export function validateOperationsData(value: unknown): value is OperationsData {
  return (
    record(value) &&
    Array.isArray(value.batches) &&
    value.batches.every(validBatch) &&
    uniqueIds(value.batches) &&
    Array.isArray(value.guidance) &&
    value.guidance.every(validGuidance) &&
    uniqueIds(value.guidance) &&
    value.guidance.every(
      (item) =>
        !item.batchId || (value.batches as Batch[]).some((batch) => batch.id === item.batchId),
    )
  );
}

/** The complete stored shape is checked before any value reaches rendering. */
export function restoreOperationsData(raw: string | null): OperationsData {
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (record(parsed) && parsed.version === 2 && validateOperationsData(parsed)) {
      return {
        batches: parsed.batches.map((batch) =>
          batch.status === 'completed' ? { ...batch, report: getBatchReport(batch) } : batch,
        ),
        guidance: parsed.guidance,
      };
    }
  } catch {
    /* Malformed storage falls back to a empty local workspace. */
  }
  return createInitialOperationsData();
}

function readData(): OperationsData {
  try {
    return restoreOperationsData(localStorage.getItem(OPERATIONS_STORAGE_KEY));
  } catch {
    return createInitialOperationsData();
  }
}

/** A UI freshness limit, not a validated drying or food-safety threshold. */
export function observationRecordIssue(
  observation?: LiveObservation | null,
  recordedAt = now(),
): string | null {
  if (!observation) return '기록할 최신 관측값이 없어요.';
  if (observation.status !== 'current')
    return '이전 관측자료는 참고만 가능하며 새 생산 기록에 추가할 수 없어요.';
  if (!timestamp(recordedAt) || !timestamp(observation.observedAt))
    return '관측 시각을 확인할 수 없어 기록하지 않았어요.';
  if (!nonempty(observation.device?.id, 200) || !nonempty(observation.device?.name, 500))
    return '관측기를 확인할 수 없어 기록하지 않았어요.';
  if (
    !finite(observation.temperature) ||
    !finite(observation.humidity) ||
    observation.humidity < 0 ||
    observation.humidity > 100 ||
    !nonnegative(observation.windSpeed)
  )
    return '필수 관측값이 없거나 유효하지 않아 기록하지 않았어요.';
  const age = (Date.parse(recordedAt) - Date.parse(observation.observedAt)) / 60_000;
  // 기상청 초단기실황 격자는 매시 자료라 더 오래 쓴다 (ADR 0013). 나머지는 1분 갱신 관측이다.
  const maxAge = observation.device.provider === 'kma-grid' ? GRID_STALE_MINUTES : 30;
  if (
    !nonnegative(observation.ageMinutes) ||
    observation.ageMinutes > maxAge ||
    age < 0 ||
    age > maxAge
  )
    return `관측 후 ${maxAge}분 이내인 최신 값만 기록할 수 있어요.`;
  if (!Array.isArray(observation.issues) || observation.issues.length)
    return '관측값의 시각 또는 품질에 확인할 사항이 있어 기록하지 않았어요.';
  return null;
}

export function appendLiveObservation(
  batch: Batch,
  live: LiveObservation,
  recordedAt: string,
  logId: string,
): Batch {
  if (
    batch.status !== 'ongoing' ||
    observationRecordIssue(live, recordedAt) ||
    Date.parse(recordedAt) < Date.parse(batch.startedAt)
  )
    return batch;
  if (
    batch.observations.some(
      (item) => item.sourceDeviceId === live.device.id && item.observedAt === live.observedAt,
    )
  )
    return batch;
  const observation: Observation = {
    at: recordedAt,
    observedAt: live.observedAt!,
    sourceDeviceId: live.device.id,
    sourceDeviceName: live.device.name,
    temperature: live.temperature,
    humidity: live.humidity,
    wind: live.windSpeed,
    distanceM: nonnegative(live.distanceM) ? live.distanceM : null,
    alert: false,
  };
  return {
    ...batch,
    observations: [...batch.observations, observation],
    logs: [
      ...batch.logs,
      {
        id: logId,
        at: recordedAt,
        title: '최신 관측값을 기록했어요',
        detail: `${live.device.name} · 실제 관측 ${kst(live.observedAt)} · ${nonnegative(live.distanceM) ? `덕장에서 ${Math.round(live.distanceM)}m` : '덕장 거리 미확인'}`,
        kind: 'observation',
      },
    ],
  };
}

export function factsFromObservation(observation?: LiveObservation | null): GuidanceFacts {
  if (!observation) return { ...GUIDANCE_FACTS };
  return {
    grade: '판정 불가',
    temperature: finite(observation.temperature) ? observation.temperature : null,
    humidity: finite(observation.humidity) ? observation.humidity : null,
    wind: finite(observation.windSpeed) ? observation.windSpeed : null,
    distanceM: nonnegative(observation.distanceM) ? observation.distanceM : null,
    observedAt: timestamp(observation.observedAt) ? observation.observedAt : null,
    sourceDeviceName: observation.device?.name || null,
    sourceStatus: observation.status,
    sourceIssues: [...observation.issues],
  };
}

/** 규칙 함수의 판정을 근로자 안내에 그대로 싣는다 (운영자와 근로자가 같은 등급을 본다). */
export function factsFromAssessment(
  assessment: Assessment,
  observation?: LiveObservation | null,
  recordedAt = now(),
): GuidanceFacts {
  // 지난 대화의 판정 카드로 안내를 만들면 그때의 등급이 지금처럼 전달된다. 관측 후 30분(매시 자료인
  // 기상청 초단기실황 격자는 GRID_STALE_MINUTES)이 지났으면 판정 불가.
  const maxAge = assessment.source === sourceName('kma-grid') ? GRID_STALE_MINUTES : 30;
  const stale =
    !assessment.observedAt ||
    Date.parse(recordedAt) - Date.parse(assessment.observedAt) > maxAge * 60 * 1000;
  if (
    stale ||
    assessment.grade === '판정 불가' ||
    assessment.temperature === null ||
    assessment.humidity === null ||
    assessment.windSpeed === null ||
    assessment.distanceM === null ||
    assessment.observedAt === null
  )
    return { ...factsFromObservation(observation), grade: '판정 불가' };
  return {
    grade: assessment.grade,
    temperature: assessment.temperature,
    humidity: assessment.humidity,
    wind: assessment.windSpeed,
    distanceM: assessment.distanceM,
    observedAt: assessment.observedAt,
    sourceDeviceName: assessment.deviceName,
    sourceStatus: 'current',
    sourceIssues: [],
  };
}

/** This transition is invoked only after the operator approves the dialog. */
export function closeBatchWithApproval(
  batch: Batch,
  status: 'completed' | 'cancelled',
  note: string,
  requestedAt: string,
  logId: string,
): Batch {
  if (batch.status !== 'ongoing' || !timestamp(requestedAt)) return batch;
  // Preserve ordering if the local system clock is adjusted during production.
  const endedAt = new Date(
    batch.observations.reduce(
      (latest, item) => Math.max(latest, Date.parse(item.at)),
      Math.max(Date.parse(requestedAt), Date.parse(batch.startedAt)),
    ),
  ).toISOString();
  return {
    ...batch,
    status,
    endedAt,
    note: note.trim() || batch.note,
    ...(status === 'completed' ? { report: getBatchReport(batch) } : {}),
    logs: [
      ...batch.logs,
      {
        id: logId,
        at: endedAt,
        title:
          status === 'completed' ? '운영자가 종료를 승인했어요' : '운영자가 배치 취소를 승인했어요',
        detail: status === 'completed' ? '환경 기록이 생성됐어요.' : '기존 기록은 보관돼요.',
        kind: 'approval',
      },
    ],
  };
}

/** Worker responses append history and update guidance delivery, never batch state. */
export function recordWorkerReply(
  data: OperationsData,
  guidanceId: string,
  reply: GuidanceReply,
): OperationsData {
  const target = data.guidance.find((item) => item.id === guidanceId);
  if (
    !target ||
    !validReply(reply) ||
    target.replies.some(
      (item) =>
        item.id === reply.id ||
        (reply.kind !== 'question' &&
          item.kind === reply.kind &&
          item.userId === reply.userId &&
          item.simulated === reply.simulated),
    )
  )
    return data;
  return {
    guidance: data.guidance.map((item) =>
      item.id === guidanceId
        ? {
            ...item,
            status:
              reply.kind === 'completed'
                ? 'completed'
                : reply.kind === 'read' && item.status !== 'completed'
                  ? 'read'
                  : item.status,
            replies: [...item.replies, reply],
          }
        : item,
    ),
    batches: data.batches.map((batch) =>
      batch.id === target.batchId
        ? {
            ...batch,
            logs: [
              ...batch.logs,
              {
                id: `${reply.id}-batch-log`,
                at: reply.at,
                title: `${reply.simulated ? '응답 시뮬레이션' : reply.userName} · ${
                  reply.kind === 'completed'
                    ? '작업 완료 보고'
                    : reply.kind === 'read'
                      ? '안내 확인'
                      : '질문'
                }`,
                detail: reply.text,
                kind: 'worker',
              },
            ],
          }
        : batch,
    ),
  };
}

export type OperationsScope = { siteId: string; role: 'owner' | 'worker'; userId: string };
type OperationsTransform = (latest: OperationsData) => OperationsData;
type OperationsClient = Pick<typeof workspaceApi, 'operations' | 'saveOperations'>;

function checkedEnvelope(value: OperationsEnvelope): OperationsEnvelope {
  if (!value || !integer(value.revision) || !validateOperationsData(value.data))
    throw new Error('공유 기록의 형식을 확인할 수 없어요. 다시 불러와 주세요.');
  return value;
}

/** Rebase each owner action on the latest revision so worker replies survive concurrent saves. */
export async function commitWorkspaceOperations(
  siteId: string,
  transform: OperationsTransform,
  client: OperationsClient = workspaceApi,
  isCurrent: () => boolean = () => true,
): Promise<OperationsEnvelope> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!isCurrent()) throw new Error('덕장이 변경되어 저장을 중단했어요.');
    const latest = checkedEnvelope(await client.operations(siteId));
    if (!isCurrent()) throw new Error('덕장이 변경되어 저장을 중단했어요.');
    const next = transform(latest.data);
    if (!validateOperationsData(next)) throw new Error('저장할 기록을 확인해 주세요.');
    if (next === latest.data) return latest;
    try {
      return checkedEnvelope(
        await client.saveOperations(siteId, { data: next, revision: latest.revision }),
      );
    } catch (cause) {
      if (!(cause instanceof WorkspaceError && cause.status === 409) || attempt === 3) throw cause;
    }
  }
  throw new Error('다른 팀원이 기록을 변경했어요. 다시 시도해 주세요.');
}

export function useOperations(
  currentObservation: LiveObservation | null = null,
  scope?: OperationsScope,
) {
  const scopeKey = scope ? `${scope.siteId}:${scope.userId}:${scope.role}` : 'local';
  const siteId = scope?.siteId;
  const role = scope?.role;
  const userId = scope?.userId;
  const [snapshot, setSnapshot] = useState(() => ({
    key: scopeKey,
    data: scope ? createInitialOperationsData() : readData(),
    revision: scope ? -1 : 0,
  }));
  const [dialog, setDialog] = useState<OperationsDialog>(null);
  const [notice, setNotice] = useState('');
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [loading, setLoading] = useState(Boolean(scope));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const generation = useRef(0);
  const latest = useRef(snapshot);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const refreshRequest = useRef<AbortController | null>(null);
  const data = snapshot.key === scopeKey ? snapshot.data : createInitialOperationsData();
  const ready = !siteId || (snapshot.key === scopeKey && snapshot.revision >= 0);
  const activeBatch = data.batches.find((batch) => batch.status === 'ongoing');

  const applyEnvelope = useCallback(
    (envelope: OperationsEnvelope) => {
      if (activeScope.current !== scopeKey) return;
      if (latest.current.key === scopeKey && latest.current.revision > envelope.revision) return;
      const next = { key: scopeKey, ...checkedEnvelope(envelope) };
      latest.current = next;
      setSnapshot(next);
    },
    [scopeKey],
  );

  const refresh = useCallback(async () => {
    if (!siteId) return;
    refreshRequest.current?.abort();
    const controller = new AbortController();
    refreshRequest.current = controller;
    const token = generation.current;
    if (latest.current.key !== scopeKey || latest.current.revision < 0) setLoading(true);
    try {
      const envelope = checkedEnvelope(await workspaceApi.operations(siteId, controller.signal));
      if (
        controller.signal.aborted ||
        activeScope.current !== scopeKey ||
        generation.current !== token
      )
        return;
      applyEnvelope(envelope);
      setError('');
    } catch (cause) {
      if (
        !controller.signal.aborted &&
        activeScope.current === scopeKey &&
        generation.current === token
      )
        setError(cause instanceof Error ? cause.message : '기록을 불러오지 못했어요.');
    } finally {
      if (
        !controller.signal.aborted &&
        activeScope.current === scopeKey &&
        generation.current === token
      ) {
        setLoading(false);
        refreshRequest.current = null;
      }
    }
  }, [siteId, scopeKey, applyEnvelope]);

  useEffect(() => {
    generation.current += 1;
    pending.current = 0;
    queue.current = Promise.resolve();
    setSaving(false);
    setStorageAvailable(true);
    setDialog(null);
    setNotice('');
    setError('');
    const next = {
      key: scopeKey,
      data: siteId ? createInitialOperationsData() : readData(),
      revision: siteId ? -1 : 0,
    };
    latest.current = next;
    setSnapshot(next);
    setLoading(Boolean(siteId));
    if (!siteId) return;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 10_000);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      generation.current += 1;
      refreshRequest.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [siteId, scopeKey, refresh]);

  useEffect(() => {
    if (siteId || snapshot.key !== 'local') return;
    try {
      localStorage.setItem(
        OPERATIONS_STORAGE_KEY,
        JSON.stringify({ version: 2, ...snapshot.data }),
      );
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, [siteId, snapshot]);

  function enqueue(
    work: (isCurrent: () => boolean) => Promise<OperationsEnvelope>,
    onSuccess: () => void,
  ) {
    const token = generation.current;
    const isCurrent = () => activeScope.current === scopeKey && generation.current === token;
    pending.current += 1;
    setSaving(true);
    setError('');
    const job = queue.current.then(async () => {
      if (!isCurrent()) return false;
      try {
        const envelope = await work(isCurrent);
        if (!isCurrent()) return false;
        applyEnvelope(envelope);
        setError('');
        onSuccess();
        return true;
      } catch (cause) {
        if (isCurrent())
          setError(
            cause instanceof Error
              ? cause.message
              : '기록을 저장하지 못했어요. 다시 시도해 주세요.',
          );
        return false;
      } finally {
        if (isCurrent()) {
          pending.current -= 1;
          setSaving(pending.current > 0);
        }
      }
    });
    queue.current = job;
    return job;
  }

  function commit(transform: OperationsTransform, onSuccess: () => void): Promise<boolean> {
    if (
      scope &&
      (role !== 'owner' || latest.current.key !== scopeKey || latest.current.revision < 0)
    ) {
      setError(
        role === 'worker'
          ? '배치와 작업 안내는 운영자가 변경할 수 있어요.'
          : '기록을 먼저 불러와 주세요.',
      );
      return Promise.resolve(false);
    }
    if (siteId)
      return enqueue(
        (isCurrent) => commitWorkspaceOperations(siteId, transform, workspaceApi, isCurrent),
        onSuccess,
      );
    try {
      const next = {
        key: 'local',
        data: transform(latest.current.data),
        revision: latest.current.revision + 1,
      };
      latest.current = next;
      setSnapshot(next);
      onSuccess();
      return Promise.resolve(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '기록을 변경하지 못했어요.');
      return Promise.resolve(false);
    }
  }

  function approveStart(input: {
    name: string;
    fish: '꽁치' | '청어';
    quantity: number;
    note: string;
  }) {
    if (
      !input.name.trim() ||
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 100000
    )
      return Promise.resolve(false);
    const startedAt = now();
    const batch: Batch = {
      id: uid(),
      name: input.name.trim(),
      fish: input.fish,
      quantity: input.quantity,
      status: 'ongoing',
      startedAt,
      note: input.note.trim(),
      observations: [],
      logs: [
        {
          id: uid(),
          at: startedAt,
          title: '운영자가 배치 시작을 승인했어요',
          detail: `${input.fish} ${input.quantity}마리 · 관측값 기록 대기`,
          kind: 'approval',
        },
      ],
    };
    return commit(
      (previous) =>
        previous.batches.some((item) => item.id === batch.id)
          ? previous
          : { ...previous, batches: [batch, ...previous.batches] },
      () => {
        setDialog(null);
        setNotice(`‘${batch.name}’ 기록을 시작했어요.`);
      },
    );
  }

  function closeBatch(batchId: string, status: 'completed' | 'cancelled', note?: string) {
    const requestedAt = now();
    const logId = uid();
    return commit(
      (previous) => {
        const target = previous.batches.find((batch) => batch.id === batchId);
        if (!target || target.status !== 'ongoing')
          throw new Error('이미 종료되거나 취소된 배치예요. 기록을 새로 확인해 주세요.');
        return {
          ...previous,
          batches: previous.batches.map((batch) =>
            batch.id === batchId
              ? closeBatchWithApproval(batch, status, note ?? batch.note, requestedAt, logId)
              : batch,
          ),
        };
      },
      () => {
        setDialog(status === 'completed' ? { type: 'report', batchId } : null);
        setNotice(
          status === 'completed'
            ? '배치를 종료하고 환경 기록을 만들었어요.'
            : '배치를 취소했어요. 기존 기록은 보관돼요.',
        );
      },
    );
  }

  function recordObservation(batchId: string, observation: LiveObservation) {
    const recordedAt = now();
    const issue = observationRecordIssue(observation, recordedAt);
    if (issue) {
      setError(issue);
      return Promise.resolve(false);
    }
    const logId = uid();
    return commit(
      (previous) => {
        const target = previous.batches.find((batch) => batch.id === batchId);
        if (!target || target.status !== 'ongoing')
          throw new Error('진행 중인 배치에만 관측을 추가할 수 있어요.');
        if (
          target.observations.some(
            (item) =>
              item.sourceDeviceId === observation.device.id &&
              item.observedAt === observation.observedAt,
          )
        )
          throw new Error('이미 기록한 관측값이에요. 새 관측값이 들어오면 다시 기록할 수 있어요.');
        const updated = appendLiveObservation(target, observation, recordedAt, logId);
        if (updated === target)
          throw new Error('관측값을 기록할 수 없어요. 시각과 품질을 확인해 주세요.');
        return {
          ...previous,
          batches: previous.batches.map((batch) => (batch.id === batchId ? updated : batch)),
        };
      },
      () => setNotice('관측 시각과 관측기를 포함해 현재 값을 기록했어요.'),
    );
  }

  function approveGuidance(templateId: string, batchId?: string) {
    const template = GUIDANCE_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return Promise.resolve(false);
    const approvedAt = now();
    const facts =
      dialog?.type === 'guidance' ? dialog.facts : factsFromObservation(currentObservation);
    const item: Guidance = {
      id: uid(),
      batchId,
      title: template.title,
      original: template.original,
      translated: template.translated,
      language: 'vi',
      facts: { ...facts },
      approvedAt,
      preparedAt: approvedAt,
      channel: siteId ? 'workspace' : 'local-preview',
      status: 'prepared',
      replies: [],
    };
    const logId = uid();
    return commit(
      (previous) => {
        if (
          batchId &&
          !previous.batches.some((batch) => batch.id === batchId && batch.status === 'ongoing')
        )
          throw new Error('연결할 배치가 종료되었어요. 다른 배치를 선택해 주세요.');
        if (previous.guidance.some((guidance) => guidance.id === item.id)) return previous;
        return {
          guidance: [item, ...previous.guidance],
          batches: previous.batches.map((batch) =>
            batch.id === batchId
              ? {
                  ...batch,
                  logs: [
                    ...batch.logs,
                    {
                      id: logId,
                      at: approvedAt,
                      title: '작업 안내를 승인했어요',
                      detail: `${template.title} · ${siteId ? '덕장 팀에 공유' : '로컬 안내 준비'}`,
                      kind: 'approval',
                    },
                  ],
                }
              : batch,
          ),
        };
      },
      () => {
        setDialog(null);
        setNotice(
          siteId ? '승인한 안내를 덕장 팀에 공유했어요.' : '승인한 안내를 로컬 화면에 준비했어요.',
        );
      },
    );
  }

  function workerRespond(guidanceId: string, kind: GuidanceReply['kind'], replyText?: string) {
    const target = data.guidance.find((item) => item.id === guidanceId);
    if (!target || (kind === 'question' && !replyText?.trim())) return Promise.resolve(false);
    if (
      kind !== 'question' &&
      target.replies.some(
        (reply) =>
          reply.kind === kind &&
          (siteId ? reply.userId === userId && !reply.simulated : reply.simulated),
      )
    )
      return Promise.resolve(false);
    if (siteId) {
      if (role !== 'worker') {
        setError('근로자 계정에서 응답할 수 있어요.');
        return Promise.resolve(false);
      }
      return enqueue(
        () => workspaceApi.reply(siteId, guidanceId, kind, replyText?.trim()),
        () =>
          setNotice(
            kind === 'completed'
              ? '작업 완료를 운영자에게 알렸어요.'
              : kind === 'read'
                ? '안내 확인을 운영자에게 알렸어요.'
                : '질문을 운영자에게 전달했어요.',
          ),
      );
    }
    const reply: GuidanceReply = {
      id: uid(),
      at: now(),
      kind,
      simulated: true,
      text:
        kind === 'read'
          ? 'Đã đọc · 안내를 확인했어요.'
          : kind === 'completed'
            ? 'Đã hoàn thành · 작업을 완료했어요.'
            : replyText!.trim(),
    };
    return commit(
      (previous) => recordWorkerReply(previous, guidanceId, reply),
      () => setNotice('근로자 응답을 로컬에서 시뮬레이션했어요.'),
    );
  }

  function answerQuestion(
    guidanceId: string,
    replyId: string,
    answerText: string,
  ): Promise<boolean> {
    if (!siteId || role !== 'owner') {
      setError('운영자 계정에서 근로자의 질문에 답할 수 있어요.');
      return Promise.resolve(false);
    }
    const question = data.guidance
      .find((item) => item.id === guidanceId)
      ?.replies.find((reply) => reply.id === replyId);
    if (!question || question.kind !== 'question' || question.simulated) {
      setError('답변할 근로자 질문을 찾을 수 없어요.');
      return Promise.resolve(false);
    }
    const answer = answerText.trim();
    if (!answer || answer.length > 1000) {
      setError('답변을 1자 이상 1,000자 이하로 입력해 주세요.');
      return Promise.resolve(false);
    }
    return enqueue(
      () => workspaceApi.answerQuestion(siteId, guidanceId, replyId, answer),
      () => setNotice('답변을 근로자에게 전달했어요.'),
    );
  }

  const canManage = !scope || role === 'owner';
  function open(next: OperationsDialog) {
    if (!canManage && next?.type !== 'report') return;
    if (saving || loading || !ready) return;
    setError('');
    setDialog(next);
  }
  return {
    batches: data.batches,
    guidance: data.guidance,
    activeBatch,
    dialog,
    notice,
    storageAvailable,
    currentObservation,
    observationIssue: observationRecordIssue(currentObservation),
    loading: loading || snapshot.key !== scopeKey,
    ready,
    saving,
    error,
    refresh,
    shared: Boolean(siteId),
    scope,
    canManage,
    openStart: () => open({ type: 'start' }),
    openStartWith: (prefill: StartPrefill) => open({ type: 'start', prefill }),
    openEnd: (batchId?: string) => {
      const id = batchId ?? activeBatch?.id;
      if (id) open({ type: 'end', batchId: id });
      else setNotice('진행 중인 배치가 없어요. 먼저 배치를 시작해주세요.');
    },
    openCancel: (batchId: string) => open({ type: 'cancel', batchId }),
    openReport: (batchId: string) => open({ type: 'report', batchId }),
    openGuidance: () => open({ type: 'guidance', facts: factsFromObservation(currentObservation) }),
    openGuidanceFromObservation: (observation: LiveObservation | null = currentObservation) =>
      open({ type: 'guidance', facts: factsFromObservation(observation) }),
    openGuidanceFromAssessment: (
      assessment: Assessment,
      observation: LiveObservation | null = currentObservation,
    ) => open({ type: 'guidance', facts: factsFromAssessment(assessment, observation) }),
    closeDialog: () => {
      if (!saving) setDialog(null);
    },
    dismissNotice: () => setNotice(''),
    dismissError: () => setError(''),
    approveStart,
    approveEnd: (batchId: string, note: string) => closeBatch(batchId, 'completed', note),
    approveCancel: (batchId: string) => closeBatch(batchId, 'cancelled'),
    recordObservation,
    approveGuidance,
    workerRespond,
    answerQuestion,
  };
}

export type Operations = ReturnType<typeof useOperations>;

export function downloadBatchReport(batch: Batch) {
  const artifact = {
    kind: 'gwamegi-batch-report',
    version: 2,
    source: '운영자가 승인한 생산 기록 및 확인한 관측 API 값',
    limitations:
      '확인한 관측값을 수동으로 기록했습니다. 거리가 확인되어도 현장 대표성이나 건조 적합성을 보증하지 않습니다. 근로자 응답과 운영자의 배치 종료 승인은 별도 이력입니다.',
    generatedAt: now(),
    timezone: 'Asia/Seoul',
    batch,
    summary: batch.report ?? getBatchReport(batch),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `gwamegi-report-${batch.id.replace(/[^a-z0-9-]/gi, '')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
