import { useEffect, type FormEvent, type RefObject } from 'react';
import { ArrowUp, MapPin, ShieldCheck, Square, Waves, X } from 'lucide-react';

type ComposerProps = {
  draft: string;
  isLoading: boolean;
  stationName: string;
  inputRef: RefObject<HTMLTextAreaElement>;
  onDraftChange: (draft: string) => void;
  onSend: (prompt: string) => void;
  onCancel: () => void;
};

export function Composer({
  draft,
  isLoading,
  stationName,
  inputRef,
  onDraftChange,
  onSend,
  onCancel,
}: ComposerProps) {
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    }
  }, [draft, inputRef]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSend(draft);
  }

  return (
    <div className="composer-area">
      <form className="composer" onSubmit={submit}>
        <textarea
          ref={inputRef}
          aria-label="해풍에게 질문하기"
          placeholder="덕장에 궁금한 일, 편하게 물어보세요."
          value={draft}
          maxLength={4000}
          rows={1}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              if (isLoading) {
                event.preventDefault();
                onCancel();
              }
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend(draft);
            }
          }}
        />
        <div className="composer-bottom">
          <div className="composer-context">
            <span className="composer-context-icon">
              <Waves size={14} />
            </span>
            <span>해풍 AI</span>
            <span className="composer-divider" />
            <MapPin size={13} />
            <span>{stationName}</span>
          </div>
          <div className="composer-send">
            {draft.trim() && !isLoading && (
              <button
                type="button"
                className="composer-clear"
                aria-label="입력 내용 지우기"
                onClick={() => onDraftChange('')}
              >
                <X size={14} />
              </button>
            )}
            {draft.length > 3000 && (
              <span className="char-count">{draft.length.toLocaleString()} / 4,000</span>
            )}
            <span className="enter-hint">
              {isLoading
                ? 'Esc로 중단 · Shift+Enter로 줄바꿈'
                : 'Enter로 전송 · Shift+Enter로 줄바꿈'}
            </span>
            {isLoading ? (
              <button
                type="button"
                className="send-button stop"
                aria-label="응답 생성 중단"
                onClick={onCancel}
              >
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                aria-label="메시지 전송"
                disabled={!draft.trim()}
              >
                <ArrowUp size={20} />
              </button>
            )}
          </div>
        </div>
      </form>
      <p className="composer-disclaimer">
        <ShieldCheck size={12} />
        관측 시각과 현장 상태를 확인하세요. AI의 안내는 작업 판단을 돕는 참고 정보입니다.
      </p>
    </div>
  );
}
