import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Link2,
  Loader2,
  LogOut,
  MapPin,
  RefreshCw,
  Users,
  Waves,
  X,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import { AuthScreen, InviteAcceptance, SiteSetup } from './workspace';
import { useWorkspace } from '../hooks/useWorkspace';
import { workspaceApi, type Account, type InvitePreview, type Site } from '../lib/workspace';
import './workspace-gate.css';

export type WorkspaceContext = {
  user: Account;
  site: Site;
  sites: Site[];
  onSelectSite: (id: string) => void;
  onAddSite: () => void;
  onSiteUpdated: (site: Site) => void;
  onLogout: () => void;
};

function tokenFromLocation() {
  return new URLSearchParams(window.location.search).get('invite') || '';
}

export function WorkspaceGate({
  children,
}: {
  children: (context: WorkspaceContext) => ReactNode;
}) {
  const workspace = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [entryMode, setEntryMode] = useState<'owner' | 'worker' | null>(null);
  const [token, setToken] = useState(tokenFromLocation);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(token));
  const [inviteError, setInviteError] = useState('');
  const [notice, setNotice] = useState('');
  const [joinLink, setJoinLink] = useState('');
  const [joinError, setJoinError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const inviteEpoch = useRef(0);
  const logoutPending = useRef(false);
  const authenticatedUserId = workspace.user?.id ?? null;
  const currentUserId = useRef(authenticatedUserId);
  currentUserId.current = authenticatedUserId;
  const reducedMotion = useReducedMotion();

  const readInvite = useCallback(async () => {
    const epoch = ++inviteEpoch.current;
    if (!token) {
      setPreview(null);
      setInviteError('');
      setInviteLoading(false);
      return;
    }
    setInviteLoading(true);
    setInviteError('');
    try {
      const next = await workspaceApi.invitation(token);
      if (epoch === inviteEpoch.current) setPreview(next);
    } catch (cause) {
      if (epoch !== inviteEpoch.current) return;
      setPreview(null);
      setInviteError(cause instanceof Error ? cause.message : '초대를 확인할 수 없어요.');
    } finally {
      if (epoch === inviteEpoch.current) setInviteLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void readInvite();
    return () => {
      inviteEpoch.current += 1;
    };
  }, [readInvite]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setCreating(false);
    setEntryMode(null);
    setJoinLink('');
    setJoinError('');
    setNotice('');
  }, [authenticatedUserId]);

  function changeToken(next: string) {
    inviteEpoch.current += 1;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('invite', next);
    else url.searchParams.delete('invite');
    history.replaceState(null, '', url);
    setToken(next);
    setInviteLoading(Boolean(next));
    setPreview(null);
    setInviteError('');
  }

  async function logout() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setLoggingOut(true);
    try {
      await workspace.logout();
      setCreating(false);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : '로그아웃하지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      logoutPending.current = false;
      setLoggingOut(false);
    }
  }

  function saveSite(site: Site) {
    if (!authenticatedUserId || currentUserId.current !== authenticatedUserId) return false;
    const applied = workspace.applySite(site);
    if (!applied) return false;
    setCreating(false);
    return true;
  }

  function openJoin() {
    const input = joinLink.trim();
    let next = input;
    try {
      next = new URL(input).searchParams.get('invite') || '';
    } catch {
      // A single-use token can also be pasted without the rest of its link.
    }
    if (!/^[a-zA-Z0-9_-]{43}$/.test(next)) {
      setJoinError('받은 초대 링크를 확인해 주세요. / Hãy kiểm tra liên kết lời mời.');
      return;
    }
    setJoinError('');
    changeToken(next);
    setJoinLink('');
  }

  const accountBar = workspace.user && (
    <div className="gate-account-bar">
      <span>
        <Waves size={16} />
        {workspace.user.name}
        <small>{workspace.user.email}</small>
      </span>
      <button onClick={() => void logout()} disabled={loggingOut}>
        {loggingOut ? <Loader2 className="spin" size={15} /> : <LogOut size={15} />}
        {token
          ? preview?.language === 'vi'
            ? 'Đổi tài khoản · 다른 계정'
            : '다른 계정으로 참여'
          : '로그아웃'}
      </button>
    </div>
  );
  const loadingScreen = (
    <div className="gate-screen">
      <BrandMark large />
      <Loader2 className="spin" size={24} />
      <p>내 덕장을 준비하고 있어요.</p>
    </div>
  );

  let content: ReactNode;
  if (workspace.loading || (token && inviteLoading)) {
    content = loadingScreen;
  } else if (workspace.error && !workspace.user) {
    content = (
      <div className="gate-screen">
        <BrandMark large />
        <h1>연결을 확인해 주세요</h1>
        <p role="alert">{workspace.error}</p>
        <button className="ws-button ws-button--primary" onClick={() => void workspace.refresh()}>
          <RefreshCw size={16} />
          다시 연결
        </button>
      </div>
    );
  } else if (token && inviteError) {
    content = (
      <div className="gate-screen">
        <BrandMark large />
        <h1>초대 링크를 확인해 주세요</h1>
        <p role="alert">{inviteError}</p>
        <p className="gate-vietnamese" lang="vi">
          Không thể mở lời mời. Hãy thử lại hoặc nhờ người quản lý gửi liên kết mới.
        </p>
        <div className="gate-actions">
          <button className="ws-button ws-button--primary" onClick={() => changeToken('')}>
            내 화면으로 이동
            <ArrowRight size={16} />
          </button>
          <button className="ws-button ws-button--secondary" onClick={() => void readInvite()}>
            <RefreshCw size={15} />
            다시 확인
          </button>
        </div>
      </div>
    );
  } else if (token && preview && preview.status !== 'pending') {
    content = (
      <>
        {accountBar}
        <InviteAcceptance
          token={token}
          preview={preview}
          onAccepted={() => undefined}
          onDismiss={() => changeToken('')}
        />
      </>
    );
  } else if (!workspace.user) {
    content = <AuthScreen onAuthenticated={workspace.applySession} invite={preview} />;
  } else if (token && preview) {
    content = (
      <>
        {accountBar}
        <InviteAcceptance
          token={token}
          preview={preview}
          onAccepted={(site) => {
            if (!saveSite(site)) return;
            changeToken('');
            setNotice(`${site.name}에 참여했어요.`);
          }}
          onDismiss={() => changeToken('')}
        />
      </>
    );
  } else if (creating || (!workspace.site && entryMode === 'owner')) {
    content = (
      <>
        {accountBar}
        <SiteSetup
          onSaved={saveSite}
          userName={workspace.user.name}
          onCancel={() => {
            setCreating(false);
            setEntryMode(null);
          }}
        />
      </>
    );
  } else if (!workspace.site) {
    content = (
      <>
        {accountBar}
        <main className="gate-onboarding">
          <motion.section
            className="gate-entry"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.3 }}
          >
            <BrandMark large />
            <span className="ws-eyebrow">
              {entryMode === 'worker'
                ? '함께할 동료가 기다리고 있어요'
                : `${workspace.user.name}님, 해풍에 오신 걸 환영해요`}
            </span>
            <h1>{entryMode === 'worker' ? '받은 초대 링크로 참여해요' : '어떻게 함께하실까요?'}</h1>
            <p>
              {entryMode === 'worker'
                ? '운영자가 보내준 링크를 붙여 넣어 주세요.'
                : '덕장을 등록하거나, 초대받은 덕장에 참여할 수 있어요.'}
            </p>
            {entryMode === 'worker' ? (
              <div className="gate-worker-entry">
                <p className="gate-vietnamese" lang="vi">
                  Dán liên kết lời mời từ người quản lý để tham gia nơi làm việc.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    openJoin();
                  }}
                >
                  <label className="ws-field" htmlFor="join-link">
                    <span>초대 링크 · Liên kết lời mời</span>
                    <input
                      id="join-link"
                      type="text"
                      value={joinLink}
                      onChange={(event) => {
                        setJoinLink(event.target.value);
                        setJoinError('');
                      }}
                      placeholder="초대 링크 붙여넣기 · Dán liên kết"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      autoFocus
                    />
                  </label>
                  {joinError && (
                    <p className="ws-field-error" role="alert">
                      {joinError}
                    </p>
                  )}
                  <button
                    className="ws-button ws-button--primary ws-button--full"
                    type="submit"
                    disabled={!joinLink.trim()}
                  >
                    초대 확인 · Xem lời mời
                    <ArrowRight size={16} />
                  </button>
                </form>
                <p className="gate-entry-hint">
                  아직 링크가 없다면 운영자에게 초대를 요청해 주세요.
                  <br />
                  <span lang="vi">Chưa có liên kết? Hãy nhờ người quản lý gửi lời mời.</span>
                </p>
                <button
                  className="ws-text-button"
                  onClick={() => {
                    setEntryMode(null);
                    setJoinError('');
                  }}
                >
                  <ArrowLeft size={14} />
                  다른 방법으로 시작
                </button>
              </div>
            ) : (
              <div className="gate-role-options">
                <button className="gate-role-card" onClick={() => setEntryMode('owner')}>
                  <span className="gate-role-icon">
                    <MapPin size={22} />
                  </span>
                  <span>
                    <strong>덕장을 운영해요</strong>
                    <small>우리 덕장을 등록하고 작업과 동료를 관리해요.</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
                <button className="gate-role-card" onClick={() => setEntryMode('worker')}>
                  <span className="gate-role-icon">
                    <Users size={22} />
                  </span>
                  <span>
                    <strong>초대받은 근로자예요</strong>
                    <small>받은 링크로 참여하고 작업 안내를 확인해요.</small>
                    <span lang="vi">Tôi là nhân viên được mời</span>
                  </span>
                  <ArrowRight size={17} />
                </button>
                <div className="gate-entry-foot">
                  <Link2 size={13} />
                  이미 받은 초대 링크를 바로 열어도 참여할 수 있어요.
                </div>
              </div>
            )}
          </motion.section>
        </main>
      </>
    );
  } else {
    content = children({
      user: workspace.user,
      site: workspace.site,
      sites: workspace.sites,
      onSelectSite: workspace.selectSite,
      onAddSite: () => setCreating(true),
      onSiteUpdated: saveSite,
      onLogout: () => void logout(),
    });
  }
  return (
    <>
      {content}
      {notice && (
        <div className="gate-toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button aria-label="알림 닫기" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
