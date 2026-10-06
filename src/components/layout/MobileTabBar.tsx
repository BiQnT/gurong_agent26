import { ClipboardList, Globe2, Home, MessageSquare, Users } from 'lucide-react';
import type { View } from '../../types/ui';

type MobileTabBarProps = {
  view: View;
  activeBatchCount: number;
  onNavigate: (view: View) => void;
};

// 폰 화면(900px 이하)에서만 보이는 하단 탭. 메뉴를 열지 않고 한 번에 화면을 옮긴다.
// 대화 목록·설정·로그아웃은 그대로 사이드바(☰)에 둔다.
const TABS: { view: View; label: string; icon: typeof Home }[] = [
  { view: 'chat', label: 'AI 도우미', icon: MessageSquare },
  { view: 'home', label: '오늘의 덕장', icon: Home },
  { view: 'batches', label: '건조 기록', icon: ClipboardList },
  { view: 'guidance', label: '작업 안내', icon: Globe2 },
  { view: 'team', label: '덕장·팀', icon: Users },
];

export function MobileTabBar({ view, activeBatchCount, onNavigate }: MobileTabBarProps) {
  return (
    <nav className="mobile-tabbar" aria-label="주요 화면">
      {TABS.map(({ view: target, label, icon: Icon }) => (
        <button
          key={target}
          type="button"
          className={view === target ? 'active' : ''}
          aria-current={view === target ? 'page' : undefined}
          onClick={() => onNavigate(target)}
        >
          <span className="mobile-tab-icon">
            <Icon size={21} />
            {target === 'batches' && activeBatchCount > 0 && (
              <span className="mobile-tab-count">{activeBatchCount}</span>
            )}
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
