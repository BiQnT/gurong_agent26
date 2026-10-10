import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ClipboardList, MessageSquare, Plus, Users, Wind } from 'lucide-react';
import type { Account, Site } from '../lib/workspace';
import { workspaceApi } from '../lib/workspace';
import type { Operations } from '../lib/operations';
import type { useLiveObservations } from '../hooks/useLiveObservations';
import type { View } from '../types/ui';
import { ObservationSummary } from './chat/ObservationSummary';
import { formatDistance } from '../lib/geo';
import { BatchBadge, date, time } from './operations/shared';
import './owner-home.css';

type Props = {
  user: Account;
  site: Site;
  operations: Operations;
  live: ReturnType<typeof useLiveObservations>;
  onNavigate: (view: View) => void;
  onAsk: (prompt: string) => void;
  onOpenGuidance: (id: string) => void;
};

export function OwnerHome({
  user,
  site,
  operations,
  live,
  onNavigate,
  onAsk,
  onOpenGuidance,
}: Props) {
  const reduced = useReducedMotion();
  const [workerCount, setWorkerCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refreshTeam() {
      if (pending || !active) return;
      pending = true;
      try {
        const team = await workspaceApi.team(site.id);
        if (active)
          setWorkerCount(team.members.filter((member) => member.role === 'worker').length);
      } catch {
        if (active) setWorkerCount(null);
      } finally {
        pending = false;
      }
    }
    void refreshTeam();
    const onFocus = () => {
      void refreshTeam();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshTeam();
    }, 30000);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [site.id]);
  const ongoing = operations.batches.filter((batch) => batch.status === 'ongoing');
  const replies = operations.guidance
    .flatMap((item) =>
      item.replies
        .filter((reply) => !reply.simulated)
        .map((reply) => ({ ...reply, title: item.title, guidanceId: item.id })),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const unanswered = replies.filter((reply) => reply.kind === 'question' && !reply.answer);
  const recentReplies = [
    ...unanswered,
    ...replies.filter((reply) => !unanswered.includes(reply)),
  ].slice(0, 3);
  const questions = unanswered.length;
  const disabled = !operations.ready || operations.loading || operations.saving;
  return (
    <motion.div
      className="owner-home"
      initial={{ opacity: 0, y: reduced ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="owner-heading">
        <div>
          <span className="eyebrow">{site.name} · 운영자</span>
          <h1>{user.name}님, 오늘의 덕장이에요.</h1>
          <p>
            {!operations.ready
              ? '덕장 기록을 확인하고 있어요.'
              : ongoing.length
                ? `진행 중인 건조 ${ongoing.length}건과 팀의 작업 상황을 확인하세요.`
                : '관측 정보를 살펴보고 오늘의 첫 작업을 시작해 보세요.'}
          </p>
        </div>
        <button className="button-primary" disabled={disabled} onClick={operations.openStart}>
          <Plus size={17} />
          건조 시작
        </button>
      </div>
      <ObservationSummary
        snapshot={live.snapshot}
        observation={live.selected}
        loading={live.loading}
        error={live.error}
        onRefresh={() => void live.refresh()}
        onAsk={onAsk}
      />
      {live.selected && (
        <p className="owner-distance">
          {live.selected.device.provider === 'kma-grid'
            ? `덕장이 속한 기상청 5km 격자 (중심까지 ${formatDistance(live.selected.distanceM)})`
            : `등록한 덕장에서 ${formatDistance(live.selected.distanceM)}`}{' '}
          · {live.preferredDeviceId ? '직접 선택한 관측소' : '가까운 관측소 자동 선택'}
        </p>
      )}
      {operations.loading ? (
        <div className="owner-loading" role="status">
          <span className="owner-skeleton" />
          <span className="owner-skeleton" />
          작업 기록을 불러오고 있어요.
        </div>
      ) : !operations.ready ? (
        <div className="owner-error">
          <span>작업 기록을 불러오면 이어서 시작할 수 있어요.</span>
          <button onClick={() => void operations.refresh()}>다시 불러오기</button>
        </div>
      ) : (
        <>
          {workerCount === 0 && (
            <button className="owner-invite" onClick={() => onNavigate('team')}>
              <span className="owner-icon">
                <Users size={22} />
              </span>
              <span>
                <strong>함께 일하는 근로자를 초대하세요</strong>
                <small>초대 링크로 참여하면 자기 언어로 작업 안내를 확인할 수 있어요.</small>
              </span>
              <ArrowRight size={18} />
            </button>
          )}
          <div className="owner-grid">
            <section className="owner-panel">
              <div className="owner-section-title">
                <h2>
                  진행 중인 건조 <span>{ongoing.length}</span>
                </h2>
                <button onClick={() => onNavigate('batches')}>
                  전체 기록
                  <ArrowRight size={14} />
                </button>
              </div>
              {ongoing.length ? (
                <div className="owner-batches">
                  {ongoing.slice(0, 3).map((batch) => (
                    <button
                      key={batch.id}
                      onClick={() => {
                        onNavigate('batches');
                        operations.openReport(batch.id);
                      }}
                    >
                      <span className="owner-icon">
                        <ClipboardList size={20} />
                      </span>
                      <span>
                        <strong>{batch.name}</strong>
                        <small>
                          {batch.fish} · {batch.quantity.toLocaleString()}마리 ·{' '}
                          {date(batch.startedAt)} {time(batch.startedAt)} 시작
                        </small>
                      </span>
                      <BatchBadge status={batch.status} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="owner-empty">
                  <ClipboardList size={27} />
                  <h3>아직 진행 중인 건조가 없어요</h3>
                  <p>
                    어종과 수량을 등록하면 시작부터 회수까지
                    <br />한 기록으로 관리할 수 있어요.
                  </p>
                  <button
                    className="button-outline"
                    disabled={disabled}
                    onClick={operations.openStart}
                  >
                    첫 건조 기록 만들기
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </section>
            <section className="owner-panel">
              <div className="owner-section-title">
                <h2>근로자 응답 {questions > 0 && <span>답변할 질문 {questions}건</span>}</h2>
                <button onClick={() => onNavigate('guidance')}>
                  안내 보기
                  <ArrowRight size={14} />
                </button>
              </div>
              {recentReplies.length ? (
                <div className="owner-replies">
                  {recentReplies.map((reply) => (
                    <button key={reply.id} onClick={() => onOpenGuidance(reply.guidanceId)}>
                      <div>
                        <strong>{reply.userName || '근로자'}</strong>
                        <span>
                          {reply.kind === 'question'
                            ? reply.answer
                              ? '답변 완료'
                              : '답변 대기'
                            : reply.kind === 'completed'
                              ? '작업 완료'
                              : '확인'}
                        </span>
                        <time>
                          {date(reply.at)} {time(reply.at)}
                        </time>
                      </div>
                      <p>{reply.kind === 'question' ? reply.text : reply.title}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="owner-empty">
                  <MessageSquare size={27} />
                  <h3>
                    {operations.guidance.length
                      ? '근로자의 응답을 기다리고 있어요'
                      : '안내를 보내고 함께 확인하세요'}
                  </h3>
                  <p>
                    확인·질문·완료 응답이 이곳에 모여요.
                    <br />
                    작업 완료 보고 후 건조 종료는 직접 승인해 주세요.
                  </p>
                  <button
                    className="button-outline"
                    disabled={disabled}
                    onClick={() => {
                      onNavigate('guidance');
                      operations.openGuidance();
                    }}
                  >
                    작업 안내 만들기
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </section>
          </div>
          <button
            className="owner-ask"
            onClick={() => onAsk('등록한 덕장 주변의 관측값과 작업 전 확인할 점을 알려줘')}
          >
            <Wind size={21} />
            <span>
              <strong>작업 전, 관측값이 궁금하다면</strong>
              <small>해풍에게 출처와 측정 시각을 함께 물어보세요.</small>
            </span>
            <ArrowRight size={18} />
          </button>
        </>
      )}
    </motion.div>
  );
}
