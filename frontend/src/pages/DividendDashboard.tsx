import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account } from '../types/models';
import DividendChart from '../components/DividendChart';
import DividendStatistics from '../components/DividendStatistics';
import AssetStatistics from '../components/AssetStatistics';
import { DollarSign, Filter } from 'lucide-react';

export default function DividendDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState(12);
  const [selectedAccount, setSelectedAccount] = useState<number>(0);
  const [selectedMarket, setSelectedMarket] = useState<string>('all');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const data = await apiClient.GetAllAccounts();
      setAccounts(data as Account[]);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  };

  const filteredAccounts = selectedMarket === 'all' 
    ? accounts 
    : accounts.filter(acc => 
        selectedMarket === 'domestic' 
          ? acc.market_type === 'Domestic' 
          : acc.market_type === 'International'
      );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <DollarSign className="w-8 h-8 sm:w-10 sm:h-10 text-green-400" />
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            배당금 대시보드
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-colors text-sm sm:text-base ${
              showFilters ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            <Filter className="w-4 h-4" />
            필터
          </button>
          {[6, 12, 24, 36].map((months) => (
            <button
              key={months}
              onClick={() => setSelectedPeriod(months)}
              className={`px-3 sm:px-4 py-2 rounded-lg transition-colors text-sm sm:text-base ${
                selectedPeriod === months
                  ? 'bg-green-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {months}개월
            </button>
          ))}
        </div>
      </div>

      {showFilters && (
        <div className="bg-slate-800 rounded-xl p-6 mb-6 border border-slate-700">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">계좌</label>
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(Number(e.target.value))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value={0}>전체 계좌</option>
                {filteredAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.broker})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">시장 구분</label>
              <select
                value={selectedMarket}
                onChange={(e) => {
                  setSelectedMarket(e.target.value);
                  setSelectedAccount(0);
                }}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="all">전체</option>
                <option value="domestic">국내</option>
                <option value="international">해외</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <AssetStatistics 
        accountId={selectedAccount || undefined}
        marketType={selectedMarket}
      />

      <div className="mt-6">
        <DividendStatistics 
          accountId={selectedAccount} 
          marketType={selectedMarket}
          months={selectedPeriod}
        />
      </div>

      <div className="mt-6">
        <DividendChart 
          accountId={selectedAccount || undefined} 
          months={selectedPeriod} 
        />
      </div>
    </div>
  );
}
