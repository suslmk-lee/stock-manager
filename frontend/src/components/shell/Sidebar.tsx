import { Download, Loader2, PanelLeftClose, PanelLeftOpen, Settings2, X } from 'lucide-react';
import Brand from '../ui/Brand';
import { useUpdates } from '../update/UpdateProvider';
import { NAV_GROUPS, type NavItem, type RouteId } from '../../navigation';
import { APP_VERSION, versionLabel, versionShortLabel, versionTooltip } from '../../utils/appVersion';

interface SidebarProps {
  route: RouteId;
  onNavigate: (id: RouteId) => void;
  /** 데스크톱에서 64px 아이콘 레일로 접힘 */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** 모바일(768px 미만)에서는 서랍으로 열고 닫는다 */
  mobile: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  usdKrw: number | null;
  onOpenSettings: () => void;
}

export default function Sidebar({
  route,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  mobile,
  mobileOpen,
  onCloseMobile,
  usdKrw,
  onOpenSettings,
}: SidebarProps) {
  const rail = collapsed && !mobile;
  const updates = useUpdates();
  const fx = usdKrw ? usdKrw.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—';

  const navButton = (item: NavItem) => {
    const active = route === item.id;
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onNavigate(item.id)}
        className={`nav-item ${active ? 'nav-item-active' : ''} ${rail ? 'justify-center !px-0' : ''}`}
        aria-current={active ? 'page' : undefined}
        title={rail ? item.label : undefined}
      >
        <Icon className="nav-item-icon h-4 w-4 shrink-0" strokeWidth={1.75} />
        {!rail && <span className="truncate">{item.label}</span>}
        {!rail && item.isNew && <span className="badge-new ml-auto">New</span>}
        {rail && item.isNew && <span className="absolute right-2.5 top-2 h-1.5 w-1.5 rounded-full bg-mint-400" aria-hidden />}
      </button>
    );
  };

  return (
    <>
      {mobile && mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm" onClick={onCloseMobile} aria-hidden />
      )}
      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-40 flex flex-col transition-[width,transform] duration-300 ${
          mobile ? `w-64 ${mobileOpen ? 'translate-x-0' : 'invisible -translate-x-full'}` : rail ? 'w-16' : 'w-52'
        }`}
        aria-label="메뉴"
      >
        <div className={`flex h-14 shrink-0 items-center ${rail ? 'justify-center' : 'justify-between px-4'}`}>
          <Brand wordmark={rail ? 'hide' : 'show'} tagline={false} />
          {mobile && (
            <button type="button" className="btn-icon" onClick={onCloseMobile} aria-label="메뉴 닫기">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label="페이지">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label}>
              {rail ? (
                gi > 0 && <div className="mx-2 my-3 h-px bg-white/[0.07]" aria-hidden />
              ) : (
                <div className="nav-group-label">{group.label}</div>
              )}
              <div className="flex flex-col gap-0.5">{group.items.map(navButton)}</div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-1 px-3 pb-3">
          {rail ? (
            <div className="flex flex-col items-center py-1.5 leading-tight" title={`USD/KRW ${fx}`}>
              <span className="label-mono !text-[9px]">USD</span>
              <span className="num text-[11px] text-zinc-200">{usdKrw ? Math.round(usdKrw).toLocaleString('ko-KR') : '—'}</span>
            </div>
          ) : (
            <div className="glass-pill mb-1 flex h-9 items-center gap-2 px-3">
              <span className="h-1.5 w-1.5 rounded-full bg-mint-400 shadow-[0_0_8px_rgb(var(--c-mint-400)/0.8)]" />
              <span className="label-mono !text-zinc-400">USD/KRW</span>
              <span className="num ml-auto text-sm font-medium text-white">{fx}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            className={`nav-item ${rail ? 'justify-center !px-0' : ''}`}
            title={rail ? '모양 설정' : undefined}
          >
            <Settings2 className="nav-item-icon h-4 w-4 shrink-0" strokeWidth={1.75} />
            {!rail && <span>모양 설정</span>}
          </button>
          {!mobile && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={`nav-item ${rail ? 'justify-center !px-0' : ''}`}
              title={rail ? '메뉴 펼치기' : undefined}
              aria-expanded={!rail}
            >
              {rail ? (
                <PanelLeftOpen className="nav-item-icon h-4 w-4 shrink-0" strokeWidth={1.75} />
              ) : (
                <PanelLeftClose className="nav-item-icon h-4 w-4 shrink-0" strokeWidth={1.75} />
              )}
              {!rail && <span>메뉴 접기</span>}
            </button>
          )}
          {/* 새 버전이 있으면 업데이트 버튼 (데스크톱 앱만) */}
          {updates.available && updates.info?.latest && (
            <button
              type="button"
              onClick={updates.openDialog}
              className={`btn-primary mt-1 w-full !py-1.5 !text-xs ${rail ? '!px-0' : ''}`}
              title={`새 버전 ${updates.info.latest} 설치`}
              aria-label={`앱 업데이트 ${updates.info.latest}`}
            >
              <Download className="h-3.5 w-3.5" />
              {!rail && <span>업데이트 {updates.info.latest}</span>}
            </button>
          )}
          {/* 현재 버전 — 데스크톱 앱에서는 누르면 새 버전을 확인한다 */}
          <button
            type="button"
            onClick={updates.enabled ? () => updates.check(true) : undefined}
            disabled={!updates.enabled || updates.checking}
            className={`mt-1 flex w-full items-center border-t border-white/[0.06] pt-2.5 font-mono text-[11px] text-zinc-500 transition-colors enabled:hover:text-zinc-300 disabled:cursor-default ${
              rail ? 'justify-center' : 'justify-between gap-2 px-2.5'
            }`}
            title={updates.enabled ? `${versionTooltip()}\n\n눌러서 새 버전 확인` : versionTooltip()}
            aria-label={updates.enabled ? `앱 버전 ${versionLabel()}, 눌러서 새 버전 확인` : `앱 버전 ${versionLabel()}`}
          >
            {rail ? (
              updates.checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>{versionShortLabel()}</span>
            ) : updates.checking ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                새 버전 확인 중…
              </span>
            ) : updates.notice ? (
              <span className={`truncate ${updates.notice.kind === 'latest' ? 'text-mint-300' : updates.notice.kind === 'error' ? 'text-rose-300' : 'text-zinc-400'}`}>
                {updates.notice.kind === 'latest' ? `✓ ${updates.notice.message}` : updates.notice.message}
              </span>
            ) : (
              <>
                <span className="whitespace-nowrap">
                  <span className="font-semibold text-zinc-300">{APP_VERSION.tag ?? 'dev'}</span>
                  {APP_VERSION.ahead > 0 && <span>+{APP_VERSION.ahead}</span>}
                </span>
                {APP_VERSION.commit && (
                  <span className="whitespace-nowrap">
                    {APP_VERSION.commit.slice(0, 7)}
                    {APP_VERSION.dirty && <span className="text-amber-300" aria-label="커밋되지 않은 변경 포함">*</span>}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
