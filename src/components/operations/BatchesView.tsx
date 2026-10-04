import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Fish,
  Leaf,
  MessageCircle,
  Plus,
  Radio,
} from 'lucide-react';
import { getBatchReport, type Batch } from '../../lib/operations';
import {
  BatchBadge,
  MetricGroup,
  MiniChart,
  date,
  time,
  statusLabels,
  type ViewProps,
} from './shared';

export function BatchesView({
  operations,
  onAsk,
}: ViewProps & { onAsk: (prompt: string) => void }) {
  const [filter, setFilter] = useState<'all' | Batch['status']>('all');
  const { batches, activeBatch } = operations;
  const visible = batches.filter((batch) => filter === 'all' || batch.status === filter);
  const summary = activeBatch ? getBatchReport(activeBatch) : null;
  if (!operations.ready)
    return (
      <section className="op-page">
        <div className="op-page-heading">
          <div>
            <h1>건조 기록</h1>
            <p>
              {operations.loading
                ? '덕장 기록을 불러오고 있어요.'
                : '덕장 기록을 불러오지 못했어요.'}
            </p>
          </div>
        </div>
        {!operations.loading && (
          <div className="op-card op-batch-empty" role="alert">
            <p>{operations.error || '연결을 확인한 뒤 다시 불러와 주세요.'}</p>
            <button
              className="op-button op-button--primary"
              onClick={() => void operations.refresh()}
            >
              다시 불러오기
            </button>
          </div>
        )}
      </section>
    );
  return (
    <motion.section
      className="op-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      aria-labelledby="batch-heading"
    >
      <div className="op-page-heading">
        <div>
          <div className="op-eyebrow">하나의 시작부터, 마지막 회수까지</div>
          <h1 id="batch-heading">건조 기록</h1>
          <p>과메기의 시간을 차곡차곡 기록해요.</p>
        </div>
        <button
          className="op-button op-button--primary"
          onClick={operations.openStart}
          disabled={operations.loading || operations.saving}
        >
          <Plus size={17} />새 배치 시작
        </button>
      </div>
      {operations.loading && (
        <p className="op-inline-status" role="status">
          덕장 기록을 불러오고 있어요.
        </p>
      )}
      {activeBatch ? (
        <section className="op-card op-active-batch" aria-label="진행 중인 배치">
          <div className="op-active-heading">
            <div className="op-batch-title">
              <span className="op-icon-tile">
                <Fish size={24} strokeWidth={1.5} />
              </span>
              <div>
                <div className="op-title-row">
                  <h2>{activeBatch.name}</h2>
                  <BatchBadge status={activeBatch.status} />
                </div>
                <p>
                  운영자 기록 <span>·</span> {activeBatch.fish}{' '}
                  {activeBatch.quantity.toLocaleString()}마리
                </p>
              </div>
            </div>
            <button
              className="op-text-button"
              onClick={() => operations.openReport(activeBatch.id)}
            >
              기록 자세히
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="op-progress-rail">
            <span className="is-done">
              <Check size={12} />
              시작 승인
            </span>
            <i />
            <span className="is-current">
              <Radio size={13} />
              환경 기록
            </span>
            <i />
            <span>
              <span className="op-step-number">3</span>종료 승인
            </span>
          </div>
          <MetricGroup batch={activeBatch} />
          <MiniChart batch={activeBatch} />
          <div className="op-active-footer">
            <div>
              <span>
                <Clock3 size={14} />
                {date(activeBatch.startedAt)} {time(activeBatch.startedAt)} 시작
              </span>
              <span>
                수집 {summary?.totalSamples}회 <span className="op-muted">·</span> 결측{' '}
                {summary?.missingRate === null ? '—' : `${summary?.missingRate}%`}
              </span>
            </div>
            <button
              className="op-button op-button--soft"
              onClick={() => operations.openEnd(activeBatch.id)}
            >
              회수하고 종료하기
              <ArrowRight size={15} />
            </button>
          </div>
        </section>
      ) : (
        <section className="op-card op-batch-empty">
          <span className="op-icon-tile">
            <Leaf size={24} />
          </span>
          <h2>새로운 건조를 시작할 준비가 됐어요.</h2>
          <p>배치를 시작하면 널기부터 회수까지 한 기록으로 모을 수 있어요.</p>
          <button
            className="op-button op-button--primary"
            onClick={operations.openStart}
            disabled={operations.loading || operations.saving}
          >
            <Plus size={16} />새 배치 시작
          </button>
        </section>
      )}
      <section className="op-records" aria-labelledby="batch-list-heading">
        <div className="op-section-heading">
          <h2 id="batch-list-heading">
            배치 기록 <span>{batches.length}</span>
          </h2>
          <span className="op-subtle-label">
            {operations.shared ? '덕장 팀과 공유하는 기록' : '이 브라우저에 저장돼요'}
          </span>
        </div>
        <div className="op-filter-row" aria-label="배치 상태 필터">
          {(['all', 'ongoing', 'completed', 'cancelled'] as const).map((item) => (
            <button
              key={item}
              aria-pressed={filter === item}
              className={filter === item ? 'is-selected' : ''}
              onClick={() => setFilter(item)}
            >
              {item === 'all' ? '전체' : statusLabels[item]}
              <span>
                {batches.filter((batch) => item === 'all' || batch.status === item).length}
              </span>
            </button>
          ))}
        </div>
        <div className="op-card op-batch-list">
          {visible.length ? (
            visible.map((batch) => (
              <button
                key={batch.id}
                className="op-batch-row"
                onClick={() => operations.openReport(batch.id)}
              >
                <span className={`op-record-icon ${batch.status === 'ongoing' ? 'is-active' : ''}`}>
                  {batch.status === 'ongoing' ? <Radio size={20} /> : <FileText size={20} />}
                </span>
                <span className="op-record-name">
                  <strong>{batch.name}</strong>
                  <span>
                    {date(batch.startedAt)} {time(batch.startedAt)} <span>·</span>{' '}
                    {batch.quantity.toLocaleString()}마리
                  </span>
                </span>
                <span className="op-row-count">관측 {batch.observations.length}회</span>
                <BatchBadge status={batch.status} />
                <ChevronRight className="op-row-chevron" size={17} />
              </button>
            ))
          ) : (
            <div className="op-empty-filter">
              <FileText size={24} />
              <p>
                {filter === 'all'
                  ? '기록된 배치가 없어요.'
                  : `${statusLabels[filter]} 상태의 배치가 없어요.`}
              </p>
            </div>
          )}
        </div>
      </section>
      <button
        className="op-question-link"
        onClick={() => onAsk('지금 진행 중인 배치의 건조 환경을 알려줘')}
      >
        <MessageCircle size={17} />
        <span>건조 조건이 궁금하다면 에이전트에게 물어보세요.</span>
        <ArrowRight size={16} />
      </button>
      <p className="op-demo-footnote">
        <span className="op-tiny-dot" />
        승인한 배치와 확인한 관측값을 덕장별로 저장해요. 최신 관측값은 직접 확인해 기록해주세요.
      </p>
    </motion.section>
  );
}
