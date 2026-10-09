import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleCheck,
  FileText,
  Fish,
  MessageCircle,
  Plus,
  Radio,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  downloadBatchReport,
  getBatchReport,
  measuredObservations,
  GUIDANCE_FACTS,
  GUIDANCE_TEMPLATES,
  type Batch,
  type StartPrefill,
} from '../../lib/operations';
import { evaluateBatch, kst } from '../../lib/drying';
import {
  BatchBadge,
  Facts,
  MetricGroup,
  MiniChart,
  date,
  time,
  value,
  type ViewProps,
} from './shared';

function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  busy = false,
  error = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) ?? [],
      );
    const firstInput = ref.current?.querySelector<HTMLElement>('input, select, textarea');
    (firstInput ?? focusable()[0] ?? ref.current)?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!elements.length) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || !ref.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);
  return (
    <motion.div
      className="op-modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        className={`op-modal ${wide ? 'op-modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2 }}
      >
        <div className="op-modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="op-icon-button" onClick={onClose} aria-label="창 닫기" disabled={busy}>
            <X size={20} />
          </button>
        </div>
        {error && (
          <div className="op-save-error" role="alert">
            {error}
            <span>입력한 내용은 유지돼요. 확인 후 다시 승인해 주세요.</span>
          </div>
        )}
        {busy && (
          <p className="op-inline-status" role="status">
            덕장 기록을 저장하고 있어요.
          </p>
        )}
        <fieldset className="op-dialog-fields" disabled={busy}>
          {children}
        </fieldset>
      </motion.div>
    </motion.div>
  );
}

function StartDialog({ operations, prefill }: ViewProps & { prefill?: StartPrefill }) {
  const [name, setName] = useState('');
  const [fish, setFish] = useState<'꽁치' | '청어'>(prefill?.fish ?? '꽁치');
  const [quantity, setQuantity] = useState(prefill?.quantity ? String(prefill.quantity) : '');
  const [note, setNote] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    operations.approveStart({ name, fish, quantity: Number(quantity), note });
  }
  return (
    <Dialog
      title="새 배치를 시작할까요?"
      subtitle="널기부터 회수까지, 하나의 건조 기록으로 남겨요."
      onClose={operations.closeDialog}
      busy={operations.saving}
      error={operations.error}
    >
      <form onSubmit={submit} className="op-form">
        <label htmlFor="batch-name">
          배치 이름
          <input
            id="batch-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="예: 오늘 꽁치 건조"
            required
            maxLength={40}
            autoComplete="off"
          />
        </label>
        <div className="op-form-row">
          <label htmlFor="batch-fish">
            어종
            <select
              id="batch-fish"
              value={fish}
              onChange={(event) => setFish(event.target.value as '꽁치' | '청어')}
            >
              <option>꽁치</option>
              <option>청어</option>
            </select>
          </label>
          <label htmlFor="batch-quantity">
            수량
            <div className="op-input-unit">
              <input
                id="batch-quantity"
                type="number"
                min="1"
                max="100000"
                step="1"
                required
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <span>마리</span>
            </div>
          </label>
        </div>
        <label htmlFor="batch-note">
          메모 <span className="op-optional">선택</span>
          <textarea
            id="batch-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="덕장 위치나 특이사항을 남겨주세요."
            rows={2}
            maxLength={500}
          />
        </label>
        <div className="op-form-info">
          <ShieldCheck size={17} />
          <p>
            시작을 승인하면 배치가 기록돼요.
            <br />
            <span>
              기록 시작 후 30분마다 관측값이 자동으로 쌓이고, 최신 관측값을 직접 확인해 추가할 수도
              있어요.
            </span>
          </p>
        </div>
        <div className="op-modal-actions">
          <button
            type="button"
            className="op-button op-button--white"
            onClick={operations.closeDialog}
          >
            돌아가기
          </button>
          <button
            type="submit"
            className="op-button op-button--primary"
            disabled={!name.trim() || Number(quantity) < 1}
          >
            <Check size={16} />
            승인하고 시작
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function EndDialog({ operations, batch }: ViewProps & { batch: Batch }) {
  const [note, setNote] = useState(batch.note);
  return (
    <Dialog
      title="회수를 마치셨나요?"
      subtitle="운영자가 확인하면 배치를 종료하고 기록을 만들어요."
      onClose={operations.closeDialog}
      busy={operations.saving}
      error={operations.error}
    >
      <form
        className="op-form"
        onSubmit={(event) => {
          event.preventDefault();
          operations.approveEnd(batch.id, note);
        }}
      >
        <div className="op-confirm-batch">
          <span className="op-icon-tile">
            <Fish size={22} />
          </span>
          <div>
            <strong>{batch.name}</strong>
            <span>
              {batch.fish} {batch.quantity.toLocaleString()}마리 <span>·</span> 관측{' '}
              {measuredObservations(batch).length}회
            </span>
          </div>
          <BatchBadge status={batch.status} />
        </div>
        <label htmlFor="end-note">
          마무리 메모 <span className="op-optional">선택</span>
          <textarea
            id="end-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="건조 상태, 회수 시 특이사항 등을 남겨주세요."
          />
        </label>
        <div className="op-form-info">
          <FileText size={17} />
          <p>기온·습도·풍속과 결측률, 장비 거리, 경보 횟수가 기록에 포함돼요.</p>
        </div>
        <div className="op-modal-actions">
          <button
            type="button"
            className="op-button op-button--white"
            onClick={operations.closeDialog}
          >
            계속 진행
          </button>
          <button type="submit" className="op-button op-button--primary">
            <Check size={16} />
            승인하고 종료
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function GuidanceDialog({ operations }: ViewProps) {
  const facts = operations.dialog?.type === 'guidance' ? operations.dialog.facts : GUIDANCE_FACTS;
  const [templateId, setTemplateId] = useState<string>(facts.grade === '적합' ? 'spread' : 'check');
  const [batchId, setBatchId] = useState(operations.activeBatch?.id ?? '');
  const template = GUIDANCE_TEMPLATES.find((item) => item.id === templateId)!;
  return (
    <Dialog
      title="작업 안내 작성"
      subtitle="전달할 한국어 원문을 먼저 확인해주세요."
      onClose={operations.closeDialog}
      busy={operations.saving}
      error={operations.error}
    >
      <form
        className="op-form"
        onSubmit={(event) => {
          event.preventDefault();
          operations.approveGuidance(templateId, batchId || undefined);
        }}
      >
        <div className="op-form-row">
          <label htmlFor="guide-batch">
            연결할 배치
            <select
              id="guide-batch"
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
            >
              <option value="">배치 지정 없음</option>
              {operations.batches
                .filter((batch) => batch.status === 'ongoing')
                .map((batch) => (
                  <option value={batch.id} key={batch.id}>
                    {batch.name}
                  </option>
                ))}
            </select>
          </label>
          <label htmlFor="guide-language">
            안내 언어
            <select id="guide-language" defaultValue="vi">
              <option value="vi">베트남어 · 정형 번역</option>
            </select>
          </label>
        </div>
        <label htmlFor="guide-task">
          작업 내용
          <select
            id="guide-task"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {GUIDANCE_TEMPLATES.map((item) => (
              <option value={item.id} key={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="op-draft">
          <span>한국어 원문</span>
          <p>{template.original}</p>
        </div>
        <Facts facts={facts} />
        <p className="op-form-caption">
          널기·회수·상태 확인 안내를 한국어와 베트남어로 준비했어요. 승인하면 이 덕장의 근로자
          화면에 안내가 표시돼요.
        </p>
        <div className="op-modal-actions">
          <button
            type="button"
            className="op-button op-button--white"
            onClick={operations.closeDialog}
          >
            돌아가기
          </button>
          <button type="submit" className="op-button op-button--primary">
            <ShieldCheck size={16} />
            승인하고 팀에 공유
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ReportDialog({ operations, batch }: ViewProps & { batch: Batch }) {
  const [tab, setTab] = useState<'summary' | 'observations' | 'activity'>('summary');
  const summary = batch.report ?? getBatchReport(batch);
  const evaluation = evaluateBatch(batch.observations);
  return (
    <Dialog
      title={batch.name}
      subtitle={`${date(batch.startedAt, true)} ${time(batch.startedAt)} 시작${batch.endedAt ? ` · ${date(batch.endedAt)} ${time(batch.endedAt)} ${batch.status === 'cancelled' ? '취소' : '종료'}` : ''} · ${batch.fish} ${batch.quantity.toLocaleString()}마리`}
      onClose={operations.closeDialog}
      busy={operations.saving}
      error={operations.error}
      wide
    >
      <div className="op-report-toolbar">
        <BatchBadge status={batch.status} />
        <span className="op-demo-pill">
          {operations.shared ? '덕장 생산 기록' : '로컬 생산 기록'}
        </span>
        <button className="op-text-button" onClick={() => downloadBatchReport(batch)}>
          <ArrowDownToLine size={15} />
          기록 내려받기
        </button>
      </div>
      <div className="op-report-tabs" role="tablist" aria-label="건조 기록 상세">
        {(
          [
            { id: 'summary', name: '기록 요약' },
            { id: 'observations', name: `환경 기록 ${summary.totalSamples}` },
            { id: 'activity', name: '활동 이력' },
          ] as const
        ).map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`report-panel-${item.id}`}
            id={`report-tab-${item.id}`}
            onClick={() => setTab(item.id)}
            key={item.id}
            className={tab === item.id ? 'is-selected' : ''}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div
        className="op-report-content"
        role="tabpanel"
        id={`report-panel-${tab}`}
        aria-labelledby={`report-tab-${tab}`}
      >
        {tab === 'summary' && (
          <>
            <MetricGroup batch={batch} />
            <MiniChart batch={batch} />
            <div className="op-report-stats">
              <div>
                <span>결측률</span>
                <strong>{value(summary.missingRate, '%')}</strong>
                <small>
                  {summary.totalSamples - summary.validSamples} / {summary.totalSamples}회 결측·검증
                  제외
                </small>
              </div>
              <div>
                <span>장비 거리</span>
                <strong>{value(summary.distanceM, 'm')}</strong>
                <small>
                  {summary.distanceValidated
                    ? '덕장 기준 최대 거리'
                    : '일부 거리 미확인 또는 1km 초과'}
                </small>
              </div>
              <div>
                <span>경보 횟수</span>
                <strong>{summary.alertCount}회</strong>
                <small>부적합 진입 시 30분 수집기가 기록 · 1시간 간격</small>
              </div>
            </div>
            <div className="op-report-note op-report-evaluation">
              <span>건조 판정 분포 · 지금 기준으로 다시 계산</span>
              <p>{evaluation.summary}</p>
              {evaluation.firstUnsuitableAt && (
                <p>처음 부적합: {kst(evaluation.firstUnsuitableAt)}</p>
              )}
              <small>
                {evaluation.thresholds.version} · 기록마다 그때의 판정은 활동 이력에 남아 있어요.
              </small>
            </div>
            {batch.note && (
              <div className="op-report-note">
                <span>운영자 메모</span>
                <p>{batch.note}</p>
              </div>
            )}
            {batch.status === 'ongoing' && operations.canManage && (
              <div className="op-sample-controls">
                <div>
                  <Radio size={16} />
                  <span>확인한 관측값 기록</span>
                </div>
                <div>
                  <button
                    className="op-button op-button--white op-button--small"
                    disabled={
                      !operations.currentObservation || Boolean(operations.observationIssue)
                    }
                    title={operations.observationIssue ?? undefined}
                    onClick={() => {
                      if (operations.currentObservation)
                        operations.recordObservation(batch.id, operations.currentObservation);
                    }}
                  >
                    <Plus size={13} />
                    현재 관측값 기록
                  </button>
                </div>
              </div>
            )}
            {batch.status === 'ongoing' && operations.observationIssue && (
              <p className="op-demo-footnote">{operations.observationIssue}</p>
            )}
            <p className="op-demo-footnote">
              기록한 관측값의 유효한 항목만 집계해요. 거리가 확인되어도 현장 대표성이나 건조
              적합성을 보증하지 않아요.
            </p>
          </>
        )}
        {tab === 'observations' && (
          <div className="op-observations-table">
            <table>
              <thead>
                <tr>
                  <th>실제 관측 시각</th>
                  <th>기온</th>
                  <th>습도</th>
                  <th>풍속</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {[...batch.observations].reverse().map((item) => (
                  <tr key={`${item.sourceDeviceId}-${item.observedAt}`}>
                    <td>
                      {date(item.observedAt)} <strong>{time(item.observedAt)}</strong>
                      <small>{item.sourceDeviceName}</small>
                    </td>
                    <td>{value(item.temperature, '°C')}</td>
                    <td>{value(item.humidity, '%')}</td>
                    <td>{value(item.wind, 'm/s')}</td>
                    <td>
                      {item.distanceM !== null && item.distanceM > 1000 ? (
                        <span className="op-missing-tag">거리 초과</span>
                      ) : item.temperature === null ||
                        item.humidity === null ||
                        item.wind === null ? (
                        <span className="op-missing-tag">결측</span>
                      ) : (
                        <span className="op-valid-tag">관측값</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!batch.observations.length && (
              <div className="op-empty-filter">
                <Radio size={24} />
                <p>아직 기록한 관측값이 없어요.</p>
              </div>
            )}
          </div>
        )}
        {tab === 'activity' && (
          <ol className="op-timeline">
            {[...batch.logs].reverse().map((log) => (
              <li key={log.id}>
                <span className={`op-timeline-icon ${log.kind === 'alert' ? 'is-alert' : ''}`}>
                  {log.kind === 'alert' ? (
                    <TriangleAlert size={14} />
                  ) : log.kind === 'worker' ? (
                    <MessageCircle size={14} />
                  ) : log.kind === 'observation' ? (
                    <Radio size={14} />
                  ) : (
                    <Check size={14} />
                  )}
                </span>
                <div>
                  <strong>{log.title}</strong>
                  <p>{log.detail}</p>
                  <time dateTime={log.at}>
                    {date(log.at)} {time(log.at)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="op-modal-actions op-report-actions">
        {batch.status === 'ongoing' && operations.canManage ? (
          <>
            <button
              className="op-text-button op-danger-text"
              onClick={() => operations.openCancel(batch.id)}
            >
              배치 취소
            </button>
            <button
              className="op-button op-button--primary"
              onClick={() => operations.openEnd(batch.id)}
            >
              회수하고 종료하기
              <ArrowRight size={15} />
            </button>
          </>
        ) : (
          <button className="op-button op-button--primary" onClick={operations.closeDialog}>
            확인했어요
          </button>
        )}
      </div>
    </Dialog>
  );
}

export function OperationsDialogs({ operations }: ViewProps) {
  const { dialog, notice } = operations;
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => operations.dismissNotice(), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const batch =
    dialog && 'batchId' in dialog
      ? operations.batches.find((item) => item.id === dialog.batchId)
      : undefined;
  return createPortal(
    <>
      <AnimatePresence mode="wait">
        {dialog?.type === 'start' && (
          <StartDialog key="start" operations={operations} prefill={dialog.prefill} />
        )}
        {dialog?.type === 'end' && batch && (
          <EndDialog key={`end-${batch.id}`} operations={operations} batch={batch} />
        )}
        {dialog?.type === 'guidance' && <GuidanceDialog key="guidance" operations={operations} />}
        {dialog?.type === 'report' && batch && (
          <ReportDialog key={`report-${batch.id}`} operations={operations} batch={batch} />
        )}
        {dialog?.type === 'cancel' && batch && (
          <Dialog
            key="cancel"
            title="이 배치를 취소할까요?"
            subtitle="지금까지의 기록은 그대로 보관돼요."
            onClose={operations.closeDialog}
            busy={operations.saving}
            error={operations.error}
          >
            <div className="op-cancel-body">
              <p>
                <strong>{batch.name}</strong>의 진행을 중단하고 취소 상태로 기록해요.
              </p>
              <div className="op-modal-actions">
                <button className="op-button op-button--white" onClick={operations.closeDialog}>
                  돌아가기
                </button>
                <button
                  className="op-button op-button--danger"
                  onClick={() => operations.approveCancel(batch.id)}
                >
                  승인하고 취소
                </button>
              </div>
            </div>
          </Dialog>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {notice && (
          <motion.div
            className="op-toast"
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <CircleCheck size={18} />
            <span>{notice}</span>
            <button aria-label="알림 닫기" onClick={operations.dismissNotice}>
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {!operations.storageAvailable && (
        <div className="op-storage-warning" role="status">
          브라우저 저장 공간을 사용할 수 없어 이번 화면에서만 기록이 유지돼요.
        </div>
      )}
      {operations.error && !dialog && (
        <div className="op-storage-warning op-network-warning" role="alert">
          <span>{operations.error}</span>
          <button
            onClick={() => void operations.refresh()}
            disabled={operations.loading || operations.saving}
          >
            다시 불러오기
          </button>
          <button onClick={operations.dismissError} aria-label="오류 알림 닫기">
            <X size={16} />
          </button>
        </div>
      )}
    </>,
    document.body,
  );
}
