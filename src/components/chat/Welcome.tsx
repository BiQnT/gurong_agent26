import { motion } from 'framer-motion';
import { ArrowRight, ArrowUp, ClipboardList, Globe2, Sparkles, Wind } from 'lucide-react';
import type { LiveObservation, LiveSnapshot } from '../../lib/live';
import { ObservationSummary } from './ObservationSummary';
import type { View } from '../../types/ui';
import { BrandMark } from '../BrandMark';

type WelcomeProps = {
  snapshot: LiveSnapshot | null;
  observation: LiveObservation | null;
  observationsLoading: boolean;
  observationsError: string | null;
  onRefresh: () => void;
  isLoading: boolean;
  reducedMotion: boolean | null;
  activeBatchName?: string;
  onAsk: (prompt: string) => void;
  onNavigate: (view: View) => void;
};

export function Welcome({
  snapshot,
  observation,
  observationsLoading,
  observationsError,
  onRefresh,
  isLoading,
  reducedMotion,
  activeBatchName,
  onAsk,
  onNavigate,
}: WelcomeProps) {
  return (
    <motion.div
      className="welcome"
      initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="welcome-brand">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <BrandMark large />
        <span className="welcome-spark">
          <Sparkles size={16} />
        </span>
      </div>
      <div className="welcome-overline">구룡포 덕장의 든든한 AI 파트너</div>
      <h1>
        오늘의 바람, <span>함께 살펴볼까요?</span>
      </h1>
      <p className="welcome-description">
        널어도 되는지 고민되는 순간부터 하루의 작업 기록까지.
        <br className="desktop-break" /> 해풍이 곁에서 도와드릴게요.
      </p>
      <ObservationSummary
        snapshot={snapshot}
        observation={observation}
        loading={observationsLoading}
        error={observationsError}
        onRefresh={onRefresh}
        onAsk={onAsk}
      />
      <div className="suggestions-heading">
        <span>어떤 일부터 시작할까요?</span>
        <span>해풍과 함께하는 하루</span>
      </div>
      <div className="starter-grid">
        <button
          className="starter-card"
          disabled={isLoading}
          onClick={() => onAsk('지금 과메기를 널어도 괜찮을까요?')}
        >
          <span className="starter-icon green">
            <Wind size={21} />
          </span>
          <strong>지금 널어도 될까요?</strong>
          <p>
            실제 관측값과 측정 시각,
            <br />
            확인할 사항을 살펴봐요.
          </p>
          <span className="starter-footer">
            관측 확인
            <ArrowUp className="diagonal-arrow" size={16} />
          </span>
        </button>
        <button className="starter-card" onClick={() => onNavigate('batches')}>
          <span className="starter-icon sand">
            <ClipboardList size={21} />
          </span>
          <strong>오늘의 건조 기록</strong>
          <p>
            널기부터 회수까지,
            <br />
            생산 과정을 한눈에 관리해요.
          </p>
          <span className="starter-footer">
            생산 기록
            <ArrowUp className="diagonal-arrow" size={16} />
          </span>
        </button>
        <button className="starter-card" onClick={() => onNavigate('guidance')}>
          <span className="starter-icon blue">
            <Globe2 size={21} />
          </span>
          <strong>말이 달라도, 정확하게</strong>
          <p>
            확인한 작업 내용을
            <br />
            근로자의 언어로 안내를 준비해요.
          </p>
          <span className="starter-footer">
            다국어 안내
            <ArrowUp className="diagonal-arrow" size={16} />
          </span>
        </button>
      </div>
      {activeBatchName && (
        <button className="active-batch-hint" onClick={() => onNavigate('batches')}>
          <span className="live-dot" />
          <span>진행 중인 건조 기록이 있어요</span>
          <strong>{activeBatchName}</strong>
          <ArrowRight size={14} />
        </button>
      )}
    </motion.div>
  );
}
