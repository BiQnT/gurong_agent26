import { ChevronDown, Clock3, Table2 } from 'lucide-react';
import type {
  BatchDigest,
  ForecastOutlook,
  GradeCounts,
  HistorySummary,
  Stat,
} from '../../lib/analysis';
import { gradeTone } from './ConditionsCard';

// AI 가 과거·예보·배치 도구를 봤을 때 답 위에 붙는 카드. 숫자는 모두 서버의 코드가 계산한 값이다.

const GRADE_ORDER = ['적합', '주의', '부적합', '제외'] as const;
const GRADE_LABEL: Record<(typeof GRADE_ORDER)[number], string> = {
  적합: '적합',
  주의: '주의',
  부적합: '부적합',
  제외: '제외',
};
const GRADE_CLASS: Record<(typeof GRADE_ORDER)[number], string> = {
  적합: 'good',
  주의: 'caution',
  부적합: 'bad',
  제외: 'none',
};
const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const hourFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const value = (number: number | null, unit: string) => (number === null ? '-' : `${number}${unit}`);
const shortDate = (date: string) => `${date.slice(5, 7)}.${date.slice(8, 10)}`;

function GradeLegend() {
  return (
    <div className="grade-legend" aria-hidden="true">
      {GRADE_ORDER.map((grade) => (
        <span key={grade}>
          <i className={`grade-swatch ${GRADE_CLASS[grade]}`} />
          {GRADE_LABEL[grade]}
        </span>
      ))}
    </div>
  );
}

/** 등급별 시간을 한 줄 막대로. 칸 전체 시간(24시간·주)에 맞춰 그려 결측은 빈 칸으로 남는다. */
function GradeBar({ hours, span, label }: { hours: GradeCounts; span: number; label: string }) {
  const filled = GRADE_ORDER.reduce((sum, grade) => sum + hours[grade], 0);
  const missing = Math.max(0, span - filled);
  const title = `${label} · 적합 ${hours.적합}시간 · 주의 ${hours.주의}시간 · 부적합 ${hours.부적합}시간 · 제외 ${hours.제외}시간${missing ? ` · 자료 없음 ${Math.round(missing * 10) / 10}시간` : ''}`;
  return (
    <div className="grade-bar" role="img" aria-label={title} title={title}>
      {GRADE_ORDER.map((grade) =>
        hours[grade] > 0 ? (
          <i
            key={grade}
            className={GRADE_CLASS[grade]}
            style={{ width: `${(hours[grade] / Math.max(span, filled)) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

const mean = (stat: Stat, unit: string) => value(stat.mean, unit);

export function HistoryCard({ history }: { history: HistorySummary }) {
  const span = history.resolution === 'day' ? 24 : 24 * 7;
  const total = history.totals;
  const source = (
    <p className="analysis-note">
      {history.station}
      {history.distanceM === null
        ? ''
        : ` · 덕장에서 ${history.distanceM.toLocaleString()}m`} · {history.source} · 결측{' '}
      {history.missingRate}%{history.rainKnown ? '' : ' · 강수 자료 없음(비·눈 제외)'}
    </p>
  );
  // 판정할 표본이 하나도 없으면 빈 막대·표 대신 자료가 없다는 것만 보여 준다.
  if (!total.gradeHours.적합 && !total.gradeHours.주의 && !total.gradeHours.부적합)
    return (
      <section className="assessment-card analysis-card" aria-label="기간 건조 조건 요약">
        <div className="assessment-title">
          <span className="eyebrow">기간 요약</span>
          <span className="grade-pill muted">
            {shortDate(history.from)}~{shortDate(history.to)}
          </span>
        </div>
        <h3>이 기간에는 판정할 자료가 없어요.</h3>
        {source}
      </section>
    );
  return (
    <section className="assessment-card analysis-card" aria-label="기간 건조 조건 요약">
      <div className="assessment-title">
        <span className="eyebrow">기간 요약</span>
        <span className="grade-pill muted">
          {shortDate(history.from)}~{shortDate(history.to)}
        </span>
      </div>
      <h3>
        적합 {total.gradeHours.적합}시간 ({total.percentages.적합}%) · 주의 {total.gradeHours.주의}
        시간 · 부적합 {total.gradeHours.부적합}시간
      </h3>
      <div className="assessment-metrics">
        <div>
          <span>평균 기온</span>
          <strong>
            {total.temperature.mean ?? '-'}
            <small>°C</small>
          </strong>
        </div>
        <div>
          <span>평균 습도</span>
          <strong>
            {total.humidity.mean ?? '-'}
            <small>%</small>
          </strong>
        </div>
        <div>
          <span>평균 풍속</span>
          <strong>
            {total.windSpeed.mean ?? '-'}
            <small>m/s</small>
          </strong>
        </div>
      </div>
      <GradeLegend />
      <div className="grade-rows">
        {history.rows.map((row) => (
          <div className="grade-row" key={row.label}>
            <span className="grade-row-label">{row.label}</span>
            <GradeBar hours={row.gradeHours} span={span} label={row.label} />
            <span className="grade-row-value">{row.gradeHours.적합}h</span>
          </div>
        ))}
      </div>
      {source}
      <details className="evidence-details">
        <summary>
          <Table2 size={15} />
          {history.resolution === 'day' ? '날짜별' : '주별'} 표로 보기
          <ChevronDown size={14} />
        </summary>
        <div className="analysis-table-wrap">
          <table className="analysis-table">
            <thead>
              <tr>
                <th>{history.resolution === 'day' ? '날짜' : '주'}</th>
                <th>기온</th>
                <th>습도</th>
                <th>풍속</th>
                <th>강수</th>
                <th>적합</th>
                {history.resolution === 'day' && <th>가장 긴 적합</th>}
              </tr>
            </thead>
            <tbody>
              {history.rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{mean(row.temperature, '°C')}</td>
                  <td>{mean(row.humidity, '%')}</td>
                  <td>{mean(row.windSpeed, 'm/s')}</td>
                  <td>{value(row.rainMm, 'mm')}</td>
                  <td>{row.gradeHours.적합}시간</td>
                  {history.resolution === 'day' && <td>{row.bestWindow ?? '-'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          시간마다 같은 규칙 함수({history.thresholds})로 매긴 등급이에요. 관측 지점의 값이라 덕장
          환경과 다를 수 있어요.
        </p>
      </details>
    </section>
  );
}

export function ForecastCard({ forecast }: { forecast: ForecastOutlook }) {
  return (
    <section className="assessment-card analysis-card" aria-label="예보 예상 등급">
      <div className="assessment-title">
        <span className="eyebrow">예보 예상 등급</span>
        <span className="grade-pill muted">
          <Clock3 size={12} />
          {hourFormatter.format(new Date(forecast.issuedAt))} 발표
        </span>
      </div>
      <ol className="forecast-hours">
        {forecast.hours.map((hour) => (
          <li key={hour.at}>
            <span className="forecast-time">{hourFormatter.format(new Date(hour.at))}</span>
            <span className={`grade-pill ${gradeTone(hour.expectedGrade)}`}>
              {hour.expectedGrade}
            </span>
            <span className="forecast-values">
              {value(hour.temperature, '°C')} · {value(hour.humidity, '%')} ·{' '}
              {value(hour.windSpeed, 'm/s')}
              {hour.precipitation !== '없음' ? ` · ${hour.precipitation}` : ''}
            </span>
          </li>
        ))}
      </ol>
      <p className="analysis-note">
        {forecast.source}에 같은 규칙({forecast.thresholds})을 적용한 예상이에요. 현재 판정이
        아니에요.
      </p>
    </section>
  );
}

export function BatchCards({ batches }: { batches: BatchDigest[] }) {
  return (
    <section className="assessment-card analysis-card" aria-label="배치 기록 요약">
      <div className="assessment-title">
        <span className="eyebrow">배치 기록</span>
        <span className="grade-pill muted">{batches.length}개</span>
      </div>
      <ul className="batch-digests">
        {batches.map((batch) => (
          <li key={`${batch.name}-${batch.startedAt}`}>
            <div className="batch-digest-head">
              <strong>{batch.name}</strong>
              <span className="grade-pill muted">{batch.status}</span>
            </div>
            <p>
              {batch.fish} {batch.quantity.toLocaleString()}마리 ·{' '}
              {timeFormatter.format(new Date(batch.startedAt))} 시작 · {batch.elapsedHours}시간
            </p>
            {batch.percentages ? (
              <GradeBar
                hours={{
                  적합: batch.percentages.적합,
                  주의: batch.percentages.주의,
                  부적합: batch.percentages.부적합,
                  제외: 0,
                }}
                span={100}
                label={`${batch.name} 등급 비율 (%)`}
              />
            ) : null}
            <p className="analysis-note">
              {batch.percentages
                ? `적합 ${batch.percentages.적합}% · 주의 ${batch.percentages.주의}% · 부적합 ${batch.percentages.부적합}% · `
                : '판정할 표본 없음 · '}
              표본 {batch.samples}개 · 결측 {batch.missingRate ?? '-'}% · 경보 {batch.alerts}건 ·
              평균 {mean(batch.temperature, '°C')} / {mean(batch.humidity, '%')} /{' '}
              {mean(batch.windSpeed, 'm/s')}
            </p>
          </li>
        ))}
      </ul>
      {batches.some((batch) => batch.percentages) && <GradeLegend />}
    </section>
  );
}
