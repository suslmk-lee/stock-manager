import { useState, useEffect } from 'react';
import { PageActions } from '../components/shell/PageSlots';
import { apiClient } from '../api/client';
import { Account } from '../types/models';
import DividendChart from '../components/DividendChart';
import DividendStatistics from '../components/DividendStatistics';
import AssetStatistics from '../components/AssetStatistics';
import MonthlyAssetTrend from '../components/MonthlyAssetTrend';
import TotalReturnByAsset from '../components/TotalReturnByAsset';
import AssetDetailView from '../components/AssetDetailView';
import { Filter } from 'lucide-react';
import { LiquidityFilter, matchesLiquidity } from '../utils/accountType';

const LIQUIDITY_OPTIONS: { value: LiquidityFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'liquid', label: '인출 가능' },
  { value: 'restricted', label: '인출 제한' },
];

export default function DividendDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState(12);
  const [selectedAccount, setSelectedAccount] = useState<number>(0);
  const [selectedMarket, setSelectedMarket] = useState<string>('all');
  const [selectedLiquidity, setSelectedLiquidity] = useState<LiquidityFilter>('all');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [detailAsset, setDetailAsset] = useState<{ assetId: number; ticker: string; name: string } | null>(null);

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

  const changeLiquidity = (value: LiquidityFilter) => {
    setSelectedLiquidity(value);
    setSelectedAccount(0);
  };

  const filteredAccounts = accounts.filter(acc =>
    matchesLiquidity(acc, selectedLiquidity) &&
    (selectedMarket === 'all' ||
      (selectedMarket === 'domestic'
        ? acc.market_type === 'Domestic'
        : acc.market_type === 'International'))
  );

  return (
    <div>
      <PageActions lead={<span className="label-mono hidden sm:inline">자산 · 수익 · 배당 현황</span>}>
          <div className="glass-pill flex p-1" role="group" aria-label="계좌 유형">
            {LIQUIDITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => changeLiquidity(opt.value)}
                className={`pill-item ${
                  selectedLiquidity === opt.value
                    ? opt.value === 'restricted' ? 'pill-item-active !text-amber-300' : 'pill-item-active !text-mint-300'
                    : ''
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="glass-pill flex p-1" role="group" aria-label="기간">
            {[6, 12, 24, 36].map((months) => (
              <button
                key={months}
                onClick={() => setSelectedPeriod(months)}
                className={`pill-item font-mono !text-xs ${selectedPeriod === months ? 'pill-item-active' : ''}`}
              >
                {months}개월
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn-ghost ${showFilters ? '!border-mint-400/50 !text-mint-300' : ''}`}
          >
            <Filter className="w-4 h-4" />
            필터
          </button>
      </PageActions>

      {showFilters && (
        <div className="surface p-5 sm:p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="field-label">계좌</label>
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(Number(e.target.value))}
                className="input-field"
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
              <label className="field-label">시장 구분</label>
              <select
                value={selectedMarket}
                onChange={(e) => {
                  setSelectedMarket(e.target.value);
                  setSelectedAccount(0);
                }}
                className="input-field"
              >
                <option value="all">전체</option>
                <option value="domestic">국내</option>
                <option value="international">해외</option>
              </select>
            </div>
            <div>
              <label className="field-label">계좌 유형</label>
              <select
                value={selectedLiquidity}
                onChange={(e) => changeLiquidity(e.target.value as LiquidityFilter)}
                className="input-field"
              >
                {LIQUIDITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <AssetStatistics
        accountId={selectedAccount || undefined}
        marketType={selectedMarket}
        liquidity={selectedLiquidity}
      />

      <div className="mt-6">
        <MonthlyAssetTrend
          accountId={selectedAccount || undefined}
          marketType={selectedMarket}
          liquidity={selectedLiquidity}
          months={selectedPeriod}
        />
      </div>

      <div className="mt-6">
        <TotalReturnByAsset
          accountId={selectedAccount || undefined}
          marketType={selectedMarket}
          liquidity={selectedLiquidity}
          onSelectAsset={setDetailAsset}
        />
      </div>

      {detailAsset && (
        <AssetDetailView
          assetId={detailAsset.assetId}
          ticker={detailAsset.ticker}
          name={detailAsset.name}
          accountId={selectedAccount || undefined}
          accountName={accounts.find((a) => a.id === selectedAccount)?.name}
          onClose={() => setDetailAsset(null)}
        />
      )}

      <div className="mt-6">
        <DividendStatistics
          accountId={selectedAccount}
          marketType={selectedMarket}
          liquidity={selectedLiquidity}
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
