import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import AppearanceSettings from './components/settings/AppearanceSettings';
import App from './App';
import AssetManager from './components/AssetManager';
import DividendManager from './components/DividendManager';
import DividendDashboard from './pages/DividendDashboard';
import SignalsDashboard from './pages/SignalsDashboard';
import DividendYearlyOverview from './components/DividendYearlyOverview';
import PortfolioSnapshots from './components/PortfolioSnapshots';
import TransactionManager from './components/TransactionManager';
import AlertsBell from './components/alerts/AlertsBell';
import Sidebar from './components/shell/Sidebar';
import { PageSlotsProvider } from './components/shell/PageSlots';
import { useAlerts } from './components/alerts/AlertsProvider';
import { apiClient } from './api/client';
import { NAV_ITEMS_BY_ID, useHashRoute } from './navigation';
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
  const [pinnedCollapsed, setPinnedCollapsed] = useState(loadCollapsed);
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [leadSlot, setLeadSlot] = useState<HTMLDivElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const { focusRequest } = useAlerts();

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
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMobileOpen(false);
  }, [route]);

  useEffect(() => {
    apiClient
      .GetUSDToKRW()
      .then((r) => setUsdKrw(r as number))
      .catch((err) => console.error('Failed to load USD/KRW:', err));
  }, []);

  const current = NAV_ITEMS_BY_ID[route];

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
        <header className="app-header sticky top-0 z-20 border-b border-white/[0.07] backdrop-blur-xl">
          <div className="mx-auto flex min-h-14 max-w-screen-2xl items-center gap-x-3 px-4 py-2.5 sm:px-6">
            {mobile && (
              <button type="button" className="btn-icon !h-9 !w-9 shrink-0" onClick={() => setMobileOpen(true)} aria-label="메뉴 열기">
                <Menu className="h-4 w-4" />
              </button>
            )}
            <h1 className="truncate text-lg font-semibold tracking-tight text-white">{current.title}</h1>
            {!mobile && <div ref={setLeadSlot} className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden" />}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {!mobile && <div ref={setActionsSlot} className="flex flex-wrap items-center justify-end gap-2 empty:hidden" />}
              <AlertsBell />
            </div>
          </div>
        </header>
        {mobile && (
          <div className="relative flex flex-wrap items-center gap-x-2 px-4">
            <div ref={setLeadSlot} className="flex min-w-0 flex-wrap items-center gap-2 pt-4 empty:hidden" />
            <div ref={setActionsSlot} className="flex flex-wrap items-center gap-2 pt-4 empty:hidden" />
          </div>
        )}

        <PageSlotsProvider value={{ lead: leadSlot, actions: actionsSlot }}>
          <main key={route} className="relative mx-auto max-w-screen-2xl px-4 py-5 sm:px-6 sm:py-6 animate-fade-up">
            {route === 'accounts' && <App />}
            {route === 'assets' && <AssetManager />}
            {route === 'trades' && <TransactionManager selectedAccountId={selectedAccountId} onAccountChange={setSelectedAccountId} />}
            {route === 'dividends' && <DividendManager selectedAccountId={selectedAccountId} onAccountChange={setSelectedAccountId} />}
            {route === 'stats' && <DividendDashboard />}
            {route === 'signals' && <SignalsDashboard focusAssetId={focusRequest?.assetId} focusNonce={focusRequest?.nonce} />}
            {route === 'yearly' && <DividendYearlyOverview />}
            {route === 'portfolio' && <PortfolioSnapshots />}
          </main>
        </PageSlotsProvider>
      </div>

      <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
