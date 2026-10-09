import { useId, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Eye, EyeOff, Globe2, LockKeyhole, MapPin, Wind } from 'lucide-react';
import {
  isStrongPassword,
  PASSWORD_RULE,
  workspaceApi,
  WorkspaceError,
  type InvitePreview,
  type WorkspaceSession,
} from '../../lib/workspace';
import { BrandMark } from '../BrandMark';
import { BusyIcon, errorMessage, FormError } from './shared';

export function AuthScreen({
  onAuthenticated,
  invite,
}: {
  onAuthenticated: (session: WorkspaceSession) => void;
  invite?: InvitePreview | null;
}) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const id = useId();
  const reducedMotion = useReducedMotion();
  const vietnamese = invite?.language === 'vi';
  const t = (korean: string, vietnameseText: string) => (vietnamese ? vietnameseText : korean);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    // 서버도 같은 규칙으로 거절하지만, 보내기 전에 무엇을 고칠지 바로 알려 준다.
    if (mode === 'signup' && !isStrongPassword(password)) {
      setError(
        errorMessage(new WorkspaceError(PASSWORD_RULE, 400, 'WEAK_PASSWORD'), invite?.language),
      );
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const credentials = { email: email.trim(), password };
      const session =
        mode === 'signup'
          ? await workspaceApi.signup({ ...credentials, name: name.trim() })
          : await workspaceApi.login(credentials);
      onAuthenticated(session);
    } catch (failure) {
      setError(errorMessage(failure, invite?.language));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="ws-auth">
      <aside className="ws-auth-story" aria-label="해풍 소개">
        <div className="ws-wordmark">
          <BrandMark />
          <span>
            해풍<small>HAEPUNG</small>
          </span>
        </div>
        <motion.div
          className="ws-auth-story-content"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.55 }}
        >
          <span className="ws-eyebrow">바람을 읽고, 하루를 잇다</span>
          <h1>
            덕장의 하루에
            <br />
            든든한 동료 하나.
          </h1>
          <p>
            오늘의 바람부터 함께 일하는 사람들까지.
            <br />
            우리 덕장의 일을, 해풍과 함께해요.
          </p>
          <div className="ws-auth-art" aria-hidden="true">
            <span className="ws-art-orbit ws-art-orbit--one" />
            <span className="ws-art-orbit ws-art-orbit--two" />
            <span className="ws-art-orbit ws-art-orbit--three" />
            <div className="ws-art-center">
              <BrandMark large />
            </div>
            <div className="ws-art-label ws-art-label--wind">
              <Wind size={17} />
              <span>현장의 바람을 읽고</span>
            </div>
            <div className="ws-art-label ws-art-label--team">
              <Globe2 size={17} />
              <span>서로의 언어로 함께해요</span>
            </div>
            <span className="ws-art-dot" />
          </div>
        </motion.div>
        <p className="ws-auth-story-foot">
          <MapPin size={13} /> 구룡포 덕장을 위한 AI 파트너
        </p>
      </aside>
      <section className="ws-auth-panel" lang={vietnamese ? 'vi' : 'ko'}>
        <div className="ws-auth-topline">
          <div className="ws-wordmark ws-wordmark--mobile">
            <BrandMark />
            <span>해풍</span>
          </div>
          <span>
            {mode === 'signup'
              ? t('이미 계정이 있나요?', 'Đã có tài khoản?')
              : t('해풍이 처음인가요?', 'Chưa có tài khoản?')}
          </span>
          <button
            type="button"
            className="ws-text-button"
            disabled={busy}
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup');
              setError(null);
            }}
          >
            {mode === 'signup' ? t('로그인', 'Đăng nhập') : t('회원가입', 'Đăng ký')}
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="ws-auth-form-wrap">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
              transition={{ duration: reducedMotion ? 0 : 0.16 }}
            >
              <div className="ws-auth-heading">
                <span className="ws-eyebrow">
                  {mode === 'signup'
                    ? t('작은 시작, 편안한 하루', 'Cùng nhau bắt đầu · 함께 시작해요')
                    : t('다시 만나 반가워요', 'Chào mừng bạn trở lại')}
                </span>
                <h2>
                  {mode === 'signup'
                    ? t('해풍과 시작해요', 'Tạo tài khoản Haepung')
                    : t('우리 덕장으로 돌아가요', 'Đăng nhập Haepung')}
                </h2>
                <p>
                  {invite
                    ? t(
                        `${invite.siteName}의 초대를 받으셨어요. 계정으로 계속해 주세요.`,
                        `Bạn được mời tham gia ${invite.siteName}. Hãy tạo tài khoản hoặc đăng nhập để tiếp tục.`,
                      )
                    : mode === 'signup'
                      ? '나만의 계정을 만들고, 우리 덕장을 연결하세요.'
                      : '이메일과 비밀번호를 입력해 주세요.'}
                </p>
              </div>
              {invite && (
                <div className="ws-invite-banner">
                  <Globe2 size={17} />
                  <span>
                    <strong>{invite.ownerName}</strong>
                    {t('님이 함께 일할 동료로 초대했어요.', ' đã mời bạn cùng làm việc.')}
                  </span>
                </div>
              )}
              <form className="ws-form" onSubmit={submit} aria-busy={busy}>
                {mode === 'signup' && (
                  <label className="ws-field" htmlFor={`${id}-name`}>
                    <span>{t('이름', 'Họ tên · 이름')}</span>
                    <input
                      id={`${id}-name`}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t(
                        '함께 일할 때 부르는 이름',
                        'Tên bạn sử dụng tại nơi làm việc',
                      )}
                      autoComplete="name"
                      required
                      maxLength={60}
                      disabled={busy}
                    />
                  </label>
                )}
                <label className="ws-field" htmlFor={`${id}-email`}>
                  <span>{t('이메일', 'Email · 이메일')}</span>
                  <input
                    id={`${id}-email`}
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@example.com"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={254}
                    disabled={busy}
                  />
                </label>
                <label className="ws-field" htmlFor={`${id}-password`}>
                  <span>{t('비밀번호', 'Mật khẩu · 비밀번호')}</span>
                  <div className="ws-password-input">
                    <input
                      id={`${id}-password`}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={
                        mode === 'signup'
                          ? t('8자 이상, 문자와 숫자 포함', 'Ít nhất 8 ký tự, có chữ và số')
                          : t('비밀번호를 입력해 주세요', 'Nhập mật khẩu')
                      }
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      minLength={mode === 'signup' ? 8 : undefined}
                      maxLength={128}
                      required
                      disabled={busy}
                      aria-describedby={mode === 'signup' ? `${id}-password-help` : undefined}
                    />
                    <button
                      type="button"
                      className="ws-icon-button"
                      aria-label={
                        showPassword
                          ? t('비밀번호 숨기기', 'Ẩn mật khẩu')
                          : t('비밀번호 보기', 'Hiện mật khẩu')
                      }
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {mode === 'signup' && (
                    <small id={`${id}-password-help`}>
                      {t(
                        '8~128자, 문자와 숫자를 함께 넣어 주세요. 다른 서비스에서 쓰지 않는 비밀번호가 안전해요.',
                        'Từ 8 đến 128 ký tự, gồm cả chữ cái và chữ số. Hãy dùng mật khẩu riêng cho tài khoản này.',
                      )}
                    </small>
                  )}
                </label>
                <FormError>{error}</FormError>
                <button
                  className="ws-button ws-button--primary ws-button--full"
                  type="submit"
                  disabled={busy || (mode === 'signup' && !name.trim())}
                >
                  {busy ? (
                    <>
                      <BusyIcon />
                      {mode === 'signup'
                        ? t('계정을 만들고 있어요', 'Đang tạo tài khoản…')
                        : t('로그인하고 있어요', 'Đang đăng nhập…')}
                    </>
                  ) : (
                    <>
                      {mode === 'signup'
                        ? t('계정 만들기', 'Tạo tài khoản')
                        : t('로그인', 'Đăng nhập')}
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </form>
              {mode === 'signup' && (
                <div className="ws-auth-next">
                  <Check size={15} />
                  <span>
                    {invite
                      ? t(
                          '가입 후 초대를 수락하면 바로 함께할 수 있어요.',
                          'Sau khi đăng ký, hãy chấp nhận lời mời để tham gia.',
                        )
                      : '가입 후 덕장을 등록해요. 동료 초대는 언제든 가능해요.'}
                  </span>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <p className="ws-auth-foot">
          <LockKeyhole size={13} />
          {t(
            '로컬 테스트 계정 · 이메일 인증 없이 시작해요',
            'Tài khoản thử nghiệm · Không cần xác minh email',
          )}
        </p>
      </section>
    </main>
  );
}
