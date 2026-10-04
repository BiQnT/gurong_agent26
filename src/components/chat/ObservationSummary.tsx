import { ChevronRight, Droplets, MapPin, RefreshCw, Thermometer, Wind } from 'lucide-react';
import type { LiveObservation, LiveSnapshot } from '../../lib/live';
import { observationTime } from './ObservationCard';

type Props = {
  snapshot: LiveSnapshot | null;
  observation: LiveObservation | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onAsk: (prompt: string) => void;
};

export function ObservationSummary({
  snapshot,
  observation,
  loading,
  error,
  onRefresh,
  onAsk,
}: Props) {
  const archived = snapshot?.status === 'archived';
  return (
    <div className="observation-summary">
      <section className="weather-strip" aria-label="E-UM 관측 현황" aria-busy={loading}>
        <div className="weather-location">
          <span className="weather-location-icon">
            <MapPin size={17} />
          </span>
          <div>
            <strong>
              {observation?.device.name ??
                (loading ? '구룡포 관측 정보를 가져오는 중' : '관측값을 확인할 수 없어요')}
            </strong>
            <span>
              {observation ? observationTime(observation.observedAt) : 'E-UM 디지털 트윈 포항'}
            </span>
          </div>
        </div>
        <div className="weather-values">
          <span>
            <Thermometer size={16} />
            <b>
              {observation?.temperature ?? '—'}
              <small>°C</small>
            </b>
          </span>
          <span>
            <Droplets size={16} />
            <b>
              {observation?.humidity ?? '—'}
              <small>%</small>
            </b>
          </span>
          <span>
            <Wind size={17} />
            <b>
              {observation?.windSpeed ?? '—'}
              <small>m/s</small>
            </b>
          </span>
        </div>
        <button
          className="weather-grade"
          onClick={() => onAsk('선택한 관측소의 실제 데이터와 측정 시각을 설명해 줘')}
          disabled={loading || !observation}
        >
          {archived
            ? '보관된 실측'
            : observation?.status === 'current'
              ? '관측 정보'
              : observation?.status === 'stale'
                ? '과거 관측'
                : '확인 필요'}
          <ChevronRight size={13} />
        </button>
      </section>
      <div className="connection-note" role="status">
        <span>
          {error ??
            (archived
              ? '실시간 조회에 실패해, 보관된 과거 실측값을 보여드리고 있어요.'
              : (snapshot?.warnings[0] ??
                (loading
                  ? '관측소와 데이터 상태를 확인하고 있어요.'
                  : '출처와 측정 시각을 함께 확인하세요.')))}
        </span>
        <button onClick={onRefresh} disabled={loading} aria-label="관측 정보 새로고침">
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          <span>새로고침</span>
        </button>
      </div>
    </div>
  );
}
