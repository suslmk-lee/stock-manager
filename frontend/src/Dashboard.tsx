import { useState } from 'react';
import { Wallet, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';
import App from './App';
import AssetManager from './components/AssetManager';
import DividendManager from './components/DividendManager';
import DividendDashboard from './pages/DividendDashboard';

type TabType = 'accounts' | 'assets' | 'dividends' | 'stats';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('accounts');
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);

  const tabs = [
    { id: 'accounts' as TabType, label: '계좌 관리', icon: Wallet },
    { id: 'assets' as TabType, label: '주식/ETF', icon: TrendingUp },
    { id: 'dividends' as TabType, label: '배당금', icon: DollarSign },
    { id: 'stats' as TabType, label: '통계', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Wallet className="w-8 h-8 text-blue-400" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Stock Manager
              </h1>
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {activeTab === 'accounts' && <App />}
        {activeTab === 'assets' && <AssetManager />}
        {activeTab === 'dividends' && <DividendManager selectedAccountId={selectedAccountId} onAccountChange={setSelectedAccountId} />}
        {activeTab === 'stats' && <DividendDashboard />}
      </div>
    </div>
  );
}
