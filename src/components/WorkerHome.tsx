import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  Clock3,
  Fish,
  Languages,
  LogOut,
  MessageCircle,
  RefreshCw,
  Send,
  Wind,
} from 'lucide-react';
import { type Account, type MemberLanguage, type Site, workspaceApi } from '../lib/workspace';
import type { Guidance, Operations } from '../lib/operations';
import './worker.css';

const copy = {
  ko: {
    home: '오늘의 작업',
    role: '근로자',
    greeting: '님, 반가워요.',
    intro: '작업 안내를 확인하고 현장 소식을 알려주세요.',
    logout: '로그아웃',
    refresh: '새로고침',
    language: '안내 언어',
    ongoing: '진행 중인 건조',
    noBatch: '현재 진행 중인 배치가 없어요.',
    fish: '마리',
    started: '시작',
    tasks: '할 일',
    history: '지난 안내',
    waiting: '새 작업 안내를 기다리고 있어요.',
    waitingBody: '운영자가 안내를 공유하면 이곳에 표시돼요.',
    historyEmpty: '아직 지난 안내가 없어요.',
    general: '덕장 전체 안내',
    confirmed: '확인했어요',
    confirm: '안내 확인',
    complete: '작업 완료 보고',
    completed: '완료를 보고했어요',
    original: '베트남어 번역 보기',
    replyTitle: '내가 남긴 응답',
    question: '질문',
    ownerAnswer: '운영자 답변 · 원문',
    awaitingAnswer: '운영자의 답변을 기다리고 있어요.',
    questionPlaceholder: '궁금한 점이나 현장 상황을 알려주세요.',
    send: '질문 보내기',
    noReply: '확인이나 질문을 남기면 운영자에게 전달돼요.',
    closed: '종료된 배치의 안내',
    readOnly: '배치 종료는 운영자가 확인해요. 내가 보낸 응답은 아래에 남아 있어요.',
    loading: '덕장의 작업을 불러오고 있어요.',
    failed: '연결을 확인한 뒤 다시 시도해 주세요.',
    retry: '다시 불러오기',
    saving: '전달하는 중…',
    currentFacts: '안내에 포함된 관측 참고값',
    staleFacts: '이전 관측자료 · 현재 날씨가 아니에요',
    temperature: '기온',
    humidity: '습도',
    wind: '풍속',
    readNotice: '안내 확인을 운영자에게 알렸어요.',
    completeNotice: '작업 완료를 운영자에게 알렸어요.',
    questionNotice: '질문을 운영자에게 전달했어요.',
    languageNotice: '안내 언어를 변경했어요.',
    myWork: '나의 작업',
    allDone: '확인할 새 안내가 없어요.',
    allDoneBody: '완료한 작업은 지난 안내에서 볼 수 있어요.',
  },
  vi: {
    home: 'Công việc hôm nay',
    role: 'Nhân viên',
    greeting: ', chào bạn.',
    intro: 'Xem hướng dẫn và báo lại tình hình công việc.',
    logout: 'Đăng xuất',
    refresh: 'Làm mới',
    language: 'Ngôn ngữ',
    ongoing: 'Đang phơi',
    noBatch: 'Hiện chưa có mẻ cá đang phơi.',
    fish: 'con cá',
    started: 'Bắt đầu',
    tasks: 'Cần làm',
    history: 'Lịch sử',
    waiting: 'Đang chờ hướng dẫn mới.',
    waitingBody: 'Hướng dẫn của người quản lý sẽ xuất hiện ở đây.',
    historyEmpty: 'Chưa có hướng dẫn trước đây.',
    general: 'Thông báo chung',
    confirmed: 'Đã đọc',
    confirm: 'Xác nhận đã đọc',
    complete: 'Báo hoàn thành',
    completed: 'Đã báo hoàn thành',
    original: 'Xem bản gốc tiếng Hàn',
    replyTitle: 'Phản hồi của tôi',
    question: 'Câu hỏi',
    ownerAnswer: 'Trả lời của quản lý · Bản gốc',
    awaitingAnswer: 'Đang chờ người quản lý trả lời.',
    questionPlaceholder: 'Gửi câu hỏi hoặc tình hình tại nơi làm việc.',
    send: 'Gửi câu hỏi',
    noReply: 'Xác nhận và câu hỏi của bạn sẽ được gửi cho người quản lý.',
    closed: 'Mẻ cá đã kết thúc',
    readOnly: 'Người quản lý xác nhận kết thúc mẻ cá. Phản hồi của bạn được lưu bên dưới.',
    loading: 'Đang tải công việc…',
    failed: 'Vui lòng kiểm tra kết nối rồi thử lại.',
    retry: 'Thử tải lại',
    saving: 'Đang gửi…',
    currentFacts: 'Số liệu tham khảo kèm hướng dẫn',
    staleFacts: 'Số liệu cũ · không phải thời tiết hiện tại',
    temperature: 'Nhiệt độ',
    humidity: 'Độ ẩm',
    wind: 'Gió',
    readNotice: 'Đã gửi xác nhận cho người quản lý.',
    completeNotice: 'Đã báo hoàn thành cho người quản lý.',
    questionNotice: 'Đã gửi câu hỏi cho người quản lý.',
    languageNotice: 'Đã đổi ngôn ngữ.',
    myWork: 'Công việc của tôi',
    allDone: 'Không có hướng dẫn mới.',
    allDoneBody: 'Bạn có thể xem công việc đã hoàn thành trong lịch sử.',
  },
} as const;
type WorkerCopy = { [K in keyof typeof copy.ko]: string };
const vietnameseTitles: Record<string, string> = {
  '과메기 널기': 'Treo cá lên giàn phơi',
  '과메기 회수': 'Thu cá trên giàn phơi',
  '건조 상태 확인': 'Kiểm tra tình trạng cá',
};
function formatDate(at: string, language: MemberLanguage) {
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at));
}
function ownReplies(item: Guidance, userId: string) {
  return item.replies.filter((reply) => !reply.simulated && reply.userId === userId);
}

function WorkerGuidance({
  item,
  operations,
  user,
  language,
  label,
  closed,
  onNotice,
}: {
  item: Guidance;
  operations: Operations;
  user: Account;
  language: MemberLanguage;
  label: WorkerCopy;
  closed: boolean;
  onNotice: (message: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const mine = ownReplies(item, user.id);
  const read = mine.some((reply) => reply.kind === 'read');
  const completed = mine.some((reply) => reply.kind === 'completed');
  const batch = operations.batches.find((candidate) => candidate.id === item.batchId);
  const canReply = !closed && !completed;
  const hasFacts = [item.facts.temperature, item.facts.humidity, item.facts.wind].some(
    (value) => value !== null,
  );
  async function respond(kind: 'read' | 'completed' | 'question', text?: string) {
    if (operations.saving || pendingKind) return;
    setPendingKind(kind);
    const saved = await operations.workerRespond(item.id, kind, text);
    setPendingKind(null);
    if (saved) {
      if (kind === 'question') setQuestion('');
      onNotice(
        kind === 'read'
          ? label.readNotice
          : kind === 'completed'
            ? label.completeNotice
            : label.questionNotice,
      );
    }
  }
  function ask(event: FormEvent) {
    event.preventDefault();
    if (question.trim()) void respond('question', question);
  }
  return (
    <article className={`worker-guidance ${completed || closed ? 'is-history' : ''}`}>
      <div className="worker-guidance-meta">
        <span>{batch?.name ?? label.general}</span>
        <time dateTime={item.approvedAt}>{formatDate(item.approvedAt, language)}</time>
      </div>
      <h3>{language === 'vi' ? (vietnameseTitles[item.title] ?? item.title) : item.title}</h3>
      {(completed || closed || read) && (
        <p className="worker-status">
          {completed ? <CircleCheck size={15} /> : <CheckCheck size={15} />}
          {completed ? label.completed : closed ? label.closed : label.confirmed}
        </p>
      )}
      <p className="worker-instruction" lang={language}>
        {language === 'vi' ? item.translated : item.original}
      </p>
      <details className="worker-original">
        <summary>
          {label.original}
          <ChevronDown size={15} />
        </summary>
        <p lang={language === 'vi' ? 'ko' : 'vi'}>
          {language === 'vi' ? item.original : item.translated}
        </p>
      </details>
      {hasFacts && (
        <details className="worker-facts">
          <summary>
            {label.currentFacts}
            <ChevronDown size={15} />
          </summary>
          <div>
            <dl>
              <div>
                <dt>{label.temperature}</dt>
                <dd>{item.facts.temperature ?? '—'} °C</dd>
              </div>
              <div>
                <dt>{label.humidity}</dt>
                <dd>{item.facts.humidity ?? '—'} %</dd>
              </div>
              <div>
                <dt>{label.wind}</dt>
                <dd>{item.facts.wind ?? '—'} m/s</dd>
              </div>
            </dl>
            <p>
              {item.facts.sourceDeviceName}
              {item.facts.observedAt ? ` · ${formatDate(item.facts.observedAt, language)} KST` : ''}
            </p>
            {item.facts.sourceStatus !== 'current' && <p>{label.staleFacts}</p>}
            {item.facts.sourceIssues?.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        </details>
      )}
      {canReply ? (
        <>
          <div className="worker-response-actions">
            <button
              className="worker-button worker-button--secondary"
              disabled={read || operations.saving}
              onClick={() => void respond('read')}
            >
              <Check size={18} />
              {pendingKind === 'read' ? label.saving : read ? label.confirmed : label.confirm}
            </button>
            <button
              className="worker-button worker-button--primary"
              disabled={operations.saving}
              onClick={() => void respond('completed')}
            >
              <CircleCheck size={18} />
              {pendingKind === 'completed' ? label.saving : label.complete}
            </button>
          </div>
          <form className="worker-question-form" onSubmit={ask}>
            <label htmlFor={`worker-question-${item.id}`}>
              <MessageCircle size={16} />
              {label.question}
            </label>
            <textarea
              id={`worker-question-${item.id}`}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={label.questionPlaceholder}
              rows={2}
              maxLength={500}
              disabled={operations.saving}
            />
            <button
              type="submit"
              className="worker-button worker-button--text"
              disabled={!question.trim() || operations.saving}
            >
              <Send size={15} />
              {pendingKind === 'question' ? label.saving : label.send}
            </button>
          </form>
        </>
      ) : (
        <p className="worker-readonly-note">{label.readOnly}</p>
      )}
      {mine.length > 0 ? (
        <details
          className="worker-my-replies"
          open={mine.some((reply) => reply.kind === 'question')}
        >
          <summary>
            {label.replyTitle}
            <span>{mine.length}</span>
            <ChevronDown size={15} />
          </summary>
          <ol>
            {[...mine].reverse().map((reply) => (
              <li key={reply.id}>
                <span>
                  {reply.kind === 'question' ? (
                    <MessageCircle size={14} />
                  ) : (
                    <CheckCheck size={14} />
                  )}
                </span>
                <div>
                  <strong>
                    {reply.kind === 'question'
                      ? label.question
                      : reply.kind === 'completed'
                        ? label.completed
                        : label.confirmed}
                  </strong>
                  {reply.kind === 'question' && <p>{reply.text}</p>}
                  <time dateTime={reply.at}>{formatDate(reply.at, language)}</time>
                  {reply.kind === 'question' &&
                    (reply.answer ? (
                      <div className="worker-owner-answer">
                        <strong>{label.ownerAnswer}</strong>
                        <span>{reply.answer.userName}</span>
                        <p>{reply.answer.text}</p>
                        <time dateTime={reply.answer.at}>
                          {formatDate(reply.answer.at, language)}
                        </time>
                      </div>
                    ) : (
                      <p className="worker-answer-waiting">{label.awaitingAnswer}</p>
                    ))}
                </div>
              </li>
            ))}
          </ol>
        </details>
      ) : (
        <p className="worker-response-hint">{label.noReply}</p>
      )}
    </article>
  );
}

export function WorkerHome({
  site,
  user,
  operations,
  onLogout,
  onSiteUpdated,
}: {
  site: Site;
  user: Account;
  operations: Operations;
  onLogout: () => void;
  onSiteUpdated?: (site: Site) => void;
}) {
  const [language, setLanguage] = useState<MemberLanguage>(site.language);
  const [languageSaving, setLanguageSaving] = useState(false);
  const [preferenceError, setPreferenceError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'tasks' | 'history'>('tasks');
  const currentSite = useRef(site.id);
  const mounted = useRef(true);
  currentSite.current = site.id;
  const label = copy[language];
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setLanguage(site.language);
    setPreferenceError('');
    setNotice('');
    setTab('tasks');
  }, [site.id, site.language]);
  useEffect(() => {
    setLanguageSaving(false);
  }, [site.id]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  async function changeLanguage(next: MemberLanguage) {
    const siteId = site.id;
    if (next === language || languageSaving) return;
    setLanguageSaving(true);
    setPreferenceError('');
    try {
      const updated = await workspaceApi.updatePreference(siteId, next);
      if (!mounted.current || currentSite.current !== siteId) return;
      setLanguage(updated.language);
      onSiteUpdated?.(updated);
      setNotice(copy[next].languageNotice);
    } catch (cause) {
      if (mounted.current && currentSite.current === siteId)
        setPreferenceError(cause instanceof Error ? cause.message : label.failed);
    } finally {
      if (mounted.current && currentSite.current === siteId) setLanguageSaving(false);
    }
  }
  const ongoing = operations.batches.filter((batch) => batch.status === 'ongoing');
  const isClosed = (item: Guidance) =>
    Boolean(
      item.batchId &&
      operations.batches.some((batch) => batch.id === item.batchId && batch.status !== 'ongoing'),
    );
  const done = (item: Guidance) =>
    isClosed(item) || ownReplies(item, user.id).some((reply) => reply.kind === 'completed');
  const tasks = operations.guidance.filter((item) => item.channel === 'workspace' && !done(item));
  const history = operations.guidance.filter((item) => item.channel === 'workspace' && done(item));
  const visible = tab === 'tasks' ? tasks : history;
  const error = preferenceError || operations.error;
  return (
    <div className="worker-shell" lang={language}>
      <header className="worker-topbar">
        <a className="worker-brand" href="#worker-main">
          <Wind size={23} strokeWidth={1.6} />
          <strong>해풍</strong>
          <span>{site.name}</span>
          <em className="worker-site-role">{label.role}</em>
        </a>
        <button
          className="worker-icon-button"
          onClick={onLogout}
          disabled={operations.saving || languageSaving}
          aria-label={label.logout}
          title={label.logout}
        >
          <LogOut size={19} />
        </button>
      </header>
      <main className="worker-main" id="worker-main">
        <div className="worker-tools">
          <span className="worker-role-label">{label.myWork}</span>
          <label className="worker-language-picker">
            <Languages size={16} />
            <span className="worker-sr-only">{label.language}</span>
            <select
              value={language}
              onChange={(event) => void changeLanguage(event.target.value as MemberLanguage)}
              disabled={languageSaving || operations.saving}
            >
              <option value="ko">한국어</option>
              <option value="vi">Tiếng Việt</option>
            </select>
          </label>
        </div>
        <div className="worker-welcome">
          <p>
            {user.name}
            {label.greeting}
          </p>
          <h1>{label.home}</h1>
          <span>{label.intro}</span>
        </div>
        {error && (
          <div className="worker-error" role="alert">
            <p>{language === 'vi' ? label.failed : error}</p>
            {language === 'vi' && (
              <details>
                <summary>Chi tiết</summary>
                <p lang="ko">{error}</p>
              </details>
            )}
            <button
              onClick={() => {
                setPreferenceError('');
                void operations.refresh();
              }}
              disabled={operations.loading || operations.saving}
            >
              <RefreshCw size={15} />
              {label.retry}
            </button>
          </div>
        )}
        {operations.loading ? (
          <div className="worker-loading" role="status">
            <RefreshCw size={19} />
            <p>{label.loading}</p>
          </div>
        ) : operations.ready ? (
          <>
            <section className="worker-batches" aria-labelledby="worker-batches-heading">
              <div className="worker-section-heading">
                <h2 id="worker-batches-heading">
                  {label.ongoing}
                  <span>{ongoing.length}</span>
                </h2>
                <button
                  className="worker-icon-button"
                  onClick={() => void operations.refresh()}
                  disabled={operations.saving}
                  aria-label={label.refresh}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              {ongoing.length ? (
                <div className="worker-batch-list">
                  {ongoing.map((batch) => (
                    <article className="worker-batch" key={batch.id}>
                      <span className="worker-batch-icon">
                        <Fish size={20} />
                      </span>
                      <div>
                        <h3>{batch.name}</h3>
                        <p>
                          {language === 'vi'
                            ? batch.fish === '꽁치'
                              ? 'Cá thu đao'
                              : 'Cá trích'
                            : batch.fish}{' '}
                          · {batch.quantity.toLocaleString()} {label.fish}
                        </p>
                        <span>
                          <Clock3 size={12} />
                          {formatDate(batch.startedAt, language)} · {label.started}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="worker-batches-empty">{label.noBatch}</p>
              )}
            </section>
            <section className="worker-tasks" aria-labelledby="worker-tasks-heading">
              <h2 id="worker-tasks-heading" className="worker-sr-only">
                {label.tasks}
              </h2>
              <div className="worker-tabs" role="tablist" aria-label={label.myWork}>
                <button
                  id="worker-tab-tasks"
                  role="tab"
                  aria-selected={tab === 'tasks'}
                  aria-controls="worker-task-list"
                  className={tab === 'tasks' ? 'is-active' : ''}
                  onClick={() => setTab('tasks')}
                >
                  {label.tasks}
                  <span>{tasks.length}</span>
                </button>
                <button
                  id="worker-tab-history"
                  role="tab"
                  aria-selected={tab === 'history'}
                  aria-controls="worker-task-list"
                  className={tab === 'history' ? 'is-active' : ''}
                  onClick={() => setTab('history')}
                >
                  {label.history}
                  <span>{history.length}</span>
                </button>
              </div>
              <div id="worker-task-list" role="tabpanel" aria-labelledby={`worker-tab-${tab}`}>
                {visible.length ? (
                  <div className="worker-guidance-list">
                    {visible.map((item) => (
                      <WorkerGuidance
                        item={item}
                        key={item.id}
                        operations={operations}
                        user={user}
                        language={language}
                        label={label}
                        closed={isClosed(item)}
                        onNotice={setNotice}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="worker-empty">
                    <span>
                      <CheckCheck size={28} strokeWidth={1.4} />
                    </span>
                    <h3>
                      {tab === 'history'
                        ? label.historyEmpty
                        : history.length
                          ? label.allDone
                          : label.waiting}
                    </h3>
                    <p>
                      {tab === 'tasks'
                        ? history.length
                          ? label.allDoneBody
                          : label.waitingBody
                        : label.noReply}
                    </p>
                  </div>
                )}
              </div>
            </section>
          </>
        ) : null}
      </main>
      {notice && (
        <div className="worker-toast" role="status">
          <Check size={17} />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
