import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Asset, Account } from '../types/models';
import { TrendingUp, Wallet, Globe, Home, ChevronDown, ChevronUp } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const PALETTE = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4',
  '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#eab308',
];
const OTHER_COLOR = '#64748b';
const TOP_N = 5; // 기본 축소보기에서 노출할 계좌 수

interface AssetStatisticsProps {
  accountId?: number;
  marketType?: string;
}

interface AssetValue {
  ticker: string;
  name: string;
  quantity: number;
  currentPrice: number;
  value: number;
  accountId: number;
  accountName: string;
  marketType: string;
}

export default function AssetStatistics({ accountId, marketType = 'all' }: AssetStatisticsProps) {
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [accountValues, setAccountValues] = useState<Map<number, number>>(new Map());
  const [domesticValue, setDomesticValue] = useState(0);
  const [internationalValue, setInternationalValue] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadAssetValues();
  }, [accountId, marketType]);

  const loadAssetValues = async () => {
    try {
      setLoading(true);
      const [assetsData, accountsData, rate] = await Promise.all([
        apiClient.GetAllAssets(),
        apiClient.GetAllAccounts(),
        apiClient.GetUSDToKRW()
      ]);

      const assets = assetsData as Asset[];
      const accountsList = accountsData as Account[];
      setAccounts(accountsList);
      const exchangeRate = rate as number;

      const assetValues: AssetValue[] = [];

      // 보유가 있는 자산의 티커를 모아 일괄 시세 조회 (동시 5개 제한 + 5분 캐시)
      const assetsWithHoldings = assets.filter((a) => a.holdings && a.holdings.length > 0);
      const tickers = Array.from(new Set(assetsWithHoldings.map((a) => a.ticker).filter(Boolean)));
      const batchPrices = tickers.length > 0
        ? (await apiClient.GetCurrentPrices(tickers)) as Record<string, any>
        : {};

      const priceInKRWOf = (ticker: string) => {
        const pd = batchPrices[ticker.toUpperCase()] || batchPrices[ticker];
        const price = Number(pd?.price || 0);
        const currency = String(pd?.currency || '');
        return currency === 'USD' ? price * exchangeRate : price;
      };

      for (const asset of assetsWithHoldings) {
        const priceInKRW = priceInKRWOf(asset.ticker);

        for (const holding of asset.holdings!) {
          const account = accountsList.find(acc => acc.id === holding.account_id);
          if (!account) continue;

          // 필터 적용
          if (accountId && holding.account_id !== accountId) continue;
          if (marketType === 'domestic' && account.market_type !== 'Domestic') continue;
          if (marketType === 'international' && account.market_type !== 'International') continue;

          assetValues.push({
            ticker: asset.ticker,
            name: asset.name,
            quantity: holding.quantity,
            currentPrice: priceInKRW,
            value: priceInKRW * holding.quantity,
            accountId: holding.account_id,
            accountName: account.name,
            marketType: account.market_type,
          });
        }
      }

      // 총 자산 계산
      const total = assetValues.reduce((sum, av) => sum + av.value, 0);
      setTotalValue(total);

      // 계좌별 자산 계산
      const accountValuesMap = new Map<number, number>();
      assetValues.forEach(av => {
        const current = accountValuesMap.get(av.accountId) || 0;
        accountValuesMap.set(av.accountId, current + av.value);
      });
      setAccountValues(accountValuesMap);

      // 국내/해외별 자산 계산
      const domestic = assetValues
        .filter(av => av.marketType === 'Domestic')
        .reduce((sum, av) => sum + av.value, 0);
      const international = assetValues
        .filter(av => av.marketType === 'International')
        .reduce((sum, av) => sum + av.value, 0);
      
      setDomesticValue(domestic);
      setInternationalValue(international);

    } catch (err) {
      console.error('Failed to load asset values:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* 총 자산 스켈레톤 */}
        <div className="bg-slate-800/60 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-slate-700" />
            <div className="space-y-2">
              <div className="h-3 w-24 rounded bg-slate-700" />
              <div className="h-7 w-48 rounded bg-slate-700" />
            </div>
          </div>
        </div>

        {/* 계좌별 분포 스켈레톤 */}
        <div className="bg-slate-800/60 rounded-xl p-6 border border-slate-700">
          <div className="h-4 w-40 rounded bg-slate-700 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex items-center justify-center h-72">
              <div className="w-44 h-44 rounded-full border-[16px] border-slate-700" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: TOP_N }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 bg-slate-700/40 rounded-lg p-4">
                  <div className="w-4 h-4 rounded-full bg-slate-600" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-28 rounded bg-slate-600" />
                    <div className="h-2.5 w-16 rounded bg-slate-600" />
                  </div>
                  <div className="space-y-2 text-right">
                    <div className="h-3 w-20 rounded bg-slate-600 ml-auto" />
                    <div className="h-2.5 w-10 rounded bg-slate-600 ml-auto" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 계좌별 자산을 금액 내림차순으로 정렬
  const sortedEntries = Array.from(accountValues.entries())
    .map(([accId, value]) => ({ accId, value }))
    .sort((a, b) => b.value - a.value);

  // 기본 축소보기: 상위 N개 + "기타" 묶음 (펼치면 전체)
  const canCollapse = sortedEntries.length > TOP_N + 1;
  const collapsed = !expanded && canCollapse;
  const topEntries = collapsed ? sortedEntries.slice(0, TOP_N) : sortedEntries;
  const restEntries = collapsed ? sortedEntries.slice(TOP_N) : [];
  const restValue = restEntries.reduce((sum, e) => sum + e.value, 0);

  // 파이/리스트 공통 데이터
  const pieData = [
    ...topEntries.map((e, i) => {
      const account = accounts.find((acc) => acc.id === e.accId);
      return {
        name: account?.name || '알 수 없음',
        value: e.value,
        color: PALETTE[i % PALETTE.length],
      };
    }),
    ...(restEntries.length > 0
      ? [{ name: `기타 ${restEntries.length}개`, value: restValue, color: OTHER_COLOR }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* 총 자산 */}
      <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-6 border border-green-500/30">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <p className="text-sm text-slate-400">총 자산 평가액</p>
            <p className="text-3xl font-bold text-white">{formatCurrency(totalValue)}</p>
          </div>
        </div>
      </div>

      {/* 계좌별 자산 */}
      {!accountId && accountValues.size > 0 && (
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold text-white">계좌별 자산 분포</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 파이 차트 (라벨/범례 제거 → 우측 리스트로 대체, 높이 축소) */}
            <div className="relative h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={1}
                    dataKey="value"
                  >
                    {pieData.map((d, index) => (
                      <Cell key={`cell-${index}`} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${formatCurrency(value)} (${totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : 0}%)`,
                      name,
                    ]}
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '8px',
                      color: '#fff',
                    }}
                    itemStyle={{ color: '#e2e8f0' }}
                    labelStyle={{ color: '#e2e8f0' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* 도넛 중앙: 총 자산 / 계좌 수 */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-[11px] text-slate-400">총 자산</p>
                <p className="text-base font-bold text-white">{formatCurrency(totalValue)}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{sortedEntries.length}개 계좌</p>
              </div>
            </div>

            {/* 상세 정보 (축소보기: 상위 N + 기타) */}
            <div className="space-y-2">
              {topEntries.map((e, index) => {
                const account = accounts.find(acc => acc.id === e.accId);
                if (!account) return null;
                const percentage = totalValue > 0 ? (e.value / totalValue) * 100 : 0;
                return (
                  <div key={e.accId} className="bg-slate-700/50 rounded-lg p-3 flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{account.name}</p>
                      <p className="text-xs text-slate-400 truncate">{account.broker}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-white">{formatCurrency(e.value)}</p>
                      <p className="text-xs text-slate-400">{percentage.toFixed(1)}%</p>
                    </div>
                  </div>
                );
              })}

              {restEntries.length > 0 && (
                <div className="bg-slate-700/30 rounded-lg p-3 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: OTHER_COLOR }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-300">기타 {restEntries.length}개 계좌</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-200">{formatCurrency(restValue)}</p>
                    <p className="text-xs text-slate-400">
                      {totalValue > 0 ? ((restValue / totalValue) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                </div>
              )}

              {canCollapse && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-700/30 hover:bg-slate-700/60 rounded-lg transition-colors"
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="w-4 h-4" /> 접기
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" /> 전체 {sortedEntries.length}개 계좌 보기
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 국내/해외별 자산 */}
      {marketType === 'all' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-slate-700">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <Home className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-slate-400">국내 자산</p>
                <p className="text-xl font-bold text-white">{formatCurrency(domesticValue)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-700 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: totalValue > 0 ? `${(domesticValue / totalValue) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-xs text-slate-400">
                {totalValue > 0 ? ((domesticValue / totalValue) * 100).toFixed(1) : 0}%
              </span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-slate-700">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                <Globe className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-slate-400">해외 자산</p>
                <p className="text-xl font-bold text-white">{formatCurrency(internationalValue)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-700 rounded-full h-2">
                <div 
                  className="bg-purple-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: totalValue > 0 ? `${(internationalValue / totalValue) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-xs text-slate-400">
                {totalValue > 0 ? ((internationalValue / totalValue) * 100).toFixed(1) : 0}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
