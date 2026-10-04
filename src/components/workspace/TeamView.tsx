import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  Copy,
  Globe2,
  Link2,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import {
  workspaceApi,
  type Invitation,
  type MemberLanguage,
  type Site,
  type Team,
  type TeamMember,
} from '../../lib/workspace';
import { SiteSetup } from './SiteSetup';
import { BusyIcon, Dialog, errorMessage, FormError, languageName, shortDate } from './shared';

type Removal = { type: 'member'; member: TeamMember } | { type: 'invite'; invitation: Invitation };
const invitationLabels: Record<Invitation['status'], string> = {
  pending: '초대 대기',
  accepted: '참여 완료',
  expired: '기간 만료',
  revoked: '초대 취소',
};

function invitationStatus(invitation: Invitation): Invitation['status'] {
  return invitation.status === 'pending' && Date.parse(invitation.expiresAt) <= Date.now()
    ? 'expired'
    : invitation.status;
}

export function TeamView({
  site,
  onSiteUpdated,
}: {
  site: Site;
  onSiteUpdated: (site: Site) => void;
}) {
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [language, setLanguage] = useState<MemberLanguage>('vi');
  const [createdInvite, setCreatedInvite] = useState<{
    url: string;
    invitation: Invitation;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(false);
  const fetchVersion = useRef(0);
  const linkInput = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const isOwner = site.role === 'owner';

  const refresh = useCallback(async () => {
    const version = ++fetchVersion.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await workspaceApi.team(site.id);
      if (version === fetchVersion.current) setTeam(result);
    } catch (failure) {
      if (version === fetchVersion.current) setLoadError(errorMessage(failure));
    } finally {
      if (version === fetchVersion.current) setLoading(false);
    }
  }, [site.id]);

  useEffect(() => {
    setTeam(null);
    setCreatedInvite(null);
    setInviteOpen(false);
    setEditOpen(false);
    setRemoval(null);
    void refresh();
    return () => {
      fetchVersion.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function openInvite() {
    setCreatedInvite(null);
    setCopied(false);
    setCopyError(false);
    setActionError(null);
    setInviteOpen(true);
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const result = await workspaceApi.invite(site.id, language);
      const url = new URL('/', window.location.origin);
      url.searchParams.set('invite', result.token);
      setCreatedInvite({ url: url.toString(), invitation: result.invitation });
      setTeam((current) =>
        current
          ? { ...current, invitations: [result.invitation, ...current.invitations] }
          : current,
      );
      void refresh();
    } catch (failure) {
      setActionError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!createdInvite) return;
    try {
      await navigator.clipboard.writeText(createdInvite.url);
      setCopied(true);
      setCopyError(false);
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setCopyError(true);
    }
  }

  async function confirmRemoval() {
    if (!removal || pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError(null);
    try {
      if (removal.type === 'member') {
        await workspaceApi.removeMember(site.id, removal.member.id);
        setTeam((current) =>
          current
            ? {
                ...current,
                members: current.members.filter((member) => member.id !== removal.member.id),
              }
            : current,
        );
        setNotice(`${removal.member.name}님의 덕장 참여를 해제했어요.`);
      } else {
        await workspaceApi.revokeInvite(site.id, removal.invitation.id);
        setTeam((current) =>
          current
            ? {
                ...current,
                invitations: current.invitations.map((item) =>
                  item.id === removal.invitation.id
                    ? { ...item, status: 'revoked' as const }
                    : item,
                ),
              }
            : current,
        );
        setNotice('초대 링크를 취소했어요.');
      }
      setRemoval(null);
      void refresh();
    } catch (failure) {
      setActionError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const workers = team?.members.filter((member) => member.role === 'worker') ?? [];
  const pendingInvites =
    team?.invitations.filter((item) => invitationStatus(item) === 'pending') ?? [];

  return (
    <motion.section
      className="ws-team"
      initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.3 }}
    >
      <header className="ws-page-heading">
        <div>
          <span className="ws-eyebrow">같은 현장, 하나의 팀</span>
          <h1>우리 덕장과 동료</h1>
          <p>함께 일하는 사람과 덕장 정보를 한곳에서 관리해요.</p>
        </div>
        {isOwner && (
          <button className="ws-button ws-button--primary" onClick={openInvite}>
            <Plus size={17} />
            동료 초대
          </button>
        )}
      </header>
      <div className="ws-site-summary">
        <span className="ws-site-icon">
          <MapPin size={23} />
        </span>
        <div className="ws-site-summary-main">
          <span>연결된 덕장</span>
          <h2>{site.name}</h2>
          <p>{site.address}</p>
          <small>
            {site.latitude.toFixed(6)}, {site.longitude.toFixed(6)}
          </small>
        </div>
        {isOwner && (
          <button
            className="ws-button ws-button--secondary ws-button--small"
            onClick={() => setEditOpen(true)}
          >
            <Pencil size={14} />
            정보 수정
          </button>
        )}
      </div>
      <div className="ws-team-heading">
        <div>
          <h2>
            함께하는 동료 <span>{team?.members.length ?? '—'}</span>
          </h2>
          <p>운영자는 덕장을 관리하고, 근로자는 작업 안내를 확인해요.</p>
        </div>
        <button
          className="ws-icon-button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="동료 목록 새로고침"
        >
          <RefreshCw size={16} className={loading ? 'ws-spinner' : ''} />
        </button>
      </div>
      {loadError && (
        <div className="ws-load-error">
          <FormError>{loadError}</FormError>
          <button className="ws-text-button" onClick={() => void refresh()}>
            다시 불러오기
            <RefreshCw size={14} />
          </button>
        </div>
      )}
      {loading && !team && (
        <div className="ws-team-loading" role="status">
          <BusyIcon />
          동료 정보를 불러오고 있어요.
        </div>
      )}
      {team && (
        <>
          <ul className="ws-member-list" aria-label="덕장 구성원">
            {team.members.map((member) => (
              <li className="ws-member" key={member.id}>
                <span className={`ws-avatar${member.role === 'owner' ? ' ws-avatar--owner' : ''}`}>
                  {member.name.slice(0, 1)}
                </span>
                <div className="ws-member-name">
                  <strong>
                    {member.name}
                    <span className="ws-role">{member.role === 'owner' ? '운영자' : '근로자'}</span>
                  </strong>
                  <span>
                    <Mail size={12} />
                    {member.email}
                  </span>
                </div>
                <span className="ws-member-language">
                  <Globe2 size={14} />
                  {languageName(member.language)}
                </span>
                {member.role === 'owner' ? (
                  <span className="ws-owner-mark" title="덕장 운영자">
                    <ShieldCheck size={18} />
                  </span>
                ) : (
                  isOwner && (
                    <button
                      className="ws-icon-button"
                      aria-label={`${member.name}님 참여 해제`}
                      onClick={() => {
                        setActionError(null);
                        setRemoval({ type: 'member', member });
                      }}
                    >
                      <UserMinus size={17} />
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
          {!workers.length && isOwner && (
            <div className="ws-team-empty">
              <div className="ws-empty-people" aria-hidden="true">
                <span>
                  <Users size={27} />
                </span>
                <span className="ws-empty-plus">
                  <Plus size={13} />
                </span>
              </div>
              <h3>함께하면, 일이 더 잘 통해요.</h3>
              <p>
                초대 링크를 카카오톡이나 문자로 공유해 보세요.
                <br />
                동료가 휴대폰에서 가입하고 수락하면 이곳에 함께 표시돼요.
              </p>
              <button className="ws-button ws-button--secondary" onClick={openInvite}>
                첫 동료 초대하기
                <ArrowRight size={15} />
              </button>
              <small>지금은 혼자 시작하고, 나중에 초대해도 괜찮아요.</small>
            </div>
          )}
          <div className="ws-team-heading ws-team-heading--invites">
            <div>
              <h2>
                초대 내역 {pendingInvites.length > 0 && <span>{pendingInvites.length} 대기</span>}
              </h2>
              <p>한 링크로 한 명을 초대해요. 함께할 동료에게 직접 전달해 주세요.</p>
            </div>
            <Link2 size={18} />
          </div>
          {team.invitations.length ? (
            <ul className="ws-invitation-list" aria-label="동료 초대 내역">
              {team.invitations.map((invitation) => {
                const status = invitationStatus(invitation);
                return (
                  <li className="ws-invitation" key={invitation.id}>
                    <span className="ws-invitation-icon">
                      <Link2 size={17} />
                    </span>
                    <div>
                      <strong>{languageName(invitation.language)} 안내</strong>
                      <span>
                        {shortDate(invitation.createdAt)}에 생성 · {shortDate(invitation.expiresAt)}
                        까지
                      </span>
                    </div>
                    <span className={`ws-invite-status ws-invite-status--${status}`}>
                      {status === 'accepted' && <Check size={12} />}
                      {invitationLabels[status]}
                    </span>
                    {isOwner && status === 'pending' && (
                      <button
                        className="ws-icon-button"
                        aria-label={`${shortDate(invitation.createdAt)}에 만든 ${languageName(invitation.language)} 초대 취소`}
                        onClick={() => {
                          setActionError(null);
                          setRemoval({ type: 'invite', invitation });
                        }}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="ws-invitations-empty">
              <MoreHorizontal size={22} />
              <span>아직 만든 초대 링크가 없어요.</span>
            </div>
          )}
        </>
      )}
      <AnimatePresence>
        {inviteOpen && (
          <Dialog
            title={createdInvite ? '초대 링크가 준비됐어요' : '함께할 동료를 초대해요'}
            description={
              createdInvite
                ? '한 명의 동료에게 이 링크를 전달해 주세요.'
                : '동료가 편하게 읽을 수 있는 언어를 선택해 주세요.'
            }
            onClose={() => setInviteOpen(false)}
            busy={busy}
          >
            {createdInvite ? (
              <div className="ws-invite-created">
                <div className="ws-invite-success">
                  <Check size={24} />
                </div>
                <div className="ws-invite-created-meta">
                  <strong>{site.name}</strong>
                  <span>
                    {languageName(createdInvite.invitation.language)} ·{' '}
                    {shortDate(createdInvite.invitation.expiresAt)}까지 유효
                  </span>
                </div>
                <label className="ws-field" htmlFor="ws-created-invite-link">
                  <span>초대 링크</span>
                  <div className="ws-copy-field">
                    <input
                      id="ws-created-invite-link"
                      ref={linkInput}
                      value={createdInvite.url}
                      readOnly
                      onFocus={(event) => event.target.select()}
                    />
                    <button
                      type="button"
                      className="ws-button ws-button--primary ws-button--small"
                      onClick={() => void copyLink()}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? '복사 완료' : '복사'}
                    </button>
                  </div>
                </label>
                <p className="ws-field-note" role="status">
                  {copyError
                    ? '자동 복사를 사용할 수 없어요. 선택된 링크를 직접 복사해 주세요.'
                    : copied
                      ? '링크를 복사했어요. 동료에게 메시지로 전달해 주세요.'
                      : '카카오톡이나 문자에 붙여 넣어 공유해 주세요.'}
                </p>
                <div className="ws-invite-how">
                  <Smartphone size={21} />
                  <p>
                    동료는 휴대폰에서 링크를 열고
                    <br />
                    <strong>가입 또는 로그인 → 초대 수락</strong>으로 참여해요.
                  </p>
                </div>
                <p className="ws-caption">
                  이 창을 닫기 전에 링크를 복사해 주세요. 다시 필요하면 새 초대를 만들 수 있어요.
                </p>
                <div className="ws-dialog-actions">
                  <button
                    className="ws-button ws-button--primary"
                    onClick={() => setInviteOpen(false)}
                  >
                    완료
                    <Check size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <form className="ws-form ws-invite-form" onSubmit={createInvitation}>
                <fieldset className="ws-language-options">
                  <legend>작업 안내 언어</legend>
                  {(
                    [
                      { value: 'ko', title: '한국어', subtitle: '한국어로 안내를 확인해요' },
                      { value: 'vi', title: 'Tiếng Việt', subtitle: '베트남어로 안내를 확인해요' },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.value}
                      className={language === option.value ? 'is-selected' : ''}
                    >
                      <input
                        type="radio"
                        name="invite-language"
                        value={option.value}
                        checked={language === option.value}
                        onChange={() => setLanguage(option.value)}
                        disabled={busy}
                      />
                      <span>
                        <strong>{option.title}</strong>
                        <small>{option.subtitle}</small>
                      </span>
                      {language === option.value && <Check size={17} />}
                    </label>
                  ))}
                </fieldset>
                <div className="ws-info-box">
                  <ShieldCheck size={19} />
                  <p>
                    초대한 동료는 <strong>근로자</strong>로 참여해요.
                    <br />
                    <span>작업 안내를 보고 확인이나 도움 요청을 남길 수 있어요.</span>
                  </p>
                </div>
                <FormError>{actionError}</FormError>
                <div className="ws-dialog-actions">
                  <button
                    type="button"
                    className="ws-button ws-button--secondary"
                    onClick={() => setInviteOpen(false)}
                    disabled={busy}
                  >
                    취소
                  </button>
                  <button type="submit" className="ws-button ws-button--primary" disabled={busy}>
                    {busy ? (
                      <>
                        <BusyIcon />
                        만드는 중
                      </>
                    ) : (
                      <>
                        <Link2 size={16} />
                        초대 링크 만들기
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </Dialog>
        )}
        {removal && (
          <Dialog
            title={
              removal.type === 'member'
                ? `${removal.member.name}님의 참여를 해제할까요?`
                : '이 초대를 취소할까요?'
            }
            description={
              removal.type === 'member'
                ? '이 동료는 더 이상 덕장의 안내를 확인할 수 없어요. 다시 함께하려면 새 초대를 보내 주세요.'
                : '공유한 링크로 더 이상 참여할 수 없어요. 필요하면 새 초대를 만들 수 있어요.'
            }
            onClose={() => setRemoval(null)}
            busy={busy}
          >
            <FormError>{actionError}</FormError>
            <div className="ws-dialog-actions">
              <button
                className="ws-button ws-button--secondary"
                onClick={() => setRemoval(null)}
                disabled={busy}
              >
                돌아가기
              </button>
              <button
                className="ws-button ws-button--primary"
                onClick={() => void confirmRemoval()}
                disabled={busy}
              >
                {busy ? (
                  <BusyIcon />
                ) : removal.type === 'member' ? (
                  <UserMinus size={16} />
                ) : (
                  <X size={16} />
                )}
                {removal.type === 'member' ? '참여 해제' : '초대 취소'}
              </button>
            </div>
          </Dialog>
        )}
        {editOpen && (
          <Dialog title="덕장 정보" onClose={() => setEditOpen(false)} wide busy={editBusy}>
            <SiteSetup
              initialSite={site}
              onBusyChange={setEditBusy}
              onCancel={() => setEditOpen(false)}
              onSaved={(updated) => {
                onSiteUpdated(updated);
                setEditOpen(false);
                setNotice('덕장 정보를 수정했어요.');
              }}
            />
          </Dialog>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {notice && (
          <motion.div
            className="ws-toast"
            role="status"
            style={{ x: '-50%' }}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Check size={17} />
            {notice}
            <button
              className="ws-icon-button"
              aria-label="알림 닫기"
              onClick={() => setNotice(null)}
            >
              <X size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
