import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  Copy,
  Globe2,
  Plus,
  Menu,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  Volume2,
  Wind,
  X,
} from 'lucide-react';
import { type ChatReply } from './lib/chat';
import { useLiveObservations } from './hooks/useLiveObservations';
import { observationTime } from './components/chat/ConditionsCard';
import { useChat } from './hooks/useChat';
import { BrandMark } from './components/BrandMark';
import { ReplyCards } from './components/chat/ReplyCards';
import { ThinkingPanel } from './components/chat/ThinkingPanel';
import { Welcome } from './components/chat/Welcome';
import { Composer } from './components/chat/Composer';
import { Sidebar } from './components/layout/Sidebar';
import { MobileTabBar } from './components/layout/MobileTabBar';
import { SiteSwitcher } from './components/layout/SiteSwitcher';
import type { View } from './types/ui';
import { WorkspaceGate, type WorkspaceContext } from './components/WorkspaceGate';
import { OwnerHome } from './components/OwnerHome';
import { WorkerHome } from './components/WorkerHome';
import { TeamView } from './components/workspace';
import { formatDistance } from './lib/geo';
import { useOperations } from './lib/operations';
import { BatchesView, GuidanceView, OperationsDialogs } from './components/Operations';

export default function App() {
  return (
    <WorkspaceGate>
      {(context) =>
        context.site.role === 'worker' ? (
          <WorkerWorkspace key={`${context.user.id}:${context.site.id}`} {...context} />
        ) : (
          <OwnerWorkspace key={`${context.user.id}:${context.site.id}`} {...context} />
        )
      }
    </WorkspaceGate>
  );
}

function WorkerWorkspace(context: WorkspaceContext) {
  const { user, site, sites, onSelectSite, onLogout, onSiteUpdated } = context;
  const operations = useOperations(null, { siteId: site.id, role: site.role, userId: user.id });
  return (
    <div className="worker-workspace">
      {sites.length > 1 && (
        <div className="worker-site-switch">
          <SiteSwitcher
            site={site}
            sites={sites}
            language={site.language}
            disabled={operations.saving}
            onSelect={onSelectSite}
          />
        </div>
      )}
      <WorkerHome
        site={site}
        user={user}
        operations={operations}
        onLogout={onLogout}
        onSiteUpdated={onSiteUpdated}
      />
    </div>
  );
}

function OwnerWorkspace({
  user,
  site,
  sites,
  onSelectSite,
  onAddSite,
  onSiteUpdated,
  onLogout,
}: WorkspaceContext) {
  const live = useLiveObservations(site.id, `${site.latitude},${site.longitude}`);
  const operations = useOperations(live.selected, {
    siteId: site.id,
    role: site.role,
    userId: user.id,
  });
  // 로그인하면 AI 도우미부터 보인다. 첫 화면(Welcome)에 오늘의 관측도 함께 나온다.
  const [view, setView] = useState<View>('chat');
  const [guidanceId, setGuidanceId] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const {
    conversations,
    activeId,
    setActiveId,
    activeChat,
    draft,
    setDraft,
    loadingId,
    isLoading,
    steps,
    error,
    send,
    cancel,
    newConversation: createConversation,
    deleteConversation,
  } = useChat({
    siteId: site.id,
    scopeKey: `${user.id}:${site.id}`,
    // 사용자가 직접 고른 장비일 때만 보낸다. 자동 선택을 보내면 서버가 기상청 대체·이상 장비 판단을 못 한다.
    deviceId:
      live.preferredDeviceId && live.preferredDeviceId === live.deviceId
        ? live.preferredDeviceId
        : undefined,
    onNotice: setToast,
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const settingsRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const hasMessages = Boolean(activeChat?.messages.length);
  const stationName = live.selected?.device.name ?? '관측소 미선택';
  const sourceLabel = live.loading
    ? '관측 정보 확인 중'
    : live.selected?.device.provider === 'kma'
      ? '기상청 · AWS 실시간'
      : live.selected?.device.provider === 'kma-grid'
        ? '기상청 · 초단기실황 격자'
        : live.snapshot?.status === 'archived'
          ? 'E-UM · 보관된 실측'
          : live.snapshot?.status === 'ok'
            ? 'E-UM · API 응답'
            : '관측 연결 확인 필요';

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (view !== 'chat') return;
    // Stay put when the user scrolled up to read older messages.
    if (!pinnedToBottom.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [activeChat?.messages.length, loadingId, view, reducedMotion, activeId]);
  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (view === 'chat') inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view]);
  function updatePinned() {
    const el = chatScrollRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    pinnedToBottom.current = pinned;
    setAtBottom(pinned);
  }
  useEffect(() => {
    const popup = settingsOpen
      ? settingsRef.current
      : helpOpen
        ? helpRef.current
        : sidebarOpen
          ? sidebarRef.current
          : null;
    if (!popup) return;
    const previous = document.activeElement as HTMLElement;
    const focusables = () =>
      Array.from(
        popup.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], [tabindex="0"]',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        setHelpOpen(false);
        setSidebarOpen(false);
      }
      if (event.key === 'Tab') {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [settingsOpen, helpOpen, sidebarOpen]);

  async function copyAnswer(content: string, messageId: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setToast('답변을 복사했습니다.');
    } catch {
      setToast('복사할 수 없습니다. 텍스트를 직접 선택해 주세요.');
    }
  }
  /** 답을 브라우저 내장 음성(한국어)으로 읽는다. 서버나 비용 없이 기기에서만 동작한다 (QA C). */
  function readAloud(content: string, messageId: string) {
    const speech = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!speech || typeof SpeechSynthesisUtterance === 'undefined') {
      setToast('이 브라우저는 읽어 주기를 지원하지 않아요.');
      return;
    }
    speech.cancel();
    if (speakingId === messageId) {
      setSpeakingId(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = 'ko-KR';
    const voice = speech.getVoices().find((item) => item.lang.toLowerCase().startsWith('ko'));
    if (voice) utterance.voice = voice;
    utterance.onend = () => setSpeakingId((current) => (current === messageId ? null : current));
    utterance.onerror = utterance.onend;
    setSpeakingId(messageId);
    speech.speak(utterance);
  }
  // 다른 대화로 옮기거나 화면을 떠나면 읽기를 멈춘다.
  useEffect(() => {
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  }, [activeId]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  function openSettings() {
    setSettingsOpen(true);
  }
  function navigate(nextView: View) {
    setView(nextView);
    setSidebarOpen(false);
  }
  function newConversation() {
    createConversation();
    setView('chat');
    setSidebarOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }
  function stopRequest() {
    cancel();
    setToast('요청을 중단했습니다.');
  }
  function sendMessage(prompt: string, retry = false) {
    setView('chat');
    pinnedToBottom.current = true;
    setAtBottom(true);
    return send(prompt, retry);
  }

  function regenerate(messageIndex: number) {
    const messages = activeChat?.messages ?? [];
    for (let i = messageIndex - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        void sendMessage(messages[i].content, true);
        return;
      }
    }
  }

  function actionFor(reply: ChatReply) {
    if (reply.action === 'start-batch') {
      navigate('batches');
      if (reply.prefill) operations.openStartWith(reply.prefill);
      else operations.openStart();
    }
    if (reply.action === 'end-batch') {
      navigate('batches');
      operations.openEnd();
    }
    if (reply.action === 'guidance') {
      navigate('guidance');
      if (reply.assessment)
        operations.openGuidanceFromAssessment(reply.assessment, reply.observation ?? live.selected);
      else operations.openGuidanceFromObservation(reply.observation ?? live.selected);
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        sidebarRef={sidebarRef}
        isOpen={sidebarOpen}
        view={view}
        conversations={conversations}
        activeId={activeId}
        activeBatchCount={operations.batches.filter((batch) => batch.status === 'ongoing').length}
        onNavigate={navigate}
        onSelectConversation={(id) => {
          setActiveId(id);
          setView('chat');
          setSidebarOpen(false);
          pinnedToBottom.current = true;
          setAtBottom(true);
        }}
        onNewConversation={newConversation}
        onDeleteConversation={deleteConversation}
        onCollapse={() => setSidebarCollapsed(true)}
        onClose={() => setSidebarOpen(false)}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenSettings={openSettings}
        stationName={site.name}
        sourceLabel={sourceLabel}
        user={user}
        onLogout={onLogout}
        busy={operations.saving}
      />

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={21} />
            </button>
            {sidebarCollapsed && (
              <button
                className="icon-button expand-sidebar"
                aria-label="사이드바 펼치기"
                onClick={() => setSidebarCollapsed(false)}
              >
                <Menu size={20} />
              </button>
            )}
            <span className="breadcrumb-parent">워크스페이스</span>
            <ChevronRight className="breadcrumb-chevron" size={13} />
            <strong>
              {
                {
                  home: '오늘의 덕장',
                  chat: 'AI 도우미',
                  batches: '건조 기록',
                  guidance: '작업 안내',
                  team: '덕장·팀 관리',
                }[view]
              }
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-badge">
              <span />
              {sourceLabel}
            </span>
            <SiteSwitcher
              site={site}
              sites={sites}
              disabled={operations.saving}
              onSelect={onSelectSite}
            />
            <button
              className="icon-button"
              disabled={operations.saving}
              aria-label="덕장 추가"
              title="덕장 추가"
              onClick={onAddSite}
            >
              <Plus size={18} />
            </button>
          </div>
        </header>

        <main
          id="main-content"
          className={`main-content ${view !== 'chat' ? 'operations-main' : ''}`}
        >
          {view === 'home' ? (
            <OwnerHome
              user={user}
              site={site}
              operations={operations}
              live={live}
              onNavigate={navigate}
              onAsk={sendMessage}
              onOpenGuidance={(id) => {
                setGuidanceId(id);
                navigate('guidance');
              }}
            />
          ) : view === 'team' ? (
            <TeamView site={site} onSiteUpdated={onSiteUpdated} />
          ) : view === 'chat' ? (
            <>
              <div
                className={`chat-scroll ${hasMessages ? 'has-messages' : ''}`}
                ref={chatScrollRef}
                onScroll={updatePinned}
              >
                {!hasMessages ? (
                  <Welcome
                    snapshot={live.snapshot}
                    observation={live.selected}
                    observationsLoading={live.loading}
                    observationsError={live.error}
                    onRefresh={() => void live.refresh()}
                    isLoading={isLoading}
                    reducedMotion={reducedMotion}
                    activeBatchName={operations.activeBatch?.name}
                    onAsk={sendMessage}
                    onNavigate={navigate}
                  />
                ) : (
                  <div className="conversation-content">
                    <div className="conversation-date">
                      <span />
                      대화 기록
                      <span />
                    </div>
                    {activeChat?.messages.map((message, index) => (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className={`message ${message.role}`}
                      >
                        {message.role === 'assistant' && (
                          <div className="assistant-byline">
                            <BrandMark />
                            <strong>해풍</strong>
                            <span>덕장 AI 파트너</span>
                          </div>
                        )}
                        {message.reply && (
                          <ReplyCards
                            reply={message.reply}
                            onStart={() => {
                              navigate('batches');
                              operations.openStart();
                            }}
                            onGuide={() => {
                              navigate('guidance');
                              if (message.reply!.assessment)
                                operations.openGuidanceFromAssessment(
                                  message.reply!.assessment,
                                  message.reply!.observation ?? live.selected,
                                );
                              else
                                operations.openGuidanceFromObservation(
                                  message.reply!.observation ?? live.selected,
                                );
                            }}
                          />
                        )}
                        <div className="message-body">{message.content}</div>
                        {message.reply?.sources?.length ? (
                          <p className="reply-sources">
                            근거 · {message.reply.sources.join(' · ')}
                          </p>
                        ) : null}
                        {message.reply?.providerNotice && (
                          <p className="provider-notice">{message.reply.providerNotice}</p>
                        )}
                        {message.reply?.action && (
                          <button
                            className="reply-action button-primary"
                            onClick={() => actionFor(message.reply!)}
                          >
                            {message.reply.action === 'start-batch'
                              ? '건조 시작 확인하기'
                              : message.reply.action === 'end-batch'
                                ? '회수 및 종료 확인하기'
                                : '한국어 작업 안내 검토하기'}
                            <ArrowRight size={15} />
                          </button>
                        )}
                        {message.role === 'assistant' && (
                          <div className="message-tools">
                            <span>
                              <CheckCheck size={13} />
                              {message.reply?.provider === 'openai'
                                ? 'GPT 응답'
                                : message.reply?.provider === 'claude'
                                  ? 'Claude 응답'
                                  : message.reply?.provider === 'compatible'
                                    ? '외부 AI 응답'
                                    : '관측 정보 안내'}
                            </span>
                            <button
                              className="icon-button"
                              aria-label="답변 복사"
                              onClick={() => void copyAnswer(message.content, message.id)}
                            >
                              {copiedId === message.id ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                            <button
                              className="icon-button"
                              aria-label={
                                speakingId === message.id ? '읽기 멈추기' : '답변 읽어 주기'
                              }
                              title={speakingId === message.id ? '읽기 멈추기' : '답변 읽어 주기'}
                              onClick={() => readAloud(message.content, message.id)}
                            >
                              {speakingId === message.id ? (
                                <Square size={13} />
                              ) : (
                                <Volume2 size={14} />
                              )}
                            </button>
                            {index === (activeChat?.messages.length ?? 0) - 1 && !isLoading && (
                              <button
                                className="icon-button"
                                aria-label="답변 다시 생성"
                                title="답변 다시 생성"
                                onClick={() => regenerate(index)}
                              >
                                <RotateCcw size={14} />
                              </button>
                            )}
                          </div>
                        )}
                        {message.reply && (
                          <div className="followup-suggestions">
                            {message.reply.suggestions.map((suggestion) => (
                              <button
                                key={suggestion}
                                disabled={isLoading}
                                onClick={() => void sendMessage(suggestion)}
                              >
                                {suggestion}
                                <ArrowRight size={13} />
                              </button>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    ))}
                    {loadingId === activeId && <ThinkingPanel steps={steps} />}
                    {error?.sessionId === activeId && (
                      <div className="request-error" role="alert">
                        <strong>응답을 가져오지 못했어요.</strong>
                        <p>{error.message}</p>
                        <button
                          className="button-outline"
                          onClick={() => void sendMessage(error.prompt, true)}
                        >
                          다시 시도
                        </button>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>
              <Composer
                draft={draft}
                isLoading={isLoading}
                stationName={stationName}
                inputRef={inputRef}
                onDraftChange={setDraft}
                onSend={sendMessage}
                onCancel={stopRequest}
              />
            </>
          ) : view === 'batches' ? (
            <BatchesView
              operations={operations}
              onAsk={(prompt) => {
                navigate('chat');
                void sendMessage(prompt);
              }}
            />
          ) : (
            <GuidanceView operations={operations} initialGuidanceId={guidanceId} />
          )}
        </main>
        <MobileTabBar
          view={view}
          activeBatchCount={operations.batches.filter((batch) => batch.status === 'ongoing').length}
          onNavigate={navigate}
        />
        {hasMessages && view === 'chat' && !atBottom && (
          <button
            className="jump-bottom"
            aria-label="대화 맨 아래로"
            onClick={() =>
              bottomRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })
            }
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      <OperationsDialogs operations={operations} />
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <Check size={16} />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {(settingsOpen || helpOpen) && (
        <div
          className="modal-overlay"
          onClick={() => {
            setSettingsOpen(false);
            setHelpOpen(false);
          }}
        >
          {settingsOpen ? (
            <div
              className="app-dialog"
              ref={settingsRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="app-dialog-heading">
                <span className="starter-icon green">
                  <Settings2 size={22} />
                </span>
                <button
                  className="icon-button"
                  aria-label="설정 닫기"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X size={21} />
                </button>
              </div>
              <h2 id="settings-title">데이터 연결</h2>
              <p>관측값의 출처와 현재 연결 상태를 확인하세요.</p>
              <dl className="connection-settings">
                <div>
                  <dt>데이터 출처</dt>
                  <dd>{live.snapshot?.source ?? 'E-UM 디지털 트윈 포항'}</dd>
                </div>
                <div>
                  <dt>관측소</dt>
                  <dd>{stationName}</dd>
                </div>
                <div>
                  <dt>관측 시각</dt>
                  <dd>{observationTime(live.selected?.observedAt ?? null)}</dd>
                </div>
                <div>
                  <dt>마지막 요청</dt>
                  <dd>{observationTime(live.snapshot?.fetchedAt ?? null)}</dd>
                </div>
                <div>
                  <dt>GPT 연결 설정</dt>
                  <dd>{live.snapshot?.llm.configured ? live.snapshot.llm.model : '확인 필요'}</dd>
                </div>
                <div>
                  <dt>덕장 위치</dt>
                  <dd>
                    {site.address} ·{' '}
                    {live.selected?.device.provider === 'kma-grid' ? '격자 중심까지' : '관측소까지'}{' '}
                    {formatDistance(live.selected?.distanceM)}
                  </dd>
                </div>
              </dl>
              <label className="station-setting">
                관측소 선택
                <select
                  value={live.preferredDeviceId}
                  onChange={(event) => live.selectDevice(event.target.value)}
                >
                  <option value="">가까운 관측소 자동 선택</option>
                  {live.snapshot?.devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="settings-note">
                <ShieldCheck size={17} />
                <span>
                  {live.snapshot?.warnings.join(' ') ||
                    live.error ||
                    'API 응답을 기다리고 있습니다.'}
                </span>
              </div>
              <button
                className="button-primary full-width"
                disabled={live.loading}
                onClick={() => void live.refresh()}
              >
                {live.loading ? '연결 확인 중…' : '연결 다시 확인'}
              </button>
            </div>
          ) : (
            <div
              className="app-dialog"
              ref={helpRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="app-dialog-heading">
                <BrandMark />
                <button
                  className="icon-button"
                  aria-label="가이드 닫기"
                  onClick={() => setHelpOpen(false)}
                >
                  <X size={21} />
                </button>
              </div>
              <h2 id="help-title">덕장의 하루를, 조금 더 편하게</h2>
              <p>해풍은 구룡포 과메기 생산을 돕는 AI 파트너예요.</p>
              <div className="help-items">
                <div>
                  <Wind size={21} />
                  <section>
                    <strong>판단이 필요할 땐, AI 도우미</strong>
                    <p>
                      실제 기온·습도·풍속과 측정 시각을 확인하세요. 최신 정보가 없으면 그 한계를
                      함께 알려드려요.
                    </p>
                  </section>
                </div>
                <div>
                  <ClipboardList size={21} />
                  <section>
                    <strong>시작부터 회수까지, 건조 기록</strong>
                    <p>
                      버튼으로 건조를 시작하고 종료하세요. 상태를 바꾸기 전에 한 번 더 확인해요.
                    </p>
                  </section>
                </div>
                <div>
                  <Globe2 size={21} />
                  <section>
                    <strong>원문을 확인하고, 작업 안내</strong>
                    <p>
                      한국어 안내를 승인하면 초대받은 근로자가 자기 언어로 확인해요. 확인·질문·완료
                      보고를 작업 안내에서 살펴보세요.
                    </p>
                  </section>
                </div>
              </div>
              <button className="button-primary full-width" onClick={() => setHelpOpen(false)}>
                해풍 시작하기
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
