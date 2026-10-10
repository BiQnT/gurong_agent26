// 30분 배치 수집기. prod 에서만 systemd 타이머(매시 00분·30분)가 한 번 실행하고 끝난다. 상주하지 않는다.
// dev 는 같은 DB 를 쓰므로 절대 돌리지 않는다 (같은 구간이 두 번 쌓인다).
//
//   DATABASE_PATH=/srv/haepung/db/haepung.db EUM_SERVICE_KEY=... node server/collect.ts
//
// 진행 중인 배치가 있는 덕장마다 화면과 같은 기준으로 고른 관측(1km 안 E-UM, 없으면 5km 안 기상청 AWS,
// 그다음 덕장 격자 초단기실황. ADR 0013)을 배치 기록에 붙이고, 못 붙이면 결측 표본을 남겨 보고서의
// 결측률에 반영한다. 표본마다 규칙 등급을 남기고 부적합이면 경보를 남긴다.
import { resolve } from 'node:path';
import {
  assessDrying,
  distanceLimit,
  distanceRule,
  isKmaSource,
  type Assessment,
} from '../src/lib/drying.ts';
import type { LiveObservation, LiveSnapshot, SiteWeather } from '../src/lib/live.ts';
import {
  appendLiveObservation,
  observationRecordIssue,
  type Batch,
  type BatchLog,
  type Observation,
} from '../src/lib/operations.ts';
import { createObservationService } from './eum.ts';
import { createKmaSource, KMA_WAIT_MS, within } from './sources/kma.ts';
import { attachSiteContext } from './site-observations.ts';
import { readBridgeConfig } from './vite-api.ts';
import { createWorkspaceService, openWorkspaceStore, type WorkspaceConfig } from './workspace.ts';

const SLOT_MS = 30 * 60 * 1000;
// E-UM 요청 하나는 12초 제한이지만 단건 재시도까지 합치면 길어질 수 있어 전체를 묶는다 (systemd 300초 안).
const SNAPSHOT_TIMEOUT_MS = 120 * 1000;
// 결측 표본은 실제 장비가 아니므로 E-UM 장비 ID(숫자)와 겹치지 않는 이름을 쓴다.
export const MISSING_DEVICE_ID = 'collector-missing';

type ObservationSource = { snapshot(signal: AbortSignal): Promise<LiveSnapshot> };
type SiteLocation = { id: string; name: string; latitude: number; longitude: number };
type Choice = { observation: LiveObservation } | { reason: string; label: string };
type Outcome = 'recorded' | 'missing' | 'skipped';

export type CollectSummary = {
  at: string;
  /** E-UM 결과. skipped 는 진행 중인 배치가 없어 부르지 않은 경우 */
  source: 'ok' | 'archived' | 'error' | 'skipped';
  /** source 가 error 일 때의 오류 코드 (메시지·URL 은 남기지 않는다) */
  sourceError?: string;
  sites: number;
  batches: number;
  recorded: number;
  missing: number;
  skipped: number;
  failedSites: number;
};

function choose(
  snapshot: LiveSnapshot | null,
  site: SiteLocation,
  recordedAt: string,
  grid?: LiveObservation | null,
): Choice {
  // E-UM 조회가 통째로 실패해도 덕장 격자 초단기실황이 있으면 그 값으로 기록한다 (ADR 0013).
  if (!snapshot && grid?.status !== 'current')
    return { reason: 'E-UM 관측 조회에 실패했어요.', label: 'E-UM 조회 실패' };
  const source: LiveSnapshot = snapshot ?? {
    fetchedAt: recordedAt,
    source: '기상청 초단기실황',
    sourceUrl: 'https://apihub.kma.go.kr/',
    devices: [],
    observations: [],
    selected: null,
    warnings: [],
    status: 'ok',
    llm: { configured: false, model: '' },
  };
  // 화면과 같은 기준: 1km 안 E-UM, 없으면 5km 안 기상청 AWS, 그다음 덕장 격자 초단기실황 (ADR 0009, 0013).
  const selected = attachSiteContext(source, site, undefined, grid).selected;
  // E-UM 이 보관 자료뿐이어도 기상청 실시간 값이 골라졌으면 기록한다.
  if (source.status !== 'ok' && !isKmaSource(selected?.device.provider))
    return {
      reason: '실시간 조회에 실패해 보관된 과거 자료만 있어 기록하지 않았어요.',
      label: '실시간 자료 없음',
    };
  if (
    !selected ||
    selected.status !== 'current' ||
    typeof selected.distanceM !== 'number' ||
    selected.distanceM > distanceLimit({ provider: selected.device.provider })
  )
    return {
      reason: `덕장 근처(${distanceRule()})에서 사용할 수 있는 최근 관측값을 찾지 못했어요.`,
      label: '근처 최근 관측 없음',
    };
  const issue = observationRecordIssue(selected, recordedAt);
  // 원천 관측의 첫 확인 사항(예: 시간대 없음)을 같이 남겨 운영자가 결측 이유를 알 수 있게 한다.
  if (issue)
    return {
      reason: `${selected.device.name}: ${issue}${selected.issues[0] ? ` (${selected.issues[0]})` : ''}`,
      label: '관측값 확인 불가',
    };
  return { observation: selected };
}

// 부적합 경보는 1시간에 한 번만 남긴다 (기획서 US-2 쿨다운).
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

function collectBatch(
  batch: Batch,
  choice: Choice,
  recordedAt: string,
  logId: string,
  assessment?: Assessment,
): { batch: Batch; outcome: Outcome } {
  // 같은 30분 구간에 이미 수집했으면(타이머가 두 번 돌아도) 아무것도 더하지 않는다.
  if (batch.logs.some((log) => log.id === logId)) return { batch, outcome: 'skipped' };
  if (Date.parse(recordedAt) < Date.parse(batch.startedAt)) return { batch, outcome: 'skipped' };
  let reason = '관측값을 기록할 수 없어요.';
  let label = '관측값 확인 불가';
  if ('observation' in choice) {
    const live = choice.observation;
    // 운영자가 같은 관측을 이미 손으로 기록했다면 그 표본이 이 구간을 대신한다.
    if (
      batch.observations.some(
        (item) => item.sourceDeviceId === live.device.id && item.observedAt === live.observedAt,
      )
    )
      return { batch, outcome: 'skipped' };
    const updated = appendLiveObservation(batch, live, recordedAt, logId);
    if (updated !== batch) {
      // 운영자가 누른 기록과 구분되도록 제목만 바꾼다. 새 배열이라 원래 배치는 그대로다.
      const last = updated.logs.length - 1;
      updated.logs[last] = {
        ...updated.logs[last],
        title: '30분 자동 수집으로 관측값을 기록했어요',
        // 그때의 규칙 판정과 적용 기준을 함께 남긴다 (기준이 바뀌어도 당시 판정을 다시 볼 수 있게).
        ...(assessment
          ? {
              detail: `${updated.logs[last].detail} · 등급 ${assessment.grade} · ${assessment.summary} · 기준 ${assessment.thresholds?.version ?? '알 수 없음'}`,
            }
          : {}),
      };
      if (assessment?.grade === '부적합') {
        // 조회가 늦어 기록 시각이 밀려도 간격이 줄지 않게 30분 구간 시작 시각으로 잰다.
        const slotOf = (id: string, at: string) => {
          const slot = Date.parse(id.replace(/^(?:collect|alert)-/, ''));
          return Number.isFinite(slot) ? slot : Date.parse(at);
        };
        const lastAlert = batch.logs.filter((log) => log.kind === 'alert').at(-1);
        if (
          !lastAlert ||
          slotOf(logId, recordedAt) - slotOf(lastAlert.id, lastAlert.at) >= ALERT_COOLDOWN_MS
        ) {
          const sample = updated.observations.length - 1;
          updated.observations[sample] = { ...updated.observations[sample], alert: true };
          updated.logs.push({
            id: logId.replace(/^collect-/, 'alert-'),
            at: recordedAt,
            title: '부적합 경보: 회수 또는 널기 연기를 검토해 주세요',
            detail: `${assessment.summary} 근거: ${assessment.reasons.slice(0, 3).join(' / ')}`,
            kind: 'alert',
          });
        }
      }
      return { batch: updated, outcome: 'recorded' };
    }
  } else {
    reason = choice.reason;
    label = choice.label;
  }
  // 값이 모두 null 인 표본은 getBatchReport 에서 유효 표본으로 세지 않으므로 결측률에만 반영된다.
  const missing: Observation = {
    at: recordedAt,
    observedAt: recordedAt,
    sourceDeviceId: MISSING_DEVICE_ID,
    sourceDeviceName: `자동 수집 결측 · ${label}`,
    temperature: null,
    humidity: null,
    wind: null,
    distanceM: null,
    alert: false,
  };
  const log: BatchLog = {
    id: logId,
    at: recordedAt,
    title: '30분 자동 수집 결측을 기록했어요',
    detail: reason,
    kind: 'observation',
  };
  return {
    batch: { ...batch, observations: [...batch.observations, missing], logs: [...batch.logs, log] },
    outcome: 'missing',
  };
}

export async function collectOnce(options: {
  workspace: WorkspaceConfig;
  observations: ObservationSource;
  /** 덕장 위치의 비·눈 (기상청). 판정의 강수 조건에 쓴다. 없으면 강수는 모르는 채로 판정한다 */
  weather?: (site: { latitude: number; longitude: number }) => Promise<SiteWeather | null>;
  /** 덕장 격자 초단기실황 관측 (ADR 0013). 없으면 E-UM·AWS 만으로 고른다 */
  grid?: (site: { latitude: number; longitude: number }) => Promise<LiveObservation | null>;
  now?: () => number;
}): Promise<CollectSummary> {
  const now = options.now ?? Date.now;
  // 구간은 타이머가 깨운 시각으로 정한다. 기록 시각은 E-UM 조회가 끝난 뒤에 다시 잰다.
  const started = now();
  const logId = `collect-${new Date(Math.floor(started / SLOT_MS) * SLOT_MS).toISOString()}`;
  const workspace = createWorkspaceService(options.workspace);
  const sites = await openWorkspaceStore(options.workspace).read((db) =>
    db.sites
      .filter((site) =>
        db.operations.some(
          (entry) =>
            entry.siteId === site.id &&
            entry.data.batches.some((batch) => batch.status === 'ongoing'),
        ),
      )
      .map(({ id, name, latitude, longitude }) => ({ id, name, latitude, longitude })),
  );
  const summary: CollectSummary = {
    at: new Date(started).toISOString(),
    source: 'skipped',
    sites: sites.length,
    batches: 0,
    recorded: 0,
    missing: 0,
    skipped: 0,
    failedSites: 0,
  };
  if (!sites.length) return summary;

  // 모든 덕장이 같은 E-UM 응답을 쓴다 (한 번만 부른다).
  let snapshot: LiveSnapshot | null = null;
  try {
    snapshot = await options.observations.snapshot(AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS));
    summary.source = snapshot.status === 'ok' ? 'ok' : 'archived';
  } catch (error) {
    summary.source = 'error';
    const code = (error as { code?: unknown; name?: unknown } | null)?.code;
    summary.sourceError =
      typeof code === 'string' ? code : error instanceof Error ? error.name : 'UNKNOWN';
  }
  // 조회 중에 들어온 관측의 시각이 기록 시각보다 늦으면 검증에서 떨어지므로 조회가 끝난 뒤의 시각을 쓴다.
  const recordedAt = new Date(now()).toISOString();

  for (const site of sites) {
    // E-UM·AWS 로 고르지 못했을 때만 덕장 격자 초단기실황을 부른다 (덕장마다 최대 5초라 아낀다).
    let choice = choose(snapshot, site, recordedAt);
    if (!('observation' in choice) && options.grid) {
      const grid = await within(options.grid(site), KMA_WAIT_MS);
      if (grid) choice = choose(snapshot, site, recordedAt, grid);
    }
    const weather =
      'observation' in choice && options.weather
        ? await within(options.weather(site), KMA_WAIT_MS)
        : null;
    const assessment =
      'observation' in choice ? assessDrying(choice.observation, weather) : undefined;
    const counts = { batches: 0, recorded: 0, missing: 0, skipped: 0 };
    try {
      // 잠금을 잡은 뒤 최신 기록에 적용한다. 그 사이 운영자가 종료한 배치는 건너뛴다.
      await workspace.appendCollected(site.id, (data) => {
        Object.assign(counts, { batches: 0, recorded: 0, missing: 0, skipped: 0 });
        let changed = false;
        const batches = data.batches.map((batch) => {
          if (batch.status !== 'ongoing') return batch;
          counts.batches += 1;
          const result = collectBatch(batch, choice, recordedAt, logId, assessment);
          counts[result.outcome] += 1;
          if (result.batch !== batch) changed = true;
          return result.batch;
        });
        return changed ? { ...data, batches } : data;
      });
      summary.batches += counts.batches;
      summary.recorded += counts.recorded;
      summary.missing += counts.missing;
      summary.skipped += counts.skipped;
    } catch (error) {
      // 한 덕장의 저장 실패가 다른 덕장 수집을 막지 않게 하고, 끝에서 실패로 종료한다.
      summary.failedSites += 1;
      console.error(
        `[collect] 덕장 ${site.id} 기록 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return summary;
}

export function formatSummary(summary: CollectSummary): string {
  const source = summary.sourceError ? `${summary.source}(${summary.sourceError})` : summary.source;
  return `[collect] ${summary.at} source=${source} sites=${summary.sites} batches=${summary.batches} recorded=${summary.recorded} missing=${summary.missing} skipped=${summary.skipped} failed=${summary.failedSites}`;
}

if (import.meta.main) {
  // systemd 의 작업 폴더와 상관없이 release 폴더(이 파일의 상위)를 기준으로 삼는다 (main.ts 와 같다).
  const projectRoot = resolve(import.meta.dirname, '..');
  const config = readBridgeConfig(process.env as Record<string, string>, projectRoot);
  try {
    const kma = createKmaSource(config);
    const summary = await collectOnce({
      workspace: config,
      observations: createObservationService(config, fetch, kma),
      ...(kma ? { weather: (site) => kma.weather(site) } : {}),
      ...(kma?.grid ? { grid: kma.grid } : {}),
    });
    console.log(formatSummary(summary));
    if (summary.failedSites) process.exitCode = 1;
  } catch (error) {
    // 저장소를 못 여는 등 예상하지 못한 오류. 설정값·키는 출력하지 않는다.
    console.error(`[collect] 실패: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
