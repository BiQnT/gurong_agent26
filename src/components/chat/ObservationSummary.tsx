import { ChevronRight, Droplets, MapPin, RefreshCw, Thermometer, Wind } from 'lucide-react';
import type { LiveObservation, LiveSnapshot, SiteWeather } from '../../lib/live';
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
  // 기상청 AWS 는 E-UM 관측기의 최근 값이 없을 때 대신 쓴 실시간 값이다 (E-UM 이 보관 자료여도).
  const kma = observation?.device.provider === 'kma';
  const archived = snapshot?.status === 'archived' && !kma;
  const kmaNote = kma
    ? snapshot?.warnings.find((warning) => warning.includes('기상청 구룡포 AWS'))
    : undefined;
  const extra = weatherLine(snapshot?.weather);
  return (
    <div className="observation-summary">
      <section
        className="weather-strip"
        aria-label={kma ? '기상청 관측 현황' : 'E-UM 관측 현황'}
        aria-busy={loading}
      >
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
              {observation
                ? `${observationTime(observation.observedAt)}${kma ? ' · 기상청' : ''}`
                : 'E-UM 디지털 트윈 포항'}
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
            : kma && observation?.status === 'current'
              ? '기상청 관측'
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
            kmaNote ??
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
      {extra && <p className="weather-extra">{extra}</p>}
    </div>
  );
}

const clock = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));

/** 기상청 강수·천문연 일출일몰을 한 줄로. 판정이 아니라 참고 정보다. */
function weatherLine(weather: SiteWeather | undefined): string | null {
  if (!weather) return null;
  const parts: string[] = [];
  if (weather.precipitation)
    parts.push(
      weather.precipitation.type === '없음'
        ? `강수 없음 (${clock(weather.precipitation.observedAt)} 실황)`
        : `${weather.precipitation.type}${weather.precipitation.rain1hMm === null ? '' : ` ${weather.precipitation.rain1hMm}mm/시간`} (${clock(weather.precipitation.observedAt)} 실황)`,
    );
  if (weather.rain?.todayMm !== null && weather.rain?.todayMm !== undefined)
    parts.push(`오늘 강수 ${weather.rain.todayMm}mm`);
  if (weather.sun) parts.push(`일출 ${weather.sun.sunrise} · 일몰 ${weather.sun.sunset}`);
  if (!parts.length) return null;
  const sources = [
    weather.precipitation || weather.rain ? '기상청' : null,
    weather.sun ? '한국천문연구원' : null,
  ].filter(Boolean);
  return `${parts.join(' · ')} (${sources.join('·')})`;
}
