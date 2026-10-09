import { ChevronDown, MapPin } from 'lucide-react';
import type { MemberLanguage, MemberRole, Site } from '../../lib/workspace';
import './site-switcher.css';

const roleNames: Record<MemberLanguage, Record<MemberRole, string>> = {
  ko: { owner: '운영자', worker: '근로자' },
  vi: { owner: 'Quản lý', worker: 'Nhân viên' },
};

/**
 * 지금 보는 덕장과 그 덕장에서의 내 역할을 보여 주고, 소속 덕장이 여럿이면 눌러서 바꾼다.
 * 보이는 것은 글자이고, 고르는 것은 단추 전체를 덮은 투명한 기본 선택창이다 (폰에서도 기본 목록이 뜬다).
 */
export function SiteSwitcher({
  site,
  sites,
  language = 'ko',
  disabled = false,
  onSelect,
}: {
  site: Site;
  sites: Site[];
  language?: MemberLanguage;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const roles = roleNames[language];
  const vi = language === 'vi';
  const switchable = sites.length > 1;
  // 바꿀 덕장이 없으면 선택창 없이 이름과 역할만 보인다.
  const Wrapper = switchable ? 'label' : 'div';
  return (
    <Wrapper className={`site-switcher${switchable ? ' is-switchable' : ''}`}>
      <MapPin size={17} aria-hidden="true" />
      <span className="site-switcher-text">
        <small>
          <b className={`site-role site-role--${site.role}`}>{roles[site.role]}</b>
          {switchable && (
            <>
              {vi ? ` · ${sites.length} nơi làm việc` : ` · 내 덕장 ${sites.length}곳`}
              <span className="site-switcher-hint">
                {vi ? ' · Chọn để đổi' : ' · 눌러서 바꾸기'}
              </span>
            </>
          )}
        </small>
        <strong>{site.name}</strong>
      </span>
      {switchable && (
        <>
          <ChevronDown className="site-switcher-chevron" size={17} aria-hidden="true" />
          <select
            // 화면에 보이는 덕장 이름·역할이 읽는 이름에도 들어가게 한다.
            aria-label={`${vi ? 'Đổi nơi làm việc' : '덕장 바꾸기'}: ${site.name} · ${roles[site.role]}`}
            value={site.id}
            disabled={disabled}
            onChange={(event) => onSelect(event.target.value)}
          >
            {sites.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {roles[item.role]}
              </option>
            ))}
          </select>
        </>
      )}
    </Wrapper>
  );
}
