import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account, Dividend, Holding, Transaction } from '../types/models';
import IconTile from './ui/IconTile';
import RingGauge from './ui/RingGauge';
import { DollarSign, TrendingUp, Calendar, PieChart, Percent } from 'lucide-react';

interface DividendQuickStatsProps {
  accountId: number;
  children?: React.ReactNode;
  refreshTrigger?: number;
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
  yield: number;
}

export default function DividendQuickStats({ accountId, children, refreshTrigger = 0 }: DividendQuickStatsProps) {
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
  }, [accountId, refreshTrigger]);

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

      // 자산별 배당금 Top10 (배당률은 시세 도착 후 갱신)
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
            count: 0,
          };
          assetMap.set(div.asset_id, {
            name: div.asset.name,
            ticker: div.asset.ticker,
            total: existing.total + amountInKRW,
            count: existing.count + 1,
          });
        }
      });
      const sortedAssets = Array.from(assetMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // 1) 시세 비의존 값 + 원가 기반 잠정 배당률을 먼저 표시 (패널 즉시 렌더)
      const fallbackBase = Math.max(investmentInKRW, buyInvestmentInKRW);
      const fallbackLabel = buyInvestmentInKRW >= investmentInKRW ? '누적매수(대체)' : '보유원가(대체)';
      setInvestmentBasisLabel(fallbackLabel);
      setTotalInvestment(fallbackBase);
      setAnnualYield(fallbackBase > 0 ? (yearlyTotal / fallbackBase) * 100 : 0);
      setExpectedAnnualYield(fallbackBase > 0 ? (annualizedDividend / fallbackBase) * 100 : 0);
      setTopAssets(
        sortedAssets.map(asset => ({
          assetName: asset.name,
          ticker: asset.ticker,
          total: asset.total,
          count: asset.count,
          yield: 0,
        }))
      );
      setLoading(false);

      // 2) 시세는 비차단으로 받아 평가금액 기반 값(투자금/배당률/종목별 수익률)만 갱신
      const tickers = Array.from(
        new Set(
          holdings
            .filter(h => (h.quantity || 0) > 0 && h.asset?.ticker)
            .map(h => h.asset!.ticker)
        )
      );
      if (tickers.length === 0) return;

      apiClient
        .GetCurrentPrices(tickers)
        .then((batchPrices) => {
          const prices = (batchPrices || {}) as Record<string, any>;
          const priceMap = new Map<string, number>(
            tickers.map(ticker => {
              const priceData = prices[ticker.toUpperCase()] || prices[ticker];
              const rawPrice = Number(priceData?.price || 0);
              const currency = String(priceData?.currency || '');
              const priceInKRW = currency === 'USD' ? rawPrice * exchangeRateValue : rawPrice;
              return [ticker, priceInKRW] as const;
            })
          );

          const marketValueInKRW = holdings.reduce((sum, h) => {
            const qty = h.quantity || 0;
            const ticker = h.asset?.ticker;
            if (!ticker || qty <= 0) return sum;
            return sum + qty * (priceMap.get(ticker) || 0);
          }, 0);

          // 평가금액이 산출되면 총평가금액 기준으로 교체
          if (marketValueInKRW > 0) {
            setInvestmentBasisLabel('총평가금액');
            setTotalInvestment(marketValueInKRW);
            setAnnualYield((yearlyTotal / marketValueInKRW) * 100);
            setExpectedAnnualYield((annualizedDividend / marketValueInKRW) * 100);
          }

          // 종목별 배당률 갱신
          setTopAssets(
            sortedAssets.map(asset => {
              const holding = holdings.find(h => h.asset?.ticker === asset.ticker);
              const qty = holding?.quantity || 0;
              const marketValue = qty * (priceMap.get(asset.ticker) || 0);
              return {
                assetName: asset.name,
                ticker: asset.ticker,
                total: asset.total,
                count: asset.count,
                yield: marketValue > 0 ? (asset.total / marketValue) * 100 : 0,
              };
            })
          );
        })
        .catch((err) => {
          console.error('Failed to load prices for dividend stats:', err);
        });
    } catch (err) {
      console.error('Failed to load dividend stats:', err);
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
      <div className="surface p-6">
        <div className="text-center py-8 text-zinc-400">통계 로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 주요 통계 카드 */}
      <div className="surface p-5 sm:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:items-stretch gap-5 lg:gap-0">
          {/* 총 배당금 */}
          <div className="lg:flex-1 lg:pr-6">
            <div className="flex items-center gap-3 mb-3">
              <IconTile icon={DollarSign} tone="mint" size="sm" />
              <p className="label-mono">총 배당금</p>
            </div>
            <p className="num text-2xl sm:text-3xl font-light tracking-tight text-white">{formatCurrency(totalDividend)}</p>
          </div>
          <div className="divider-v hidden lg:block" />

          {/* 올해 배당금 */}
          <div className="lg:flex-1 lg:px-6">
            <div className="flex items-center gap-3 mb-3">
              <IconTile icon={Calendar} tone="sky" size="sm" />
              <p className="label-mono">{new Date().getFullYear()}년 배당금</p>
            </div>
            <p className="num text-2xl sm:text-3xl font-light tracking-tight text-white">{formatCurrency(yearlyTotal)}</p>
            <p className="label-mono mt-1.5">
              예상 연배당금 {formatCurrency(expectedAnnualDividend)}
            </p>
          </div>
          <div className="divider-v hidden lg:block" />

          {/* 평균 배당금 */}
          <div className="lg:flex-1 lg:px-6">
            <div className="flex items-center gap-3 mb-3">
              <IconTile icon={TrendingUp} size="sm" />
              <p className="label-mono">월평균 배당금</p>
            </div>
            <p className="num text-2xl sm:text-3xl font-light tracking-tight text-white">
              {formatCurrency(monthlyStats.length > 0 ? yearlyTotal / (new Date().getMonth() + 1) : 0)}
            </p>
          </div>
          <div className="divider-v hidden lg:block" />

          {/* 연배당률 */}
          <div className="lg:flex-1 lg:pl-6">
            <div className="flex items-center gap-3 mb-3">
              <IconTile icon={Percent} tone="amber" size="sm" />
              <p className="label-mono">올해 누적 연배당률</p>
            </div>
            <div className="flex items-center gap-4">
              <RingGauge
                size={72}
                value={totalInvestment > 0 && expectedAnnualYield > 0 ? (annualYield / expectedAnnualYield) * 100 : 0}
                label="예상 대비"
              >
                <span className="text-sm">{totalInvestment > 0 ? `${annualYield.toFixed(1)}%` : '-'}</span>
              </RingGauge>
              <div>
                <p className="num text-2xl sm:text-3xl font-light tracking-tight text-white">
                  {totalInvestment > 0 ? `${annualYield.toFixed(2)}%` : '-'}
                </p>
                <p className="text-xs text-amber-300/90 mt-0.5">
                  {totalInvestment > 0 ? `예상 ${expectedAnnualYield.toFixed(2)}%` : ''}
                </p>
              </div>
            </div>
            <p className="label-mono mt-2">
              투자금({investmentBasisLabel}) {formatCurrency(totalInvestment)}
            </p>
          </div>
        </div>
      </div>

      {children}

      {/* 월별 배당금 통계 */}
      <div className="relative overflow-hidden surface p-6">
                <div className="relative flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <IconTile icon={PieChart} tone="mint" />
            <div>
              <h3 className="section-title leading-none">월별 배당금</h3>
              <p className="label-mono mt-1">최근 6개월 흐름</p>
            </div>
          </div>
          <div className="text-right">
            <p className="label-mono">6개월 합계</p>
            <p className="num text-sm font-medium text-mint-300">{formatCurrency(sixMonthTotal)}</p>
          </div>
        </div>
        {monthlyStats.length === 0 ? (
          <p className="text-center py-8 text-zinc-400">배당금 기록이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {monthlyStats.map((stat) => {
              const widthByMax = maxMonthlyTotal > 0 ? (stat.total / maxMonthlyTotal) * 100 : 0;
              const sharePercent = totalDividend > 0 ? (stat.total / totalDividend) * 100 : 0;

              return (
              <div
                key={stat.month}
                className="group surface-inset px-4 py-3 hover:border-mint-400/30 transition-all"
              >
                <div className="flex justify-between items-center mb-2.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{formatMonth(stat.month)}</p>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.08] text-zinc-300">
                      {stat.count}건
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="num text-lg font-medium text-mint-300">{formatCurrency(stat.total)}</p>
                    <p className="label-mono">{sharePercent.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="w-full bg-white/[0.06] rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="h-2.5 rounded-full transition-all duration-500 bg-gradient-to-r from-mint-400 to-mint-200"
                    style={{ 
                      width: `${Math.max(widthByMax, 4)}%`,
                      boxShadow: '0 0 12px rgba(125,223,176,0.4)',
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
        <div className="surface p-6">
          <div className="flex items-center gap-3 mb-4">
            <IconTile icon={TrendingUp} tone="amber" size="sm" />
            <h3 className="section-title">배당금 Top 10</h3>
          </div>
          {topAssets.length === 0 ? (
            <p className="text-center py-8 text-zinc-400">배당금 기록이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {topAssets.map((asset, index) => (
                <div key={asset.ticker} className="surface-inset p-4 hover:bg-white/[0.04] transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-mono text-sm ${
                        index === 0 ? 'bg-amber-400/15 text-amber-300' :
                        index === 1 ? 'bg-white/[0.1] text-zinc-200' :
                        index === 2 ? 'bg-orange-400/15 text-orange-300' :
                        'bg-white/[0.08] text-zinc-400'
                      }`}>
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-white">
                          {asset.ticker.includes('.KS') || asset.ticker.includes('.KQ') 
                            ? asset.assetName 
                            : asset.ticker}
                        </p>
                        <p className="text-xs text-zinc-400">
                          {asset.ticker.includes('.KS') || asset.ticker.includes('.KQ')
                            ? `${asset.ticker} · ${asset.count}건`
                            : `${asset.assetName} · ${asset.count}건`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="num text-lg font-medium text-mint-300">{formatCurrency(asset.total)}</p>
                      <div className="flex items-center gap-2 justify-end">
                        {asset.yield > 0 && (
                          <span className="text-xs font-medium text-amber-300">
                            배당률 {asset.yield.toFixed(2)}%
                          </span>
                        )}
                        <span className="text-xs text-zinc-400">
                          {totalDividend > 0 ? `비중 ${((asset.total / totalDividend) * 100).toFixed(1)}%` : '0%'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 배당금 분포 원그래프 */}
        <div className="surface p-6">
          <div className="flex items-center gap-3 mb-4">
            <IconTile icon={PieChart} tone="sky" size="sm" />
            <h3 className="section-title">배당금 분포</h3>
          </div>
          {topAssets.length === 0 ? (
            <p className="text-center py-8 text-zinc-400">배당금 기록이 없습니다.</p>
          ) : (
            <div className="space-y-4">
              {/* SVG 원그래프 */}
              <div className="flex items-center justify-center">
                <svg viewBox="0 0 200 200" className="w-64 h-64">
                  {(() => {
                    const colors = [
                      '#7ddfb0', '#7dd3fc', '#fcd34d', '#c4b5fd', '#fda4af',
                      '#34d399', '#38bdf8', '#fdba74', '#a5b4fc', '#d4d4d8'
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
                    '#7ddfb0', '#7dd3fc', '#fcd34d', '#c4b5fd', '#fda4af',
                    '#34d399', '#38bdf8', '#fdba74', '#a5b4fc', '#d4d4d8'
                  ];
                  const percentage = (asset.total / totalDividend) * 100;
                  
                  return (
                    <div key={asset.ticker} className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: colors[index % colors.length] }}
                      />
                      <span className="text-xs text-zinc-300 truncate">
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
