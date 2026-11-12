import { MoreHorizontal } from 'lucide-react';
import { NAV_GROUPS, type GroupId } from '../../navigation';

interface MobileTabBarProps {
  activeGroup: GroupId;
  onGroup: (g: GroupId) => void;
  /** 더보기: 전체 메뉴(서랍) 열기 — 모양 설정·환율·버전도 여기 있다 */
  onMore: () => void;
}

/** 모바일(768px 미만) 하단 탭: 사이드바 묶음(자산·배당·신호) + 더보기 */
export default function MobileTabBar({ activeGroup, onGroup, onMore }: MobileTabBarProps) {
  const item = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1 py-2 text-[11px] transition-colors ${active ? 'text-mint-300' : 'text-zinc-500 hover:text-zinc-200'}`;
  return (
    <nav
      className="app-header fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="메뉴"
    >
      <div className="grid grid-cols-4">
        {NAV_GROUPS.map((g) => {
          const Icon = g.icon;
          const active = g.id === activeGroup;
          return (
            <button key={g.id} type="button" onClick={() => onGroup(g.id)} className={item(active)} aria-current={active ? 'page' : undefined}>
              <Icon className="h-[22px] w-[22px]" />
              {g.label}
            </button>
          );
        })}
        <button type="button" onClick={onMore} className={item(false)}>
          <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.6} />
          더보기
        </button>
      </div>
    </nav>
  );
}
