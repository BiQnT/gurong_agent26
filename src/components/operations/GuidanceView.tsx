import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  Languages,
  MessageCircle,
  Plus,
  ShieldCheck,
  Send,
} from 'lucide-react';
import type { Guidance, GuidanceReply, Operations } from '../../lib/operations';
import { Facts, date, time, type ViewProps } from './shared';

function responseCounts(item: Guidance) {
  return {
    read: new Set(
      item.replies
        .filter((reply) => reply.kind === 'read' && !reply.simulated)
        .map((reply) => reply.userId),
    ).size,
    completed: new Set(
      item.replies
        .filter((reply) => reply.kind === 'completed' && !reply.simulated)
        .map((reply) => reply.userId),
    ).size,
    questions: item.replies.filter(
      (reply) => reply.kind === 'question' && !reply.simulated && !reply.answer,
    ).length,
  };
}

function QuestionAnswer({
  guidanceId,
  reply,
  operations,
}: {
  guidanceId: string;
  reply: GuidanceReply;
  operations: Operations;
}) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || pending || operations.saving) return;
    setPending(true);
    setFailed(false);
    const saved = await operations.answerQuestion(guidanceId, reply.id, draft);
    setPending(false);
    if (saved) setDraft('');
    else setFailed(true);
  }
  if (reply.answer)
    return (
      <div className="op-question-answer">
        <strong>{reply.answer.userName} · 운영자 답변</strong>
        <p>{reply.answer.text}</p>
        <time dateTime={reply.answer.at}>
          {date(reply.answer.at)} {time(reply.answer.at)}
        </time>
      </div>
    );
  if (!operations.shared || !operations.canManage || reply.simulated) return null;
  return (
    <form className="op-answer-form" onSubmit={submit}>
      <label htmlFor={`answer-${reply.id}`}>질문에 답하기</label>
      <textarea
        id={`answer-${reply.id}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="근로자에게 전달할 답변을 입력해 주세요."
        disabled={pending || operations.saving}
      />
      <div>
        <span>작성한 원문 그대로 전달돼요.</span>
        <button
          type="submit"
          className="op-button op-button--primary op-button--small"
          disabled={!draft.trim() || pending || operations.saving}
        >
          <Send size={13} />
          {pending ? '답변 저장 중…' : '답변 보내기'}
        </button>
      </div>
      {failed && (
        <p className="op-answer-error" role="alert">
          {operations.error || '답변을 저장하지 못했어요. 입력한 내용을 확인한 뒤 다시 보내주세요.'}
        </p>
      )}
    </form>
  );
}

function WorkerPreview({ item }: { item: Guidance }) {
  return (
    <section className="op-worker-preview" aria-label="근로자 안내 미리보기">
      <div className="op-worker-heading">
        <span>
          <Languages size={17} />
          <strong>근로자 안내 미리보기</strong>
        </span>
        <span className="op-demo-pill">한국어 · 베트남어</span>
      </div>
      <div className="op-worker-body">
        <div className="op-worker-language">
          <span className="op-language-flag" aria-hidden="true">
            VN
          </span>
          <div>
            <strong lang="vi">Hướng dẫn công việc</strong>
            <span>베트남어 작업 안내</span>
          </div>
        </div>
        <p className="op-translation" lang="vi">
          {item.translated}
        </p>
        <Facts facts={item.facts} />
        <p className="op-worker-hint">
          근로자는 자신의 계정에서 안내를 확인하고 질문하거나 완료를 보고해요.
        </p>
      </div>
    </section>
  );
}

export function GuidanceView({
  operations,
  initialGuidanceId,
}: ViewProps & { initialGuidanceId?: string }) {
  const [selectedId, setSelectedId] = useState(initialGuidanceId ?? operations.guidance[0]?.id);
  const latestId = operations.guidance[0]?.id;
  const previousLatest = useRef(latestId);
  const previousTarget = useRef(initialGuidanceId);
  const awaitingTarget = useRef(Boolean(initialGuidanceId));
  useEffect(() => {
    if (previousTarget.current !== initialGuidanceId) {
      previousTarget.current = initialGuidanceId;
      awaitingTarget.current = Boolean(initialGuidanceId);
    }
    if (
      awaitingTarget.current &&
      initialGuidanceId &&
      operations.guidance.some((item) => item.id === initialGuidanceId)
    ) {
      setSelectedId(initialGuidanceId);
      awaitingTarget.current = false;
    } else if (!awaitingTarget.current && previousLatest.current !== latestId) {
      setSelectedId(latestId);
    }
    previousLatest.current = latestId;
  }, [initialGuidanceId, latestId, operations.guidance]);
  const selected =
    operations.guidance.find((item) => item.id === selectedId) ?? operations.guidance[0];
  const counts = selected ? responseCounts(selected) : null;
  if (!operations.ready)
    return (
      <section className="op-page">
        <div className="op-page-heading">
          <div>
            <h1>작업 안내</h1>
            <p>
              {operations.loading
                ? '팀의 작업 안내를 불러오고 있어요.'
                : '작업 안내를 불러오지 못했어요.'}
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
      className="op-page op-guidance-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      aria-labelledby="guidance-heading"
    >
      <div className="op-page-heading">
        <div>
          <div className="op-eyebrow">언어가 달라도, 같은 작업을</div>
          <h1 id="guidance-heading">작업 안내</h1>
          <p>안내를 승인해 팀에 공유하고 근로자의 응답을 확인해요.</p>
        </div>
        <button
          className="op-button op-button--primary"
          onClick={operations.openGuidance}
          disabled={operations.loading || operations.saving}
        >
          <Plus size={17} />새 안내 작성
        </button>
      </div>
      <div className="op-approval-banner">
        <span className="op-approval-icon">
          <ShieldCheck size={22} strokeWidth={1.6} />
        </span>
        <div>
          <strong>운영자가 승인한 안내만 팀에 공유돼요.</strong>
          <p>근로자는 선택한 언어로 내용을 확인하고 자신의 응답을 남겨요.</p>
        </div>
        <span className="op-subtle-label">
          한국어 <ArrowRight size={12} /> 베트남어
        </span>
      </div>
      {operations.loading && (
        <p className="op-inline-status" role="status">
          팀의 작업 안내를 불러오고 있어요.
        </p>
      )}
      <div className="op-guidance-layout">
        <aside className="op-guidance-sidebar" aria-label="승인한 안내 목록">
          <div className="op-section-heading">
            <h2>
              승인한 안내 <span>{operations.guidance.length}</span>
            </h2>
          </div>
          {operations.guidance.map((item) => {
            const count = responseCounts(item);
            return (
              <button
                className={`op-guidance-item ${selected?.id === item.id ? 'is-selected' : ''}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                aria-pressed={selected?.id === item.id}
              >
                <div>
                  <span className="op-guidance-icon">
                    <Languages size={18} />
                  </span>
                  <strong>{item.title}</strong>
                  <ChevronRight size={15} />
                </div>
                <p>
                  {date(item.approvedAt)} {time(item.approvedAt)} <span>·</span> 한국어 · 베트남어
                </p>
                <span className="op-guidance-status">
                  <CheckCheck size={12} />
                  확인 {count.read}명 · 완료 보고 {count.completed}명
                  {count.questions > 0 ? ` · 답변 대기 ${count.questions}` : ''}
                </span>
              </button>
            );
          })}
        </aside>
        {selected ? (
          <div className="op-guidance-detail" key={selected.id}>
            <section className="op-card op-original-card">
              <div className="op-section-heading">
                <h2>한국어 원문</h2>
                <span className="op-approved-label">
                  <ShieldCheck size={13} />
                  운영자 승인
                </span>
              </div>
              <p>{selected.original}</p>
              <div className="op-original-footer">
                <span>
                  {date(selected.approvedAt)} {time(selected.approvedAt)} 승인
                </span>
                <span>
                  {operations.batches.find((batch) => batch.id === selected.batchId)?.name ??
                    '덕장 전체 안내'}
                </span>
              </div>
            </section>
            <WorkerPreview item={selected} />
            <section className="op-response-log" aria-label="근로자 응답 기록">
              <div className="op-section-heading">
                <h2>팀 응답</h2>
                <span>
                  확인 {counts?.read}명 · 완료 보고 {counts?.completed}명
                </span>
              </div>
              {selected.replies.length ? (
                <div className="op-card op-replies">
                  {[...selected.replies].reverse().map((reply) => (
                    <div className="op-reply" key={reply.id}>
                      <span className="op-reply-icon">
                        {reply.kind === 'question' ? (
                          <MessageCircle size={15} />
                        ) : reply.kind === 'completed' ? (
                          <CircleCheck size={15} />
                        ) : (
                          <CheckCheck size={15} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {reply.userName ?? '로컬 응답'} ·{' '}
                          {reply.kind === 'question'
                            ? '질문'
                            : reply.kind === 'completed'
                              ? '완료 보고'
                              : '안내 확인'}
                          {reply.simulated ? ' · 시뮬레이션' : ''}
                        </strong>
                        <p>{reply.text}</p>
                        {reply.kind === 'question' && (
                          <QuestionAnswer
                            guidanceId={selected.id}
                            reply={reply}
                            operations={operations}
                          />
                        )}
                      </div>
                      <time dateTime={reply.at}>
                        {date(reply.at)} {time(reply.at)}
                      </time>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="op-no-replies">
                  <MessageCircle size={20} />
                  <p>팀원의 확인이나 질문을 기다리고 있어요.</p>
                </div>
              )}
              <p className="op-demo-footnote">
                완료 보고는 근로자별로 기록돼요. 회수 확인과 배치 종료는 운영자가 따로 승인해주세요.
              </p>
            </section>
          </div>
        ) : !operations.loading ? (
          <div className="op-card op-batch-empty">
            <Languages size={28} />
            <h2>팀에 첫 작업을 알려주세요.</h2>
            <p>널기·회수·상태 확인 중 필요한 안내를 골라 승인해요.</p>
            <button
              className="op-button op-button--primary"
              onClick={operations.openGuidance}
              disabled={operations.saving}
            >
              <Plus size={16} />새 안내 작성
            </button>
          </div>
        ) : null}
      </div>
      <p className="op-demo-footnote">
        <Check size={13} /> 승인한 안내는 같은 덕장에 참여한 근로자의 화면에 표시돼요.
      </p>
    </motion.section>
  );
}
