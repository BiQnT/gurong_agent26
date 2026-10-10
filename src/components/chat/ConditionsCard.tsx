import {
  Check,
  ChevronDown,
  CloudRain,
  Droplets,
  ExternalLink,
  Globe2,
  MapPin,
  Plus,
  ShieldCheck,
  Thermometer,
  Wind,
} from 'lucide-react';
import type { Assessment } from '../../lib/chat';
import { describeThresholds, isKmaSource, sourceName } from '../../lib/drying';
import { formatDistance } from '../../lib/geo';
import type { LiveObservation } from '../../lib/live';

// 현재 건조 환경 카드. 판정(규칙 함수)과 그 판정에 쓴 관측을 한 장에 보여 준다 (QA: 두 카드의 숫자가 겹쳤다).

type ConditionsCardProps = {
  assessment?: Assessment;
  observation?: LiveObservation;
  /** 답에 같은 버튼이 따로 있으면 카드 안 버튼은 숨긴다 */
  hideStart?: boolean;
  hideGuide?: boolean;
  onStart: () => void;
  onGuide: () => void;
};

/** 관측 시각을 한국 시간 `2026. 10. 09. 13:20` 로. */
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

export const gradeTone = (grade?: string) =>
  grade === '적합' ? 'good' : grade === '주의' ? 'caution' : grade === '부적합' ? 'bad' : 'muted';

export function ConditionsCard({
  assessment,
  observation,
  hideStart,
  hideGuide,
  onStart,
  onGuide,
}: ConditionsCardProps) {
  const graded = assessment && assessment.grade !== '판정 불가';
  const values = graded
    ? {
        temperature: assessment.temperature,
        humidity: assessment.humidity,
        windSpeed: assessment.windSpeed,
      }
    : {
        temperature: observation?.temperature ?? null,
        humidity: observation?.humidity ?? null,
        windSpeed: observation?.windSpeed ?? null,
      };
  const provider = observation?.device.provider;
  const kma = isKmaSource(provider);
  const deviceName = observation?.device.name ?? assessment?.deviceName ?? '관측기 없음';
  const distance = observation?.distanceM ?? assessment?.distanceM ?? null;
  const observedAt = observation?.observedAt ?? assessment?.observedAt ?? null;
  const ageMinutes = observation?.ageMinutes ?? assessment?.ageMinutes ?? null;
  const showActions = graded && (!hideStart || !hideGuide);
  return (
    <section
      className={`assessment-card conditions-card ${gradeTone(assessment?.grade)}`}
      aria-label="현재 건조 환경"
    >
      <div className="assessment-title">
        <span className="eyebrow">현재 건조 환경</span>
        {assessment && (
          <span className={`grade-pill ${gradeTone(assessment.grade)}`}>
            <span className="status-dot" />
            {assessment.grade}
          </span>
        )}
      </div>
      <h3>{assessment?.summary ?? `${deviceName}의 관측값이에요. 덕장 기준 판정은 없어요.`}</h3>
      <div className="assessment-metrics">
        <div>
          <span>
            <Thermometer size={15} />
            기온
          </span>
          <strong>
            {values.temperature ?? '-'}
            <small>°C</small>
          </strong>
        </div>
        <div>
          <span>
            <Droplets size={15} />
            습도
          </span>
          <strong>
            {values.humidity ?? '-'}
            <small>%</small>
          </strong>
        </div>
        <div>
          <span>
            <Wind size={15} />
            풍속
          </span>
          <strong>
            {values.windSpeed ?? '-'}
            <small>m/s</small>
          </strong>
        </div>
      </div>
      <p className="conditions-where">
        <MapPin size={14} />
        <span>
          {deviceName} · {provider === 'kma-grid' ? '격자 중심까지' : '덕장에서'}{' '}
          {formatDistance(distance)} · {observationTime(observedAt)} 측정
          {ageMinutes === null ? '' : ` (${ageMinutes}분 전)`} ·{' '}
          {provider === 'kma-grid' ? '기상청 격자' : kma ? '기상청 AWS' : 'E-UM'}
        </span>
      </p>
      {assessment && (
        <div className="assessment-reasons">
          {assessment.reasons.map((reason, index) => (
            <p key={index}>
              <Check size={14} />
              {reason}
            </p>
          ))}
          {assessment.advice?.map((advice, index) => (
            <p key={`advice-${index}`} className="assessment-advice">
              <CloudRain size={14} />
              {advice}
            </p>
          ))}
        </div>
      )}
      <details className="evidence-details">
        <summary>
          <ShieldCheck size={15} />
          관측 데이터와 판단 근거
          <ChevronDown size={14} />
        </summary>
        <dl>
          <div>
            <dt>관측 장비</dt>
            <dd>
              {deviceName}
              {observation ? ` · ${observation.device.id}` : ''}
            </dd>
          </div>
          {observation && (
            <>
              <div>
                <dt>원본 시각</dt>
                <dd>{observation.observedAtRaw ?? '없음'}</dd>
              </div>
              <div>
                <dt>장비 위치</dt>
                <dd>
                  {observation.device.latitude.toFixed(6)},{' '}
                  {observation.device.longitude.toFixed(6)}
                </dd>
              </div>
            </>
          )}
          {assessment && (
            <div>
              <dt>수집 경로</dt>
              <dd>{assessment.source}</dd>
            </div>
          )}
          {assessment?.thresholds && (
            <div>
              <dt>적용 기준</dt>
              <dd>{describeThresholds(assessment.thresholds)}</dd>
            </div>
          )}
        </dl>
        {observation?.issues.map((issue, index) => (
          <p key={index}>{issue}</p>
        ))}
        <p>
          관측 시점의 환경에 대한 판단이에요. 기준은 현장 검증 전 가설값이고, 실제 덕장 환경과 다를
          수 있으며 품질이나 안전을 보증하지 않아요.
        </p>
        <a
          className="source-link"
          href={kma ? 'https://apihub.kma.go.kr/' : 'https://pohang-eum.kr/data/list/1'}
          target="_blank"
          rel="noreferrer"
        >
          {kma ? sourceName(provider) : 'E-UM 대기환경 데이터'}
          <ExternalLink size={12} />
        </a>
      </details>
      {showActions && (
        <div className="assessment-actions">
          {!hideStart && (
            <button className="button-primary" onClick={onStart}>
              <Plus size={15} />
              건조 기록 시작
            </button>
          )}
          {!hideGuide && (
            <button className="button-outline" onClick={onGuide}>
              <Globe2 size={15} />
              작업 안내 만들기
            </button>
          )}
        </div>
      )}
    </section>
  );
}
