import {
  Check,
  ChevronDown,
  CloudRain,
  Droplets,
  Globe2,
  Plus,
  ShieldCheck,
  Thermometer,
  Wind,
} from 'lucide-react';
import type { Assessment } from '../../lib/chat';
import { describeThresholds } from '../../lib/drying';

type AssessmentCardProps = {
  assessment: Assessment;
  isDemo: boolean;
  onStart: () => void;
  onGuide: () => void;
};

const observedAtFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function AssessmentCard({ assessment, isDemo, onStart, onGuide }: AssessmentCardProps) {
  const unavailable = assessment.grade === '판정 불가';
  const tone =
    assessment.grade === '적합' ? 'good' : assessment.grade === '주의' ? 'caution' : 'muted';
  const observedAt = assessment.observedAt
    ? `${observedAtFormatter.format(new Date(assessment.observedAt))} KST`
    : '측정값 없음';
  return (
    <section className={`assessment-card ${tone}`} aria-label="건조 조건 판단 결과">
      <div className="assessment-title">
        <span className="eyebrow">건조 조건 판단</span>
        <span className={`grade-pill ${tone}`}>
          <span className="status-dot" />
          {assessment.grade}
        </span>
      </div>
      <h3>{assessment.summary}</h3>
      {!unavailable && (
        <div className="assessment-metrics">
          <div>
            <span>
              <Thermometer size={15} />
              기온
            </span>
            <strong>
              {assessment.temperature}
              <small>°C</small>
            </strong>
          </div>
          <div>
            <span>
              <Droplets size={15} />
              습도
            </span>
            <strong>
              {assessment.humidity}
              <small>%</small>
            </strong>
          </div>
          <div>
            <span>
              <Wind size={15} />
              풍속
            </span>
            <strong>
              {assessment.windSpeed}
              <small>m/s</small>
            </strong>
          </div>
        </div>
      )}
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
      <details className="evidence-details">
        <summary>
          <ShieldCheck size={15} />
          관측 데이터와 판단 근거
          <ChevronDown size={14} />
        </summary>
        <dl>
          <div>
            <dt>관측 시각</dt>
            <dd>{observedAt}</dd>
          </div>
          <div>
            <dt>데이터 경과</dt>
            <dd>
              {assessment.ageMinutes === null ? '확인 불가' : `${assessment.ageMinutes}분`} ·{' '}
              {isDemo ? '시연' : '서버 응답'} 기준
            </dd>
          </div>
          <div>
            <dt>관측 장비</dt>
            <dd>{assessment.deviceName}</dd>
          </div>
          <div>
            <dt>덕장과의 거리</dt>
            <dd>
              {assessment.distanceM === null
                ? '확인 불가'
                : `${assessment.distanceM.toLocaleString()}m`}
            </dd>
          </div>
          <div>
            <dt>수집 경로</dt>
            <dd>{assessment.source}</dd>
          </div>
          {assessment.thresholds && (
            <div>
              <dt>적용 기준</dt>
              <dd>{describeThresholds(assessment.thresholds)}</dd>
            </div>
          )}
        </dl>
        <p>
          {isDemo
            ? '시연용 관측값입니다. 건조 기준은 현장 검증 전 가설이며, 제품의 품질이나 안전을 보증하지 않습니다.'
            : '관측 시점의 환경 조건에 대한 판단입니다. 실제 덕장 환경과 차이가 있을 수 있습니다.'}
        </p>
      </details>
      {!unavailable && (
        <div className="assessment-actions">
          <button className="button-primary" onClick={onStart}>
            <Plus size={15} />
            건조 기록 시작
          </button>
          <button className="button-outline" onClick={onGuide}>
            <Globe2 size={15} />
            작업 안내 만들기
          </button>
        </div>
      )}
    </section>
  );
}
