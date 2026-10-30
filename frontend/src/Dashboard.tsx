import { useEffect, useState } from 'react';
import { Wallet, TrendingUp, DollarSign, BarChart3, Calendar, Camera, ArrowLeftRight, LineChart, Settings2, Radar } from 'lucide-react';
import AppearanceSettings from './components/settings/AppearanceSettings';
import App from './App';
import AssetManager from './components/AssetManager';
import DividendManager from './components/DividendManager';
import DividendDashboard from './pages/DividendDashboard';
import SignalsDashboard from './pages/SignalsDashboard';
import DividendYearlyOverview from './components/DividendYearlyOverview';
import PortfolioSnapshots from './components/PortfolioSnapshots';
import TransactionManager from './components/TransactionManager';
import IconTile from './components/ui/IconTile';
import AlertsBell from './components/alerts/AlertsBell';
import { useAlerts } from './components/alerts/AlertsProvider';
import { apiClient } from './api/client';

type TabType = 'accounts' | 'assets' | 'trades' | 'dividends' | 'stats' | 'signals' | 'yearly' | 'portfolio';

const tabs = [
  { id: 'accounts' as TabType, label: '계좌 관리', icon: Wallet },
  { id: 'assets' as TabType, label: '주식/ETF', icon: TrendingUp },
  { id: 'trades' as TabType, label: '매매', icon: ArrowLeftRight },
  { id: 'dividends' as TabType, label: '배당금', icon: DollarSign },
  { id: 'stats' as TabType, label: '통계', icon: BarChart3 },
  { id: 'signals' as TabType, label: '매매 신호', icon: Radar, isNew: true },
  { id: 'yearly' as TabType, label: '연간 현황', icon: Calendar },
  { id: 'portfolio' as TabType, label: '포트폴리오', icon: Camera },
];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('accounts');
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);
  const [usdKrw, setUsdKrw] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { focusRequest } = useAlerts();

  // 알림을 눌러 특정 종목으로 이동하면 매매 신호 탭으로 전환
  useEffect(() => {
    if (focusRequest) setActiveTab('signals');
  }, [focusRequest]);

  useEffect(() => {
    apiClient
      .GetUSDToKRW()
      .then((r) => setUsdKrw(r as number))
      .catch((err) => console.error('Failed to load USD/KRW:', err));
  }, []);

  return (
    <div className="relative min-h-screen app-bg text-zinc-100">
      {/* 상단 은은한 광원 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[420px]"
        style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgb(var(--c-white) / 0.06) 0%, transparent 70%)' }}
      />

      <header className="app-header sticky top-0 z-20 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-3">
          {/* 상단 바: 브랜드 pill · 환율 pill */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="glass-pill flex items-center gap-2.5 pl-1.5 pr-1.5 min-[440px]:pr-4 py-1.5">
              <IconTile icon={LineChart} tone="mint" size="sm" />
              <span className="hidden min-[440px]:inline text-[15px] font-semibold tracking-tight whitespace-nowrap">Stock Manager</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="glass-pill flex items-center gap-2 px-3.5 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-mint-400 shadow-[0_0_8px_rgb(var(--c-mint-400)/0.8)]" />
                <span className="label-mono !text-zinc-400">USD/KRW</span>
                <span className="num text-sm font-medium text-white">
                  {usdKrw ? usdKrw.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—'}
                </span>
              </div>
              <AlertsBell />
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title="모양 설정"
                aria-label="모양 설정"
                className="glass-pill flex h-9 w-9 items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 탭 카드 */}
          <nav className="flex gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-hide">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`tab-card ${active ? 'tab-card-active' : ''}`}
                >
                  <div className="flex w-full items-start justify-between">
                    <IconTile icon={tab.icon} size="sm" tone={active ? 'mint' : 'warm'} />
                    {tab.isNew && <span className="badge-new">New</span>}
                  </div>
                  <span className={`text-sm font-medium leading-tight ${active ? 'text-white' : 'text-zinc-400'}`}>
                    {tab.label}
                  </span>
                  {/* 진행 표시줄 형태의 활성 밑줄 */}
                  <span className="absolute inset-x-3.5 bottom-2 h-[2px] rounded-full bg-white/[0.06] overflow-hidden">
                    {active && (
                      <span
                        className="block h-full w-1/2 rounded-full bg-white/80 origin-left"
                        style={{ animation: 'tabProgress 0.6s cubic-bezier(0.22, 1, 0.36, 1) both' }}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      </header>

      <main key={activeTab} className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-fade-up">
        {activeTab === 'accounts' && <App />}
        {activeTab === 'assets' && <AssetManager />}
        {activeTab === 'trades' && <TransactionManager selectedAccountId={selectedAccountId} onAccountChange={setSelectedAccountId} />}
        {activeTab === 'dividends' && <DividendManager selectedAccountId={selectedAccountId} onAccountChange={setSelectedAccountId} />}
        {activeTab === 'stats' && <DividendDashboard />}
        {activeTab === 'signals' && <SignalsDashboard focusAssetId={focusRequest?.assetId} focusNonce={focusRequest?.nonce} />}
        {activeTab === 'yearly' && <DividendYearlyOverview />}
        {activeTab === 'portfolio' && <PortfolioSnapshots />}
      </main>

      <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
