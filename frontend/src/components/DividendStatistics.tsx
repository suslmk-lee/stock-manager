import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account } from '../types/models';
import { TrendingUp, DollarSign, Calendar, PieChart } from 'lucide-react';

interface DividendStatisticsProps {
  accountId?: number;
  marketType?: string;
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

export default function DividendStatistics({ accountId, marketType, months = 12 }: DividendStatisticsProps) {
  const [stats, setStats] = useState<DividendStats | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [exchangeRate, setExchangeRate] = useState(1300);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [accountId, marketType, months]);

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
          <div key={i} className="bg-slate-800 rounded-xl p-6 border border-slate-700 animate-pulse">
            <div className="h-20"></div>
          </div>
        ))}
      </div>
    );
  }

  const domesticAccounts = accounts.filter(acc => acc.market_type === 'Domestic');
  const internationalAccounts = accounts.filter(acc => acc.market_type === 'International');

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

  return (
    <div className="space-y-6">
      {/* 주요 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-6 border border-green-500/30">
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-300 text-sm">총 배당금</p>
            <DollarSign className="w-5 h-5 text-green-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            {formatCurrency(totalDividendsKRW)}
          </p>
          <p className="text-xs text-slate-400 mt-1">세전 금액</p>
        </div>

        <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-xl p-6 border border-blue-500/30">
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-300 text-sm">순 배당금</p>
            <TrendingUp className="w-5 h-5 text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            {formatCurrency(netDividendsKRW)}
          </p>
          <p className="text-xs text-slate-400 mt-1">세후 금액</p>
        </div>

        <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-6 border border-purple-500/30">
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-300 text-sm">평균 배당금</p>
            <PieChart className="w-5 h-5 text-purple-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            {formatCurrency(averageDividendKRW)}
          </p>
          <p className="text-xs text-slate-400 mt-1">건당 평균</p>
        </div>

        <div className="bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-xl p-6 border border-orange-500/30">
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-300 text-sm">배당 건수</p>
            <Calendar className="w-5 h-5 text-orange-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            {stats.received_count + stats.pending_count}건
          </p>
          <p className="text-xs text-slate-400 mt-1">
            수령 {stats.received_count} / 예정 {stats.pending_count}
          </p>
        </div>
      </div>

      {/* 시장별 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
            국내 시장
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">계좌 수</span>
              <span className="text-white font-semibold">{domesticAccounts.length}개</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">주요 증권사</span>
              <span className="text-white font-semibold">
                {domesticAccounts.length > 0 
                  ? domesticAccounts[0].broker 
                  : '-'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="w-3 h-3 bg-green-500 rounded-full"></span>
            해외 시장
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">계좌 수</span>
              <span className="text-white font-semibold">{internationalAccounts.length}개</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">주요 증권사</span>
              <span className="text-white font-semibold">
                {internationalAccounts.length > 0 
                  ? internationalAccounts[0].broker 
                  : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 세금 정보 */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold mb-4">세금 정보</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-slate-400 text-sm mb-1">총 세금</p>
            <p className="text-xl font-bold text-red-400">
              {formatCurrency(totalTaxKRW)}
            </p>
          </div>
          <div>
            <p className="text-slate-400 text-sm mb-1">세율</p>
            <p className="text-xl font-bold text-white">
              {totalDividendsKRW > 0 
                ? ((totalTaxKRW / totalDividendsKRW) * 100).toFixed(1) 
                : 0}%
            </p>
          </div>
          <div>
            <p className="text-slate-400 text-sm mb-1">환율 (USD/KRW)</p>
            <p className="text-xl font-bold text-white">
              ₩{exchangeRate.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
