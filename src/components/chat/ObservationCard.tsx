import {
  Clock3,
  ExternalLink,
  MapPin,
  ShieldCheck,
  Thermometer,
  Droplets,
  Wind,
} from 'lucide-react';
import { formatDistance } from '../../lib/geo';
import type { LiveObservation } from '../../lib/live';

export function observationTime(value: string | null): string {
  if (!value) return '관측 시각 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function ObservationCard({ observation }: { observation: LiveObservation }) {
  const kma = observation.device.provider === 'kma';
  const label = kma ? '기상청 실제 관측 정보' : 'E-UM 실제 관측 정보';
  return (
    <section className="assessment-card observation-card" aria-label={label}>
      <div className="assessment-title">
        <span className="eyebrow">{label}</span>
        <span className="grade-pill muted">
          {observation.status === 'current'
            ? '관측 기록'
            : observation.status === 'stale'
              ? '과거 관측'
              : '확인 필요'}
        </span>
      </div>
      <h3>{observation.device.name}</h3>
      <div className="observation-location">
        <MapPin size={14} />
        <span>{observation.device.address}</span>
      </div>
      <div className="assessment-metrics">
        <div>
          <span>
            <Thermometer size={15} />
            기온
          </span>
          <strong>
            {observation.temperature ?? '—'}
            <small>°C</small>
          </strong>
        </div>
        <div>
          <span>
            <Droplets size={15} />
            습도
          </span>
          <strong>
            {observation.humidity ?? '—'}
            <small>%</small>
          </strong>
        </div>
        <div>
          <span>
            <Wind size={15} />
            풍속
          </span>
          <strong>
            {observation.windSpeed ?? '—'}
            <small>m/s</small>
          </strong>
        </div>
      </div>
      <p className="observation-time">
        <Clock3 size={14} />
        {observationTime(observation.observedAt)} · 관측 시각
      </p>
      <p className="observation-caution">
        {observation.status === 'current'
          ? '응답에 사용된 관측 기록입니다. 현재 현장 상태와 다를 수 있으며, 검증된 판정 기준이 없어 건조 적합 여부는 판단하지 않습니다.'
          : '현재 날씨를 의미하지 않습니다. 이 값으로 지금의 건조 적합 여부를 판단할 수 없어요.'}
      </p>
      <details className="evidence-details">
        <summary>
          <ShieldCheck size={15} />
          출처와 데이터 상태
        </summary>
        <dl>
          <div>
            <dt>관측기</dt>
            <dd>
              {observation.device.name} · {observation.device.id}
            </dd>
          </div>
          <div>
            <dt>원본 시각</dt>
            <dd>{observation.observedAtRaw ?? '없음'}</dd>
          </div>
          <div>
            <dt>위치</dt>
            <dd>
              {observation.device.latitude.toFixed(6)}, {observation.device.longitude.toFixed(6)}
            </dd>
          </div>
          <div>
            <dt>덕장과의 거리</dt>
            <dd>{formatDistance(observation.distanceM)}</dd>
          </div>
        </dl>
        {observation.issues.map((issue, index) => (
          <p key={index}>{issue}</p>
        ))}
        <a
          className="source-link"
          href={kma ? 'https://apihub.kma.go.kr/' : 'https://pohang-eum.kr/data/list/1'}
          target="_blank"
          rel="noreferrer"
        >
          {kma ? '기상청 API허브 AWS 매분자료' : 'E-UM 대기환경 데이터'}
          <ExternalLink size={12} />
        </a>
      </details>
    </section>
  );
}
