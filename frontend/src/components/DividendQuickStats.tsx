import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Dividend } from '../types/models';
import { DollarSign, TrendingUp, Calendar, PieChart } from 'lucide-react';

interface DividendQuickStatsProps {
  accountId: number;
}

interface MonthlyStats {
  month: string;
  total: number;
  count: number;
}

interface AssetDividendStats {
  assetName: string;
  ticker: string;
  total: number;
  count: number;
}

export default function DividendQuickStats({ accountId }: DividendQuickStatsProps) {
  const [loading, setLoading] = useState(true);
  const [totalDividend, setTotalDividend] = useState(0);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats[]>([]);
  const [yearlyTotal, setYearlyTotal] = useState(0);
  const [topAssets, setTopAssets] = useState<AssetDividendStats[]>([]);

  useEffect(() => {
    if (accountId > 0) {
      loadStats();
    }
  }, [accountId]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const [dividendsData, rate] = await Promise.all([
        apiClient.GetDividendsByAccount(accountId),
        apiClient.GetUSDToKRW(),
      ]);

      const dividends = dividendsData as Dividend[];
      const exchangeRateValue = rate as number;

      // 총 배당금 계산
      const total = dividends.reduce((sum, div) => {
        const amountInKRW = div.currency === 'USD' 
          ? div.amount * exchangeRateValue 
          : div.amount;
        return sum + amountInKRW;
      }, 0);
      setTotalDividend(total);

      // 월별 통계 계산 (최근 6개월)
      const monthlyMap = new Map<string, { total: number; count: number }>();
      const now = new Date();
      
      dividends.forEach(div => {
        const divDate = new Date(div.date);
        const monthKey = `${divDate.getFullYear()}-${String(divDate.getMonth() + 1).padStart(2, '0')}`;
        const amountInKRW = div.currency === 'USD' 
          ? div.amount * exchangeRateValue 
          : div.amount;
        
        const existing = monthlyMap.get(monthKey) || { total: 0, count: 0 };
        monthlyMap.set(monthKey, {
          total: existing.total + amountInKRW,
          count: existing.count + 1,
        });
      });

      // 최근 6개월 데이터 정렬
      const sortedMonthly = Array.from(monthlyMap.entries())
        .map(([month, data]) => ({
          month,
          total: data.total,
          count: data.count,
        }))
        .sort((a, b) => b.month.localeCompare(a.month))
        .slice(0, 6);
      
      setMonthlyStats(sortedMonthly);

      // 올해 배당금 계산
      const currentYear = now.getFullYear();
      const yearlyTotal = dividends
        .filter(div => new Date(div.date).getFullYear() === currentYear)
        .reduce((sum, div) => {
          const amountInKRW = div.currency === 'USD' 
            ? div.amount * exchangeRateValue 
            : div.amount;
          return sum + amountInKRW;
        }, 0);
      setYearlyTotal(yearlyTotal);

      // 자산별 배당금 Top10 계산
      const assetMap = new Map<number, { name: string; ticker: string; total: number; count: number }>();
      
      dividends.forEach(div => {
        if (div.asset) {
          const amountInKRW = div.currency === 'USD' 
            ? div.amount * exchangeRateValue 
            : div.amount;
          
          const existing = assetMap.get(div.asset_id) || { 
            name: div.asset.name, 
            ticker: div.asset.ticker, 
            total: 0, 
            count: 0 
          };
          assetMap.set(div.asset_id, {
            name: div.asset.name,
            ticker: div.asset.ticker,
            total: existing.total + amountInKRW,
            count: existing.count + 1,
          });
        }
      });

      // Top10 정렬
      const sortedAssets = Array.from(assetMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map(asset => ({
          assetName: asset.name,
          ticker: asset.ticker,
          total: asset.total,
          count: asset.count,
        }));
      
      setTopAssets(sortedAssets);

    } catch (err) {
      console.error('Failed to load dividend stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  };

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    return `${year}년 ${month}월`;
  };

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="text-center py-8 text-slate-400">통계 로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 주요 통계 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* 총 배당금 */}
        <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-4 sm:p-6 border border-green-500/30">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
              <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
            </div>
            <p className="text-xs sm:text-sm text-slate-400">총 배당금</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(totalDividend)}</p>
        </div>

        {/* 올해 배당금 */}
        <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-xl p-4 sm:p-6 border border-blue-500/30">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
              <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            </div>
            <p className="text-xs sm:text-sm text-slate-400">{new Date().getFullYear()}년 배당금</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-white">{formatCurrency(yearlyTotal)}</p>
        </div>

        {/* 평균 배당금 */}
        <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-4 sm:p-6 border border-purple-500/30">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
            </div>
            <p className="text-xs sm:text-sm text-slate-400">월평균 배당금</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-white">
            {formatCurrency(monthlyStats.length > 0 ? yearlyTotal / (new Date().getMonth() + 1) : 0)}
          </p>
        </div>
      </div>

      {/* 월별 배당금 통계 */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center gap-2 mb-4">
          <PieChart className="w-5 h-5 text-green-400" />
          <h3 className="text-lg font-semibold text-white">월별 배당금 (최근 6개월)</h3>
        </div>
        {monthlyStats.length === 0 ? (
          <p className="text-center py-8 text-slate-400">배당금 기록이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {monthlyStats.map((stat) => (
              <div key={stat.month} className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <p className="text-sm font-medium text-white">{formatMonth(stat.month)}</p>
                    <p className="text-xs text-slate-400">{stat.count}건</p>
                  </div>
                  <p className="text-lg font-bold text-green-400">{formatCurrency(stat.total)}</p>
                </div>
                <div className="w-full bg-slate-600 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all duration-500"
                    style={{ 
                      width: `${totalDividend > 0 ? (stat.total / totalDividend) * 100 : 0}%` 
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 배당금 Top10 & 분포 차트 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 배당금 Top10 */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-yellow-400" />
            <h3 className="text-lg font-semibold text-white">배당금 Top 10</h3>
          </div>
          {topAssets.length === 0 ? (
            <p className="text-center py-8 text-slate-400">배당금 기록이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {topAssets.map((asset, index) => (
                <div key={asset.ticker} className="bg-slate-700/50 rounded-lg p-4 hover:bg-slate-700 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                        index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                        index === 1 ? 'bg-slate-400/20 text-slate-300' :
                        index === 2 ? 'bg-orange-500/20 text-orange-400' :
                        'bg-slate-600/50 text-slate-400'
                      }`}>
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-white">
                          {asset.ticker.includes('.KS') || asset.ticker.includes('.KQ') 
                            ? asset.assetName 
                            : asset.ticker}
                        </p>
                        <p className="text-xs text-slate-400">
                          {asset.ticker.includes('.KS') || asset.ticker.includes('.KQ')
                            ? `${asset.ticker} · ${asset.count}건`
                            : `${asset.assetName} · ${asset.count}건`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-green-400">{formatCurrency(asset.total)}</p>
                      <p className="text-xs text-slate-400">
                        {totalDividend > 0 ? `${((asset.total / totalDividend) * 100).toFixed(1)}%` : '0%'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 배당금 분포 원그래프 */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold text-white">배당금 분포</h3>
          </div>
          {topAssets.length === 0 ? (
            <p className="text-center py-8 text-slate-400">배당금 기록이 없습니다.</p>
          ) : (
            <div className="space-y-4">
              {/* SVG 원그래프 */}
              <div className="flex items-center justify-center">
                <svg viewBox="0 0 200 200" className="w-64 h-64">
                  {(() => {
                    const colors = [
                      '#eab308', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
                      '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
                    ];
                    let currentAngle = -90;
                    
                    return topAssets.map((asset, index) => {
                      const percentage = (asset.total / totalDividend) * 100;
                      const angle = (percentage / 100) * 360;
                      const startAngle = currentAngle;
                      const endAngle = currentAngle + angle;
                      
                      const startRad = (startAngle * Math.PI) / 180;
                      const endRad = (endAngle * Math.PI) / 180;
                      
                      const x1 = 100 + 80 * Math.cos(startRad);
                      const y1 = 100 + 80 * Math.sin(startRad);
                      const x2 = 100 + 80 * Math.cos(endRad);
                      const y2 = 100 + 80 * Math.sin(endRad);
                      
                      const largeArc = angle > 180 ? 1 : 0;
                      
                      const path = `M 100 100 L ${x1} ${y1} A 80 80 0 ${largeArc} 1 ${x2} ${y2} Z`;
                      
                      currentAngle = endAngle;
                      
                      return (
                        <path
                          key={asset.ticker}
                          d={path}
                          fill={colors[index % colors.length]}
                          opacity="0.8"
                          className="hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <title>{`${asset.ticker.includes('.KS') || asset.ticker.includes('.KQ') ? asset.assetName : asset.ticker}: ${percentage.toFixed(1)}%`}</title>
                        </path>
                      );
                    });
                  })()}
                </svg>
              </div>
              
              {/* 범례 */}
              <div className="grid grid-cols-2 gap-2">
                {topAssets.map((asset, index) => {
                  const colors = [
                    '#eab308', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
                    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
                  ];
                  const percentage = (asset.total / totalDividend) * 100;
                  
                  return (
                    <div key={asset.ticker} className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: colors[index % colors.length] }}
                      />
                      <span className="text-xs text-slate-300 truncate">
                        {asset.ticker.includes('.KS') || asset.ticker.includes('.KQ') 
                          ? asset.assetName 
                          : asset.ticker} ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
