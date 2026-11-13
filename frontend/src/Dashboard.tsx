import { useEffect, useRef, useState } from 'react';
import AppearanceSettings from './components/settings/AppearanceSettings';
import LockSettings from './components/lock/LockSettings';
import { appLock } from './platform/desktop';
import App from './App';
import AssetManager from './components/AssetManager';
import DividendManager from './components/DividendManager';
import SignalsDashboard from './pages/SignalsDashboard';
import AssetTrendPage from './pages/AssetTrendPage';
import AccumulationPage from './pages/AccumulationPage';
import PensionPage from './pages/PensionPage';
import DividendAnalysisPage from './pages/DividendAnalysisPage';
import DividendScorePage from './pages/DividendScorePage';
import TransactionManager from './components/TransactionManager';
import MobileTabBar from './components/shell/MobileTabBar';
import ProfileManager from './components/signals/ProfileManager';
import DividendCandidates from './components/signals/DividendCandidates';
import AlertsBell from './components/alerts/AlertsBell';
import Sidebar from './components/shell/Sidebar';
import { PageSlotsProvider } from './components/shell/PageSlots';
import { useAlerts } from './components/alerts/AlertsProvider';
import { apiClient } from './api/client';
import { GROUP_OF, NAV_GROUPS, NAV_ITEMS_BY_ID, type GroupId, type RouteId, useHashRoute } from './navigation';
import { useMediaQuery } from './utils/useMediaQuery';

const COLLAPSED_KEY = 'stock-manager:sidebar-collapsed';

const loadCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

export default function Dashboard() {
  const [route, navigate] = useHashRoute();
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);
  const [usdKrw, setUsdKrw] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [pinnedCollapsed, setPinnedCollapsed] = useState(loadCollapsed);
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [leadSlot, setLeadSlot] = useState<HTMLDivElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const { focusRequest, candidatesRequest } = useAlerts();

  // 상단 바 높이를 CSS 변수로 알려 준다 (목록-상세 패널이 남은 창 높이를 채울 때 쓴다)
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--app-header-h', `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 768px 미만은 서랍 메뉴, 1280px 이하는 기본으로 아이콘 레일
  const mobile = useMediaQuery('(max-width: 767px)');
  const narrow = useMediaQuery('(max-width: 1280px)');
  const collapsed = !mobile && (narrow ? !narrowExpanded : pinnedCollapsed);

  const toggleCollapsed = () => {
    // 좁은 창에서 펼친 것은 잠깐만 유지하고, 넓은 창에서 고른 상태만 기억한다
    if (narrow) {
      setNarrowExpanded((v) => !v);
      return;
    }
    setPinnedCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // 저장소를 못 쓰면 이번 실행 동안만 유지
      }
      return next;
    });
  };

  useEffect(() => {
    if (!narrow) setNarrowExpanded(false);
  }, [narrow]);

  useEffect(() => {
    if (!mobile) setMobileOpen(false);
  }, [mobile]);

  // 알림을 눌러 특정 종목으로 이동하면 매매 신호 페이지로 전환
  useEffect(() => {
    if (focusRequest) navigate('signals');
  }, [focusRequest, navigate]);

  // 페이지를 바꾸면 맨 위에서 시작하고, 모바일 메뉴는 닫는다
  // 모바일 하단 탭은 묶음마다 마지막으로 본 페이지로 돌아간다
  const lastInGroup = useRef<Partial<Record<GroupId, RouteId>>>({});
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMobileOpen(false);
    lastInGroup.current[GROUP_OF[route]] = route;
  }, [route]);

  const openGroup = (g: GroupId) => {
    const first = NAV_GROUPS.find((x) => x.id === g)?.items[0]?.id;
    const target = lastInGroup.current[g] ?? first;
    if (target) navigate(target);
  };

  useEffect(() => {
    apiClient
      .GetUSDToKRW()
      .then((r) => setUsdKrw(r as number))
      .catch((err) => console.error('Failed to load USD/KRW:', err));
  }, []);

  const current = NAV_ITEMS_BY_ID[route];
  const currentGroup = NAV_GROUPS.find((g) => g.id === GROUP_OF[route]);

  return (
    <div className="relative min-h-screen app-bg text-zinc-100">
      <Sidebar
        route={route}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobile={mobile}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        usdKrw={usdKrw}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLock={appLock.supported() ? () => setLockOpen(true) : undefined}
      />

      <div className={`relative transition-[padding] duration-300 ${mobile ? '' : collapsed ? 'pl-16' : 'pl-52'}`}>
        {/* 상단 은은한 광원 */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 h-[420px]"
          style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgb(var(--c-white) / 0.06) 0%, transparent 70%)' }}
        />

        {/* 상단 바: 페이지 제목 + 페이지 도구(PageActions 포털) + 알림.
            모바일은 도구가 여러 줄로 늘어나므로 고정 바에는 제목만 두고 도구 줄은 아래로 내려 함께 스크롤되게 한다. */}
        <header ref={headerRef} className="app-header drag-region sticky top-0 z-20 border-b border-white/[0.07] backdrop-blur-xl">
          {/* 데스크톱에서 도구가 한 줄에 다 안 들어가면 오른쪽 묶음이 다음 줄로 내려간다 (높이는 --app-header-h 로 전달) */}
          <div className={`mx-auto flex min-h-14 max-w-screen-2xl items-center gap-x-3 px-4 py-2.5 sm:px-6 ${mobile ? 'mac-titlebar-pad' : 'flex-wrap gap-y-2'}`}>
            <h1 className={`flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white ${mobile ? 'min-w-0' : 'shrink-0 whitespace-nowrap'}`}>
              <current.icon className="h-7 w-7 shrink-0 text-zinc-200" />
              <span className={mobile ? 'truncate' : ''}>{current.title}</span>
            </h1>
            {!mobile && <div ref={setLeadSlot} className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden" />}
            <div className={`ml-auto flex items-center gap-2 ${mobile ? 'shrink-0' : 'flex-wrap justify-end'}`}>
              {!mobile && <div ref={setActionsSlot} className="flex flex-wrap items-center justify-end gap-2 empty:hidden" />}
              <AlertsBell />
            </div>
          </div>
        </header>
        {mobile && (
          <>
            {/* 모바일: 지금 묶음의 페이지를 알약으로 고른다 (묶음은 하단 탭) */}
            {currentGroup && currentGroup.items.length > 1 && (
              <div className="scrollbar-hide flex gap-1.5 overflow-x-auto px-4 pt-3" role="tablist" aria-label={`${currentGroup.label} 페이지`}>
                {currentGroup.items.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    role="tab"
                    aria-selected={i.id === route}
                    onClick={() => navigate(i.id)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      i.id === route ? 'border-mint-400/40 bg-mint-400/10 text-white' : 'border-white/10 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            )}
            <div className="relative flex flex-wrap items-center gap-x-2 px-4">
              <div ref={setLeadSlot} className="flex min-w-0 flex-wrap items-center gap-2 pt-4 empty:hidden" />
              <div ref={setActionsSlot} className="flex flex-wrap items-center gap-2 pt-4 empty:hidden" />
            </div>
          </>
        )}

        <PageSlotsProvider value={{ lead: leadSlot, actions: actionsSlot }}>
          <main key={route} className={`relative mx-auto max-w-screen-2xl px-4 py-5 sm:px-6 sm:py-6 animate-fade-up ${mobile ? 'pb-24' : ''}`}>
            {route === 'accounts' && <App />}
            {route === 'assets' && <AssetManager />}
            {route === 'trades' && <TransactionManager selectedAccountId={selectedAccountId} onAccountChange={setSelectedAccountId} />}
            {route === 'accumulate' && <AccumulationPage />}
            {route === 'pension' && <PensionPage />}
            {route === 'trend' && <AssetTrendPage />}
            {route === 'dividends' && <DividendManager selectedAccountId={selectedAccountId} onAccountChange={setSelectedAccountId} />}
            {route === 'dividend-analysis' && <DividendAnalysisPage />}
            {route === 'dividend-score' && <DividendScorePage />}
            {route === 'signals' && <SignalsDashboard focusAssetId={focusRequest?.assetId} focusNonce={focusRequest?.nonce} />}
            {route === 'profiles' && <ProfileManager />}
            {/* 알림에서 다른 종목으로 다시 열면 nonce 가 바뀌어 새로 그린다 */}
            {route === 'candidates' && <DividendCandidates key={candidatesRequest?.nonce ?? 0} highlightAssetId={candidatesRequest?.assetId} />}
          </main>
        </PageSlotsProvider>
      </div>

      {mobile && <MobileTabBar activeGroup={GROUP_OF[route]} onGroup={openGroup} onMore={() => setMobileOpen(true)} />}

      <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <LockSettings open={lockOpen} onClose={() => setLockOpen(false)} />
    </div>
  );
}
