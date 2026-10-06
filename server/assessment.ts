import { assessDrying, evaluateBatch } from '../src/lib/drying.ts';
import type { LiveSnapshot } from '../src/lib/live.ts';
import {
  getBatchReport,
  measuredObservations,
  type OperationsData,
} from '../src/lib/operations.ts';
import type { BatchSummary } from './chat.ts';

/** 덕장 기준 관측에 규칙 함수의 널기 판정을 붙인다 (관측 조회·채팅·수집기가 같은 함수를 쓴다). */
export function withAssessment(snapshot: LiveSnapshot): LiveSnapshot {
  return { ...snapshot, assessment: assessDrying(snapshot.selected, snapshot.weather) };
}

/** 최근 배치를 지금 기준으로 다시 평가해 AI 근거로 넘긴다. 진행 중인 배치가 먼저다. */
export function summarizeBatches(data: OperationsData, limit = 5): BatchSummary[] {
  return [...data.batches]
    .sort((a, b) =>
      a.status === 'ongoing' && b.status !== 'ongoing'
        ? -1
        : b.status === 'ongoing' && a.status !== 'ongoing'
          ? 1
          : Date.parse(b.startedAt) - Date.parse(a.startedAt),
    )
    .slice(0, limit)
    .map((batch) => {
      const report = getBatchReport(batch);
      return {
        name: batch.name,
        status:
          batch.status === 'ongoing' ? '진행 중' : batch.status === 'completed' ? '종료' : '취소',
        startedAt: batch.startedAt,
        endedAt: batch.endedAt ?? null,
        samples: measuredObservations(batch).length,
        evaluation: evaluateBatch(batch.observations).summary,
        alerts: batch.logs.filter((log) => log.kind === 'alert').length,
        missingRate: report.missingRate,
      };
    });
}
