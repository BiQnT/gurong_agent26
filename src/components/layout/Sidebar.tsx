import { useState, type RefObject } from 'react';
import {
  CircleHelp,
  ClipboardList,
  ExternalLink,
  Globe2,
  History,
  MapPin,
  Home,
  Users,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Conversation } from '../../hooks/useChat';
import type { Account } from '../../lib/workspace';
import type { View } from '../../types/ui';
import { BrandMark } from '../BrandMark';

type SidebarProps = {
  user: Account;
  onLogout: () => void;
  busy: boolean;
  sidebarRef: RefObject<HTMLElement>;
  isOpen: boolean;
  view: View;
  conversations: Conversation[];
  activeId: string | null;
  activeBatchCount: number;
  onNavigate: (view: View) => void;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onCollapse: () => void;
  onClose: () => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  stationName: string;
  sourceLabel: string;
};

export function Sidebar({
  user,
  onLogout,
  busy,
  sidebarRef,
  isOpen,
  view,
  conversations,
  activeId,
  activeBatchCount,
  onNavigate,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onCollapse,
  onClose,
  onOpenHelp,
  onOpenSettings,
  stationName,
  sourceLabel,
}: SidebarProps) {
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const filteredChats = conversations.filter((chat) =>
    chat.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <aside
      ref={sidebarRef}
      className={`sidebar ${isOpen ? 'mobile-open' : ''}`}
      aria-label="주 메뉴"
      {...(isOpen ? { role: 'dialog', 'aria-modal': true } : {})}
    >
      <div className="sidebar-brand">
        <button className="brand-link" onClick={() => onNavigate('home')} aria-label="해풍 홈">
          <BrandMark />
          <span>
            해풍<small>HAEPUNG</small>
          </span>
        </button>
        <button
          className="icon-button sidebar-collapse-control"
          aria-label="사이드바 접기"
          onClick={onCollapse}
        >
          <PanelLeftClose size={18} />
        </button>
        <button className="icon-button mobile-close" aria-label="메뉴 닫기" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <button className="new-chat-button" onClick={onNewConversation}>
        <Plus size={18} />
        <span>새로운 대화</span>
        <span className="new-chat-symbol">↗</span>
      </button>
      <div className="nav-caption">워크스페이스</div>
      <nav className="main-nav">
        <button
          className={view === 'chat' ? 'active' : ''}
          aria-current={view === 'chat' ? 'page' : undefined}
          onClick={() => onNavigate('chat')}
        >
          <MessageSquare size={19} />
          <span>AI 도우미</span>
          <span className="nav-sparkle">
            <Sparkles size={14} />
          </span>
        </button>
        <button
          className={view === 'home' ? 'active' : ''}
          aria-current={view === 'home' ? 'page' : undefined}
          onClick={() => onNavigate('home')}
        >
          <Home size={19} />
          <span>오늘의 덕장</span>
        </button>
        <button
          className={view === 'batches' ? 'active' : ''}
          aria-current={view === 'batches' ? 'page' : undefined}
          onClick={() => onNavigate('batches')}
        >
          <ClipboardList size={19} />
          <span>건조 기록</span>
          {activeBatchCount > 0 && <span className="nav-count">{activeBatchCount}</span>}
        </button>
        <button
          className={view === 'guidance' ? 'active' : ''}
          aria-current={view === 'guidance' ? 'page' : undefined}
          onClick={() => onNavigate('guidance')}
        >
          <Globe2 size={19} />
          <span>작업 안내</span>
        </button>
        <button
          className={view === 'team' ? 'active' : ''}
          aria-current={view === 'team' ? 'page' : undefined}
          onClick={() => onNavigate('team')}
        >
          <Users size={19} />
          <span>덕장·팀 관리</span>
        </button>
      </nav>
      <div className="history-heading">
        <span className="nav-caption">최근 대화</span>
        <button
          className="icon-button"
          aria-label="대화 검색"
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <Search size={15} />
        </button>
      </div>
      {searchOpen && (
        <div className="history-search">
          <Search size={14} />
          <input
            autoFocus
            aria-label="대화 제목 검색"
            placeholder="대화 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      )}
      <div className="chat-history">
        {filteredChats.length ? (
          filteredChats.map((chat) => (
            <div
              key={chat.id}
              className={`history-row ${activeId === chat.id && view === 'chat' ? 'selected' : ''}`}
            >
              <button
                className="history-item"
                aria-current={activeId === chat.id && view === 'chat' ? 'page' : undefined}
                onClick={() => {
                  onSelectConversation(chat.id);
                  onNavigate('chat');
                }}
              >
                <MessageSquare size={14} />
                <span>{chat.title}</span>
              </button>
              <button
                className="history-delete"
                aria-label={`대화 삭제: ${chat.title}`}
                onClick={() => {
                  if (window.confirm('이 대화를 삭제할까요?')) onDeleteConversation(chat.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        ) : (
          <div className="history-empty">
            <History size={18} />
            <p>{search ? '검색 결과가 없어요.' : '나눈 대화가 여기에 쌓여요.'}</p>
          </div>
        )}
      </div>
      <div className="sidebar-bottom">
        <div className="site-card">
          <span className="site-card-icon">
            <MapPin size={18} />
          </span>
          <div>
            <strong>{stationName}</strong>
            <span>{sourceLabel}</span>
          </div>
          <span className="site-dot" />
        </div>
        <button className="sidebar-help" onClick={onOpenHelp}>
          <CircleHelp size={17} />
          <span>해풍 사용 가이드</span>
          <ExternalLink size={13} />
        </button>
        <div className="profile-row">
          <div className="profile-avatar">{user.name.slice(0, 1)}</div>
          <div>
            <strong>{user.name} · 운영자</strong>
            <span title={user.email}>{user.email}</span>
          </div>
          <button className="icon-button" aria-label="데이터 연결 상태" onClick={onOpenSettings}>
            <Settings2 size={17} />
          </button>
        </div>
        <button className="sidebar-logout" disabled={busy} onClick={onLogout}>
          <LogOut size={14} />
          로그아웃
        </button>
      </div>
    </aside>
  );
}
