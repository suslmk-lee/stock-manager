import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account, Dividend, Holding, Transaction } from '../types/models';
import { DollarSign, TrendingUp, Calendar, PieChart, Percent } from 'lucide-react';

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
  const [expectedAnnualDividend, setExpectedAnnualDividend] = useState(0);
  const [totalInvestment, setTotalInvestment] = useState(0);
  const [annualYield, setAnnualYield] = useState(0);
  const [expectedAnnualYield, setExpectedAnnualYield] = useState(0);
  const [investmentBasisLabel, setInvestmentBasisLabel] = useState('보유원가');
  const [topAssets, setTopAssets] = useState<AssetDividendStats[]>([]);

  useEffect(() => {
    if (accountId > 0) {
      loadStats();
    }
  }, [accountId]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const [dividendsData, rate, holdingsData, accountData, transactionsData] = await Promise.all([
        apiClient.GetDividendsByAccount(accountId),
        apiClient.GetUSDToKRW(),
        apiClient.GetHoldingsByAccount(accountId),
        apiClient.GetAccount(accountId),
        apiClient.GetTransactionsByAccount(accountId),
      ]);

      const dividends = dividendsData as Dividend[];
      const exchangeRateValue = rate as number;
      const holdings = holdingsData as Holding[];
      const account = accountData as Account;
      const transactions = transactionsData as Transaction[];

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

      // 예상 연배당금(현재까지 실적을 일할 연환산)
      const startOfYear = new Date(currentYear, 0, 1);
      const elapsedDays = Math.max(
        1,
        Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1
      );
      const daysInYear = new Date(currentYear, 11, 31).getDate() === 31
        ? (new Date(currentYear, 1, 29).getMonth() === 1 ? 366 : 365)
        : 365;
      const annualizedDividend = yearlyTotal > 0 ? (yearlyTotal / elapsedDays) * daysInYear : 0;
      setExpectedAnnualDividend(annualizedDividend);

      // 총 투자금 계산 (해당 계좌 보유수량 * 평단 합계)
      const rawInvestmentTotal = holdings.reduce((sum, holding: any) => {
        if (typeof holding.total_cost === 'number') {
          return sum + holding.total_cost;
        }
        return sum + ((holding.quantity || 0) * (holding.average_price || 0));
      }, 0);

      // 계좌 통화가 USD면 KRW로 환산해 배당금과 동일 기준으로 계산
      const investmentInKRW = account.currency === 'USD'
        ? rawInvestmentTotal * exchangeRateValue
        : rawInvestmentTotal;

      // 보유원가가 0일 경우 누적 매수금(거래내역 기준)으로 대체
      const buyInvestmentRaw = transactions
        .filter(tx => tx.type === 'Buy')
        .reduce((sum, tx) => sum + (tx.price * tx.quantity) + (tx.fee || 0), 0);

      const buyInvestmentInKRW = account.currency === 'USD'
        ? buyInvestmentRaw * exchangeRateValue
        : buyInvestmentRaw;

      // 보유원가/누적매수가 모두 비어있을 때를 대비해 평가금액도 계산
      const tickers = Array.from(
        new Set(
          holdings
            .filter(h => (h.quantity || 0) > 0 && h.asset?.ticker)
            .map(h => h.asset!.ticker)
        )
      );

      const priceEntries = await Promise.all(
        tickers.map(async (ticker) => {
          try {
            const priceData = await apiClient.GetCurrentPrice(ticker);
            const price = priceData as any;
            const rawPrice = Number(price?.price || 0);
            const currency = String(price?.currency || '');
            const priceInKRW = currency === 'USD' ? rawPrice * exchangeRateValue : rawPrice;
            return [ticker, priceInKRW] as const;
          } catch {
            return [ticker, 0] as const;
          }
        })
      );
      const priceMap = new Map<string, number>(priceEntries);

      const marketValueInKRW = holdings.reduce((sum, h) => {
        const qty = h.quantity || 0;
        const ticker = h.asset?.ticker;
        if (!ticker || qty <= 0) return sum;
        const price = priceMap.get(ticker) || 0;
        return sum + (qty * price);
      }, 0);

      // 기본 분모는 총평가금액(주식/ETF 화면의 평가금액 기준)
      let investmentBase = marketValueInKRW;
      let basisLabel = '총평가금액';

      // 평가금액 계산이 어려운 경우에만 보조 기준 사용
      if (investmentBase <= 0) {
        investmentBase = Math.max(investmentInKRW, buyInvestmentInKRW);
        basisLabel = buyInvestmentInKRW >= investmentInKRW ? '누적매수(대체)' : '보유원가(대체)';
      }

      setInvestmentBasisLabel(basisLabel);
      setTotalInvestment(investmentBase);

      // 올해 누적 연배당률(YTD): 올해 배당금 / 투자금
      const computedYield = investmentBase > 0
        ? (yearlyTotal / investmentBase) * 100
        : 0;
      setAnnualYield(computedYield);

      // 예상 연배당률: 예상 연배당금 / 투자금
      const computedExpectedYield = investmentBase > 0
        ? (annualizedDividend / investmentBase) * 100
        : 0;
      setExpectedAnnualYield(computedExpectedYield);

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

  const sixMonthTotal = monthlyStats.reduce((sum, stat) => sum + stat.total, 0);
  const maxMonthlyTotal = monthlyStats.reduce((max, stat) => Math.max(max, stat.total), 0);

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
          <p className="text-xs text-slate-400 mt-1">
            예상 연배당금 {formatCurrency(expectedAnnualDividend)}
          </p>
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

        {/* 연배당률 */}
        <div className="bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-xl p-4 sm:p-6 border border-amber-500/30">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
              <Percent className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
            </div>
            <p className="text-xs sm:text-sm text-slate-400">올해 누적 연배당률</p>
          </div>
          <div className="flex items-end gap-2">
            <p className="text-xl sm:text-2xl font-bold text-white">
              {totalInvestment > 0 ? `${annualYield.toFixed(2)}%` : '-'}
            </p>
            <p className="text-xs text-amber-300/90 mb-1">
              {totalInvestment > 0 ? `예상 ${expectedAnnualYield.toFixed(2)}%` : ''}
            </p>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            투자금({investmentBasisLabel}) {formatCurrency(totalInvestment)}
          </p>
        </div>
      </div>

      {/* 월별 배당금 통계 */}
      <div className="relative overflow-hidden bg-slate-800/90 rounded-2xl p-6 border border-slate-700/80">
        <div className="absolute -top-24 -right-20 w-60 h-60 bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center">
              <PieChart className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white leading-none">월별 배당금</h3>
              <p className="text-xs text-slate-400 mt-1">최근 6개월 흐름</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">6개월 합계</p>
            <p className="text-sm font-semibold text-emerald-300">{formatCurrency(sixMonthTotal)}</p>
          </div>
        </div>
        {monthlyStats.length === 0 ? (
          <p className="text-center py-8 text-slate-400">배당금 기록이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {monthlyStats.map((stat) => {
              const widthByMax = maxMonthlyTotal > 0 ? (stat.total / maxMonthlyTotal) * 100 : 0;
              const sharePercent = totalDividend > 0 ? (stat.total / totalDividend) * 100 : 0;

              return (
              <div
                key={stat.month}
                className="group rounded-xl border border-slate-600/40 bg-slate-700/30 px-4 py-3 hover:border-emerald-400/40 transition-all"
              >
                <div className="flex justify-between items-center mb-2.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{formatMonth(stat.month)}</p>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-600/50 text-slate-300">
                      {stat.count}건
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-300">{formatCurrency(stat.total)}</p>
                    <p className="text-[11px] text-slate-400">{sharePercent.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="w-full bg-slate-700/80 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="h-2.5 rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-400 via-green-400 to-teal-400"
                    style={{ 
                      width: `${Math.max(widthByMax, 4)}%`,
                      boxShadow: '0 0 12px rgba(52,211,153,0.45)',
                    }}
                  />
                </div>
              </div>
            )})}
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
