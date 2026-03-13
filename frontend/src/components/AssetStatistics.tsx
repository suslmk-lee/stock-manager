import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Asset, Account } from '../types/models';
import { TrendingUp, Wallet, Globe, Home } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

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
      
      for (const asset of assets) {
        if (!asset.holdings || asset.holdings.length === 0) continue;

        try {
          const priceData = await apiClient.GetCurrentPrice(asset.ticker);
          const price = priceData as any;
          
          const priceInKRW = price.currency === 'USD' 
            ? price.price * exchangeRate
            : price.price;

          for (const holding of asset.holdings) {
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
        } catch (err) {
          console.error(`Failed to get price for ${asset.ticker}:`, err);
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
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="text-center py-8 text-slate-400">자산 평가 로딩 중...</div>
      </div>
    );
  }

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
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold text-white">계좌별 자산 분포</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 파이 차트 */}
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={Array.from(accountValues.entries()).map(([accId, value]) => {
                      const account = accounts.find(acc => acc.id === accId);
                      return {
                        name: account?.name || '알 수 없음',
                        value: value,
                        percentage: totalValue > 0 ? (value / totalValue) * 100 : 0,
                      };
                    })}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percentage }) => `${name} (${percentage.toFixed(1)}%)`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {Array.from(accountValues.entries()).map((_, index) => {
                      const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4'];
                      return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                    })}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ 
                      backgroundColor: '#1e293b', 
                      border: '1px solid #475569',
                      borderRadius: '8px',
                      color: '#fff'
                    }}
                  />
                  <Legend 
                    verticalAlign="bottom" 
                    height={36}
                    formatter={(value) => <span style={{ color: '#cbd5e1' }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            {/* 상세 정보 */}
            <div className="space-y-3">
              {Array.from(accountValues.entries()).map(([accId, value], index) => {
                const account = accounts.find(acc => acc.id === accId);
                if (!account) return null;
                const percentage = totalValue > 0 ? (value / totalValue) * 100 : 0;
                const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4'];
                
                return (
                  <div key={accId} className="bg-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div 
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: colors[index % colors.length] }}
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-white">{account.name}</p>
                        <p className="text-xs text-slate-400">{account.broker}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-white">{formatCurrency(value)}</p>
                        <p className="text-xs text-slate-400">{percentage.toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 국내/해외별 자산 */}
      {marketType === 'all' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
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

          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
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
