import { Component, type ReactNode } from 'react';
import type { ChatReply } from '../../lib/chat';
import { BatchCards, ForecastCard, HistoryCard } from './AnalysisCards';
import { ConditionsCard } from './ConditionsCard';

// 답 위에 붙는 카드 묶음. 서버는 AI 가 실제로 본 자료의 카드만 보낸다 (ADR 0011).
// 순서는 현재 환경 → 예보 → 기간 요약 → 배치 (QA: 외부 환경과 판단을 먼저, 줄글은 그 아래).

type ReplyCardsProps = {
  reply: ChatReply;
  onStart: () => void;
  onGuide: () => void;
};

/**
 * 카드 하나가 그리다 실패해도 답 문장과 앱은 남긴다. 답은 브라우저에 저장되므로, 여기서 막지 않으면
 * 새로고침할 때마다 같은 오류로 화면 전체가 비게 된다.
 */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="provider-notice">이 답의 자료 카드를 표시하지 못했어요.</p>
    ) : (
      this.props.children
    );
  }
}

export function ReplyCards(props: ReplyCardsProps) {
  return (
    <CardBoundary>
      <Cards {...props} />
    </CardBoundary>
  );
}

function Cards({ reply, onStart, onGuide }: ReplyCardsProps) {
  const hasConditions = Boolean(reply.assessment || reply.observation);
  if (!hasConditions && !reply.forecast && !reply.history?.length && !reply.batches?.length)
    return null;
  return (
    <div className="reply-cards">
      {hasConditions && (
        <ConditionsCard
          assessment={reply.assessment}
          observation={reply.observation}
          // 답 아래에 같은 일을 하는 버튼이 따로 있으면 카드 안 버튼은 숨긴다 (QA: 시작 버튼 두 개).
          hideStart={reply.action === 'start-batch'}
          hideGuide={reply.action === 'guidance'}
          onStart={onStart}
          onGuide={onGuide}
        />
      )}
      {reply.forecast && <ForecastCard forecast={reply.forecast} />}
      {reply.history?.map((history) => (
        <HistoryCard key={`${history.from}-${history.to}-${history.source}`} history={history} />
      ))}
      {reply.batches?.length ? <BatchCards batches={reply.batches} /> : null}
    </div>
  );
}
