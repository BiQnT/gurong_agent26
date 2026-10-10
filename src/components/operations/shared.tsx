import type { ReactNode } from 'react';
import { Droplets, LockKeyhole, Radio, Thermometer, Wind } from 'lucide-react';
import { distanceLimit } from '../../lib/drying';
import {
  getBatchReport,
  GUIDANCE_FACTS,
  type Batch,
  type GuidanceFacts,
  type MetricSummary,
  type Operations,
} from '../../lib/operations';

export type ViewProps = { operations: Operations };
export const statusLabels = { ongoing: '진행 중', completed: '종료', cancelled: '취소' };
export const date = (value: string | null, withYear = false) =>
  value === null
    ? '—'
    : new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        ...(withYear ? { year: 'numeric' as const } : {}),
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(value));
export const time = (value: string | null) =>
  value === null
    ? '—'
    : new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value));
export const value = (number: number | null, unit = '') =>
  number === null ? '—' : `${number}${unit}`;

export function BatchBadge({ status }: { status: Batch['status'] }) {
  return (
    <span className={`op-status op-status--${status}`}>
      {status === 'ongoing' && <span className="op-live-dot" />}
      {statusLabels[status]}
    </span>
  );
}

function Metric({
  label,
  metric,
  unit,
  icon,
}: {
  label: string;
  metric: MetricSummary;
  unit: string;
  icon: ReactNode;
}) {
  return (
    <div className="op-metric">
      <span className="op-metric-label">
        {icon}
        {label}
      </span>
      <strong>
        {value(metric.mean)}
        <small>{metric.mean !== null ? unit : ''}</small>
      </strong>
      <span className="op-metric-range">
        최저 {value(metric.min, unit)} <span>·</span> 최고 {value(metric.max, unit)}
      </span>
    </div>
  );
}

export function MetricGroup({ batch }: { batch: Batch }) {
  const summary = batch.report ?? getBatchReport(batch);
  return (
    <div className="op-metrics">
      <Metric
        label="평균 기온"
        metric={summary.temperature}
        unit="°C"
        icon={<Thermometer size={15} />}
      />
      <Metric label="평균 습도" metric={summary.humidity} unit="%" icon={<Droplets size={15} />} />
      <Metric label="평균 풍속" metric={summary.wind} unit="m/s" icon={<Wind size={15} />} />
    </div>
  );
}

export function MiniChart({ batch }: { batch: Batch }) {
  const observed = batch.observations.filter(
    (item) =>
      item.temperature !== null &&
      Number.isFinite(item.temperature) &&
      (item.distanceM === null ||
        (item.distanceM >= 0 &&
          item.distanceM <= distanceLimit({ deviceId: item.sourceDeviceId }))),
  );
  if (!observed.length)
    return (
      <div className="op-chart-empty">
        <Radio size={18} />
        <span>아직 수집된 환경 기록이 없어요.</span>
      </div>
    );
  const temperatures = observed.map((item) => item.temperature!);
  const minimum = Math.min(...temperatures);
  const range = Math.max(...temperatures) - minimum;
  const firstTime = Date.parse(observed[0].observedAt);
  const timeRange = Date.parse(observed[observed.length - 1].observedAt) - firstTime;
  const points = observed
    .map(
      (item) =>
        `${timeRange ? ((Date.parse(item.observedAt) - firstTime) / timeRange) * 600 : 300},${range ? 70 - ((item.temperature! - minimum) / range) * 54 : 43}`,
    )
    .join(' ');
  return (
    <div className="op-chart">
      <div className="op-chart-caption">
        <span>
          <span className="op-chart-dot" />
          기온 변화
        </span>
        <span>실제 관측값 · 30분 자동·직접 기록</span>
      </div>
      <svg
        viewBox="0 0 600 86"
        role="img"
        aria-label="기록한 실제 관측 기온 그래프"
        preserveAspectRatio="none"
      >
        <line x1="0" y1="22" x2="600" y2="22" stroke="#e9eeeb" strokeDasharray="3 5" />
        <line x1="0" y1="64" x2="600" y2="64" stroke="#e9eeeb" strokeDasharray="3 5" />
        <polyline
          points={points}
          fill="none"
          stroke="#626974"
          strokeWidth="2.4"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {observed.length === 1 && <circle cx="300" cy="43" r="3" fill="#626974" />}
      </svg>
      <div className="op-chart-axis">
        <span>
          {date(observed[0].observedAt)} {time(observed[0].observedAt)}
        </span>
        <span>
          {date(observed[observed.length - 1].observedAt)}{' '}
          {time(observed[observed.length - 1].observedAt)}
        </span>
      </div>
    </div>
  );
}

export function Facts({ facts = GUIDANCE_FACTS }: { facts?: GuidanceFacts }) {
  return (
    <div className="op-facts">
      <div className="op-facts-heading">
        <span>
          <LockKeyhole size={12} />
          원문과 함께 보존되는 수치
        </span>
        <strong data-grade={facts.grade}>{facts.grade}</strong>
      </div>
      <div className="op-facts-values">
        <span>
          <Thermometer size={14} />
          {value(facts.temperature, '°C')}
        </span>
        <span>
          <Droplets size={14} />
          {value(facts.humidity, '%')}
        </span>
        <span>
          <Wind size={14} />
          {value(facts.wind, 'm/s')}
        </span>
      </div>
      <div className="op-facts-source">
        {facts.observedAt
          ? `${date(facts.observedAt, true)} ${time(facts.observedAt)} KST`
          : '관측 시각 없음'}
        <span>·</span> {facts.sourceDeviceName ?? '연결된 관측기 없음'}
        <span>·</span> {facts.distanceM === null ? '덕장 거리 미확인' : `${facts.distanceM}m`}
        <span>·</span>{' '}
        {facts.sourceStatus === 'current'
          ? '관측 참고값 · 건조 등급 미판정'
          : facts.sourceStatus === 'stale'
            ? '이전 관측자료 · 현재 판단에 사용 불가'
            : '유효한 현재 관측값 없음'}
      </div>
      {facts.sourceIssues?.map((issue, index) => (
        <p className="op-demo-footnote" key={`${index}-${issue}`}>
          원자료 참고: {issue}
        </p>
      ))}
    </div>
  );
}
