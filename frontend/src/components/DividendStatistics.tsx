import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account } from '../types/models';
import CardIcon from './ui/CardIcon';
import { useThemeColors } from '../appearance/AppearanceContext';
import { LiquidityFilter, matchesLiquidity } from '../utils/accountType';
import { IconCalendar, IconCoin, IconPie, IconReceipt, IconTrend } from './ui/appIcons';

interface DividendStatisticsProps {
  accountId?: number;
  marketType?: string;
  liquidity?: LiquidityFilter;
  months?: number;
}

interface DividendStats {
  total_dividends_usd: number;
  total_dividends_krw: number;
  total_tax_usd: number;
  total_tax_krw: number;
  received_count: number;
  pending_count: number;
}

export default function DividendStatistics({ accountId, marketType, liquidity = 'all', months = 12 }: DividendStatisticsProps) {
  const tc = useThemeColors();
  const [stats, setStats] = useState<DividendStats | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [exchangeRate, setExchangeRate] = useState(1300);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [accountId, marketType, liquidity, months]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, accountsData, rate] = await Promise.all([
        apiClient.GetDividendStats(),
        apiClient.GetAllAccounts(),
        apiClient.GetUSDToKRW()
      ]);
      
      setStats(statsData as DividendStats);
      setAccounts(accountsData as Account[]);
      setExchangeRate(rate as number);
    } catch (err) {
      console.error('Failed to load statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="surface p-6 animate-pulse">
            <div className="h-20"></div>
          </div>
        ))}
      </div>
    );
  }

  const domesticAccounts = accounts.filter(acc => acc.market_type === 'Domestic' && matchesLiquidity(acc, liquidity));
  const internationalAccounts = accounts.filter(acc => acc.market_type === 'International' && matchesLiquidity(acc, liquidity));

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency: 'KRW',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // 통화별로 환율 적용하여 KRW로 변환
  const totalDividendsKRW = (stats.total_dividends_usd * exchangeRate) + stats.total_dividends_krw;
  const totalTaxKRW = (stats.total_tax_usd * exchangeRate) + stats.total_tax_krw;
  const netDividendsKRW = totalDividendsKRW - totalTaxKRW;
  const totalCount = stats.received_count + stats.pending_count;
  const averageDividendKRW = totalCount > 0 ? totalDividendsKRW / totalCount : 0;

  const kpis = [
    { label: '총 배당금', value: formatCurrency(totalDividendsKRW), sub: '세전 금액', icon: IconCoin, tone: 'mint' as const },
    { label: '순 배당금', value: formatCurrency(netDividendsKRW), sub: '세후 금액', icon: IconTrend, tone: 'sky' as const },
    { label: '평균 배당금', value: formatCurrency(averageDividendKRW), sub: '건당 평균', icon: IconPie, tone: 'warm' as const },
    {
      label: '배당 건수',
      value: `${stats.received_count + stats.pending_count}건`,
      sub: `수령 ${stats.received_count} / 예정 ${stats.pending_count}`,
      icon: IconCalendar,
      tone: 'amber' as const,
    },
  ];

  const marketCards = [
    { label: '국내 시장', accounts: domesticAccounts, dot: tc.palette[1] },
    { label: '해외 시장', accounts: internationalAccounts, dot: tc.accent },
  ];

  return (
    <div className="space-y-6">
      {/* 주요 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="surface p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="stat-label">{k.label}</p>
              <CardIcon icon={k.icon} tone={k.tone} size="sm" />
            </div>
            <p className="num text-2xl font-light tracking-tight text-white">{k.value}</p>
            <p className="label-mono mt-1.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* 시장별 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {marketCards.map((m) => (
          <div key={m.label} className="surface p-5 sm:p-6">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.dot, boxShadow: `0 0 8px color-mix(in srgb, ${m.dot} 53%, transparent)` }}></span>
              {m.label}
            </h3>
            <div className="space-y-2">
              <div className="surface-inset flex justify-between items-center px-4 py-3">
                <span className="label-mono">계좌 수</span>
                <span className="num text-white font-medium">{m.accounts.length}개</span>
              </div>
              <div className="surface-inset flex justify-between items-center px-4 py-3">
                <span className="label-mono">주요 증권사</span>
                <span className="text-white font-medium">
                  {m.accounts.length > 0 ? m.accounts[0].broker : '-'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 세금 정보 */}
      <div className="surface p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <CardIcon icon={IconReceipt} tone="amber" size="sm" />
          <h3 className="section-title">세금 정보</h3>
        </div>
        <div className="surface-inset flex flex-col sm:flex-row items-stretch gap-4 sm:gap-0 p-5">
          <div className="flex-1 sm:text-center">
            <p className="num text-xl font-light text-rose-300">{formatCurrency(totalTaxKRW)}</p>
            <p className="label-mono mt-1.5">총 세금</p>
          </div>
          <span className="divider-v hidden sm:block" />
          <div className="flex-1 sm:text-center">
            <p className="num text-xl font-light text-white">
              {totalDividendsKRW > 0
                ? ((totalTaxKRW / totalDividendsKRW) * 100).toFixed(1)
                : 0}%
            </p>
            <p className="label-mono mt-1.5">세율</p>
          </div>
          <span className="divider-v hidden sm:block" />
          <div className="flex-1 sm:text-center">
            <p className="num text-xl font-light text-white">
              ₩{exchangeRate.toLocaleString()}
            </p>
            <p className="label-mono mt-1.5">환율 (USD/KRW)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
