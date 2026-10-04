import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, LoaderCircle, X } from 'lucide-react';
import { WorkspaceError, type MemberLanguage } from '../../lib/workspace';

const vietnameseErrors: Record<string, string> = {
  INVALID_CREDENTIALS: 'Kiểm tra họ tên, email và mật khẩu từ 8 đến 128 ký tự.',
  EMAIL_IN_USE: 'Email này đã được đăng ký. Hãy chọn Đăng nhập để tiếp tục.',
  LOGIN_FAILED: 'Email hoặc mật khẩu không chính xác. Hãy kiểm tra và thử lại.',
  AUTH_REQUIRED: 'Phiên đăng nhập đã hết hạn. Hãy tải lại trang và đăng nhập.',
  INVITATION_NOT_FOUND: 'Không tìm thấy lời mời. Hãy nhờ người quản lý gửi liên kết mới.',
  INVITATION_UNAVAILABLE:
    'Lời mời đã hết hạn, bị hủy hoặc đã được sử dụng. Hãy yêu cầu lời mời mới.',
  ALREADY_OWNER: 'Bạn đã là người quản lý của nơi này. Hãy gửi liên kết cho nhân viên.',
  SITE_ACCESS_DENIED: 'Bạn không có quyền thực hiện thao tác này tại nơi làm việc.',
};

export function errorMessage(error: unknown, language: MemberLanguage = 'ko') {
  if (language === 'vi') {
    if (error instanceof WorkspaceError) {
      if (vietnameseErrors[error.code]) return vietnameseErrors[error.code];
      if (error.status === 0) return 'Không thể kết nối máy chủ. Hãy thử lại sau.';
    }
    return 'Không thể hoàn tất yêu cầu. Hãy thử lại sau.';
  }
  return error instanceof Error ? error.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.';
}

export const languageName = (language: 'ko' | 'vi') =>
  language === 'vi' ? '베트남어 · Tiếng Việt' : '한국어';

export function shortDate(value: string, language: MemberLanguage = 'ko') {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? language === 'vi'
      ? 'Cần kiểm tra ngày'
      : '날짜 확인 필요'
    : new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'ko-KR', {
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Seoul',
      }).format(date);
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="ws-error" role="alert">
      <AlertCircle size={17} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function BusyIcon() {
  return <LoaderCircle className="ws-spinner" size={17} aria-hidden="true" />;
}

export function Dialog({
  title,
  description,
  onClose,
  children,
  wide = false,
  busy = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  busy?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const pending = useRef(busy);
  const titleId = useId();
  const descriptionId = useId();
  const reducedMotion = useReducedMotion();
  close.current = onClose;
  pending.current = busy;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => {
      (
        panel.current?.querySelector<HTMLElement>('input, select') ??
        focusable()[0] ??
        panel.current
      )?.focus();
    });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending.current) {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        panel.current?.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !panel.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return createPortal(
    <motion.div
      className="ws-dialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.16 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <motion.div
        className={`ws-dialog${wide ? ' ws-dialog--wide' : ''}`}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        initial={{ y: reducedMotion ? 0 : 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: reducedMotion ? 0 : 8, opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.2 }}
      >
        <div className="ws-dialog-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button
            type="button"
            className="ws-icon-button"
            onClick={onClose}
            disabled={busy}
            aria-label="창 닫기"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
