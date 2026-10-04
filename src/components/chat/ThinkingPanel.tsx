import { useEffect, useState } from 'react';
import { Check, LoaderCircle, Waves } from 'lucide-react';
import type { ProgressStep } from '../../lib/chat';

export function ThinkingPanel({ steps }: { steps: ProgressStep[] }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="thinking-panel" role="status" aria-live="polite">
      <div className="thinking-heading">
        <span className="thinking-orb">
          <Waves size={19} />
        </span>
        <div>
          <strong>덕장의 상황을 살펴보고 있어요</strong>
          <span>확인이 끝나면 정리된 답변을 보여드릴게요.</span>
        </div>
        <span className="elapsed" aria-hidden="true">
          {elapsed}초
        </span>
      </div>
      <div className="thinking-steps">
        {steps.map((step) => (
          <div className={`thinking-step ${step.status}`} key={step.id}>
            <span className="step-icon">
              {step.status === 'done' ? (
                <Check size={13} />
              ) : step.status === 'running' ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <span />
              )}
            </span>
            <span>{step.label}</span>
            {step.status === 'running' && <small>{step.detail}</small>}
          </div>
        ))}
      </div>
      <div className="thinking-track">
        <span />
      </div>
    </div>
  );
}
