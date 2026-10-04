import { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Clock3, Globe2, Link2, ShieldCheck, Users } from 'lucide-react';
import { workspaceApi, WorkspaceError, type InvitePreview, type Site } from '../../lib/workspace';
import { BrandMark } from '../BrandMark';
import { BusyIcon, errorMessage, FormError, languageName, shortDate } from './shared';

export function InviteAcceptance({
  token,
  preview,
  onAccepted,
  onDismiss,
}: {
  token: string;
  preview: InvitePreview;
  onAccepted: (site: Site) => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const pending = useRef(false);
  const reducedMotion = useReducedMotion();
  const vietnamese = preview.language === 'vi';
  const status =
    preview.status === 'pending' && Date.parse(preview.expiresAt) <= Date.now()
      ? 'expired'
      : preview.status;
  const valid = status === 'pending' && !unavailable;

  async function accept() {
    if (pending.current || !valid) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      onAccepted(await workspaceApi.acceptInvite(token));
    } catch (failure) {
      setError(errorMessage(failure, preview.language));
      if (
        failure instanceof WorkspaceError &&
        ['INVITATION_UNAVAILABLE', 'INVITATION_NOT_FOUND', 'ALREADY_OWNER'].includes(failure.code)
      )
        setUnavailable(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="ws-accept-page" lang={vietnamese ? 'vi' : 'ko'}>
      <div className="ws-wordmark">
        <BrandMark />
        <span>
          해풍<small>HAEPUNG</small>
        </span>
      </div>
      <motion.section
        className="ws-accept-card"
        initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.3 }}
      >
        <span className="ws-accept-icon">{valid ? <Users size={29} /> : <Link2 size={29} />}</span>
        <span className="ws-eyebrow">
          {vietnamese ? 'Cùng nhau làm việc · 함께 일해요' : '함께 일할 동료가 기다려요'}
        </span>
        <h1>
          {valid
            ? vietnamese
              ? 'Bạn được mời tham gia'
              : '우리 덕장에서 함께해요'
            : vietnamese
              ? 'Liên kết này không còn hiệu lực'
              : '이 초대는 사용할 수 없어요'}
        </h1>
        <p className="ws-accept-description">
          {valid ? (
            <>
              <strong>{preview.ownerName}</strong>
              {vietnamese
                ? ' đã mời bạn tham gia nơi làm việc.'
                : '님이 함께 일할 동료로 초대했어요.'}
            </>
          ) : status === 'accepted' ? (
            vietnamese ? (
              'Lời mời này đã được sử dụng. Nếu đã tham gia, hãy về trang chính.'
            ) : (
              '이미 사용한 초대 링크예요. 참여한 덕장은 홈에서 확인해 주세요.'
            )
          ) : vietnamese ? (
            'Hãy nhờ người quản lý gửi cho bạn một lời mời mới.'
          ) : (
            '운영자에게 새 초대 링크를 요청해 주세요.'
          )}
        </p>
        <div className="ws-accept-site">
          <span>
            <MapSiteIcon />
          </span>
          <div>
            <strong>{preview.siteName}</strong>
            <small>
              <Globe2 size={13} />
              {languageName(preview.language)}
            </small>
          </div>
          {valid && <Check size={19} />}
        </div>
        {valid && (
          <>
            <div className="ws-accept-detail">
              <ShieldCheck size={16} />
              <span>
                {vietnamese
                  ? 'Vai trò: Nhân viên · 근로자로 참여해요'
                  : '근로자로 참여해 작업 안내를 확인할 수 있어요.'}
              </span>
            </div>
            <div className="ws-accept-detail">
              <Clock3 size={16} />
              <span>
                {vietnamese ? 'Hết hạn' : '초대 유효 기간'}:{' '}
                {shortDate(preview.expiresAt, preview.language)}
              </span>
            </div>
          </>
        )}
        <FormError>{error}</FormError>
        <div className="ws-accept-actions">
          {valid && (
            <button
              className="ws-button ws-button--primary ws-button--full"
              onClick={() => void accept()}
              disabled={busy}
            >
              {busy ? (
                <>
                  <BusyIcon />
                  {vietnamese ? 'Đang tham gia…' : '참여하는 중'}
                </>
              ) : (
                <>
                  {vietnamese ? 'Chấp nhận lời mời · 초대 수락' : '초대 수락하고 시작'}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          )}
          <button className="ws-text-button" onClick={onDismiss} disabled={busy}>
            {vietnamese
              ? valid
                ? 'Để sau · 나중에 할게요'
                : 'Về trang chính · 홈으로 이동'
              : valid
                ? '나중에 할게요'
                : '홈으로 이동'}
          </button>
        </div>
      </motion.section>
      <p className="ws-accept-foot">
        {vietnamese
          ? 'Hướng dẫn công việc sẽ được hiển thị bằng tiếng Việt.'
          : '같은 현장에서, 서로의 언어로 함께해요.'}
      </p>
    </main>
  );
}

function MapSiteIcon() {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 10 9-6 9 6M5 9v11h14V9M9 20v-7h6v7M3 20h18" />
    </svg>
  );
}
