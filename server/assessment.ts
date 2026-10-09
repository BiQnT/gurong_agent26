import type { BatchDigest, HistorySample } from '../src/lib/analysis.ts';
import { assessDrying, evaluateBatch, kst } from '../src/lib/drying.ts';
import type { LiveSnapshot } from '../src/lib/live.ts';
import {
  getBatchReport,
  measuredObservations,
  type Batch,
  type OperationsData,
} from '../src/lib/operations.ts';

/** 덕장 기준 관측에 규칙 함수의 널기 판정을 붙인다 (관측 조회·채팅·수집기가 같은 함수를 쓴다). */
export function withAssessment(snapshot: LiveSnapshot): LiveSnapshot {
  return { ...snapshot, assessment: assessDrying(snapshot.selected, snapshot.weather) };
}

const STATUS: Record<Batch['status'], BatchDigest['status']> = {
  ongoing: '진행 중',
  completed: '종료',
  cancelled: '취소',
};

/** 배치 하나를 지금 기준으로 다시 평가한 요약. 숫자는 기록 요약 화면과 같은 함수에서 나온다. */
export function digestBatch(batch: Batch, now: number): BatchDigest {
  const report = getBatchReport(batch);
  const evaluation = evaluateBatch(batch.observations);
  const rated = evaluation.counts.적합 + evaluation.counts.주의 + evaluation.counts.부적합;
  const percent = (value: number) => Math.round((value / rated) * 100);
  const end = batch.endedAt ? Date.parse(batch.endedAt) : now;
  const elapsedHours = Math.max(
    0,
    Math.round(((end - Date.parse(batch.startedAt)) / 3_600_000) * 10) / 10,
  );
  const alerts = batch.logs.filter((log) => log.kind === 'alert').length;
  return {
    kind: 'batch',
    name: batch.name,
    status: STATUS[batch.status],
    fish: batch.fish,
    quantity: batch.quantity,
    startedAt: batch.startedAt,
    endedAt: batch.endedAt ?? null,
    elapsedHours,
    samples: measuredObservations(batch).length,
    missingRate: report.missingRate,
    temperature: report.temperature,
    humidity: report.humidity,
    windSpeed: report.wind,
    percentages: rated
      ? {
          적합: percent(evaluation.counts.적합),
          주의: percent(evaluation.counts.주의),
          부적합: percent(evaluation.counts.부적합),
        }
      : null,
    ratedSamples: rated,
    alerts,
    firstUnsuitableAt: evaluation.firstUnsuitableAt,
    summary:
      `${batch.name}(${STATUS[batch.status]}, ${batch.fish} ${batch.quantity.toLocaleString()}마리, ${kst(batch.startedAt)} 시작` +
      `${batch.endedAt ? `, ${kst(batch.endedAt)} 종료` : ''}, ${elapsedHours}시간): ${evaluation.summary}` +
      `${report.missingRate === null ? '' : `, 결측 ${report.missingRate}%`}, 경보 ${alerts}건.`,
  };
}

/**
 * 최근 배치 요약. 진행 중인 배치가 먼저, 나머지는 최근 시작 순이다.
 * status 를 주면 그 상태만 고른다.
 */
export function digestBatches(
  data: OperationsData,
  now: number,
  options: { status?: Batch['status']; limit?: number } = {},
): BatchDigest[] {
  return [...data.batches]
    .filter((batch) => !options.status || batch.status === options.status)
    .sort((a, b) =>
      a.status === 'ongoing' && b.status !== 'ongoing'
        ? -1
        : b.status === 'ongoing' && a.status !== 'ongoing'
          ? 1
          : Date.parse(b.startedAt) - Date.parse(a.startedAt),
    )
    .slice(0, options.limit ?? 5)
    .map((batch) => digestBatch(batch, now));
}

/**
 * 이 덕장 배치에 기록된 관측 표본 (우리 DB 의 과거 자료). 진행 중인 배치가 있을 때만 30분마다 쌓인다.
 * 거리를 모르거나 1km 밖인 표본, 결측 표본은 뺀다.
 */
export function batchHistorySamples(data: OperationsData): HistorySample[] {
  return data.batches.flatMap((batch) =>
    batch.observations
      .filter(
        (item) =>
          typeof item.distanceM === 'number' && item.distanceM >= 0 && item.distanceM <= 1000,
      )
      .filter((item) =>
        [item.temperature, item.humidity, item.wind].some((value) => value !== null),
      )
      .map((item) => ({
        at: item.observedAt,
        temperature: item.temperature,
        humidity: item.humidity,
        windSpeed: item.wind,
        rainMm: null,
      })),
  );
}
