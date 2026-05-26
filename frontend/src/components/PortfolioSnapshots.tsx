import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account } from '../types/models';
import { Camera, TrendingUp, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

interface SnapshotItem {
  id: number;
  account_id: number;
  asset_id: number;
  year: number;
  month: number;
  quantity: number;
  price: number;
  market_value: number;
  currency: string;
  asset?: {
    id: number;
    ticker: string;
    name: string;
    type: string;
    sector: string;
  };
}

interface MonthGroup {
  year: number;
  month: number;
  label: string;
  items: SnapshotItem[];
  totalKRW: number;
}

export default function PortfolioSnapshots() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number>(0);
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [exchangeRate, setExchangeRate] = useState(1300);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedAccount > 0) {
      loadSnapshots(selectedAccount);
    }
  }, [selectedAccount]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [accountsData, rate] = await Promise.all([
        apiClient.GetAllAccounts(),
        apiClient.GetUSDToKRW(),
      ]);
      const accountsList = accountsData as Account[];
      setAccounts(accountsList);
      setExchangeRate(rate as number);

      if (accountsList.length > 0) {
        setSelectedAccount(accountsList[0].id);
      }
    } catch (err) {
      console.error('Failed to load initial data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSnapshots = async (accountId: number) => {
    try {
      const data = await apiClient.GetSnapshotsByAccount(accountId);
      setSnapshots((data as SnapshotItem[]) || []);
    } catch (err) {
      console.error('Failed to load snapshots:', err);
      setSnapshots([]);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await apiClient.EnsureSnapshot();
      if (selectedAccount > 0) {
        await loadSnapshots(selectedAccount);
      }
    } catch (err) {
      console.error('Failed to refresh snapshot:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleMonth = (key: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // 월별 그룹핑
  const monthGroups: MonthGroup[] = (() => {
    const map = new Map<string, MonthGroup>();

    snapshots.forEach(snap => {
      const key = `${snap.year}-${String(snap.month).padStart(2, '0')}`;
      if (!map.has(key)) {
        map.set(key, {
          year: snap.year,
          month: snap.month,
          label: `${snap.year}년 ${snap.month}월`,
          items: [],
          totalKRW: 0,
        });
      }
      const group = map.get(key)!;
      group.items.push(snap);
      const valKRW = snap.currency === 'USD' ? snap.market_value * exchangeRate : snap.market_value;
      group.totalKRW += valKRW;
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  })();

  // 차트용 데이터 (최근 12개월)
  const chartData = [...monthGroups].reverse().slice(-12);
  const chartMax = Math.max(...chartData.map(g => g.totalKRW), 1);

  const formatCurrency = (value: number) => {
    if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
    if (value >= 10000) return `${Math.round(value / 10000).toLocaleString()}만`;
    return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  };

  const formatCurrencyFull = (value: number) => {
    return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  };

  if (loading) {
    return (
      <div className="text-center py-20 text-slate-400">
        <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-4" />
        데이터 로딩 중...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Camera className="w-6 h-6 text-purple-400" />
          <h2 className="text-xl font-bold text-white">포트폴리오 스냅샷</h2>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(Number(e.target.value))}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.broker})
              </option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg text-sm transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '기록 중...' : '이번달 기록'}
          </button>
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-12 text-center">
          <Camera className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 mb-2">스냅샷 데이터가 없습니다.</p>
          <p className="text-sm text-slate-500">'이번달 기록' 버튼을 눌러 현재 보유 종목의 평가금을 기록하세요.</p>
        </div>
      ) : (
        <>
          {/* 월별 평가금 추이 차트 */}
          {chartData.length > 1 && (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-5">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-400" />
                월별 총 평가금 추이
              </h3>
              <div className="flex items-end gap-2 h-40">
                {chartData.map((g, idx) => {
                  const height = g.totalKRW > 0 ? Math.max((g.totalKRW / chartMax) * 100, 4) : 0;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] text-slate-400 whitespace-nowrap">
                        {formatCurrency(g.totalKRW)}
                      </span>
                      <div className="w-full flex items-end justify-center" style={{ height: '110px' }}>
                        <div
                          className="w-full max-w-[28px] rounded-t bg-gradient-to-t from-purple-600 to-purple-400 transition-all duration-300"
                          style={{ height: `${height}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500">{g.month}월</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 월별 상세 */}
          <div className="space-y-3">
            {monthGroups.map((group) => {
              const key = `${group.year}-${group.month}`;
              const isExpanded = expandedMonths.has(key);
              const sortedItems = [...group.items].sort((a, b) => {
                const aVal = a.currency === 'USD' ? a.market_value * exchangeRate : a.market_value;
                const bVal = b.currency === 'USD' ? b.market_value * exchangeRate : b.market_value;
                return bVal - aVal;
              });

              return (
                <div key={key} className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                  <button
                    onClick={() => toggleMonth(key)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                        <Camera className="w-5 h-5 text-purple-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-base font-semibold text-white">{group.label}</p>
                        <p className="text-xs text-slate-400">{group.items.length}개 종목</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-lg font-bold text-purple-400">{formatCurrencyFull(group.totalKRW)}</p>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-700">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-5 py-2 text-xs text-slate-500 font-medium border-b border-slate-700/50">
                        <span>종목</span>
                        <span className="text-right">수량</span>
                        <span className="text-right">시세</span>
                        <span className="text-right">평가금</span>
                      </div>
                      <div className="divide-y divide-slate-700/30">
                        {sortedItems.map((item) => {
                          const valKRW = item.currency === 'USD'
                            ? item.market_value * exchangeRate
                            : item.market_value;
                          const isKR = item.asset?.ticker?.includes('.KS') || item.asset?.ticker?.includes('.KQ');
                          const displayName = isKR
                            ? (item.asset?.name || item.asset?.ticker || `Asset #${item.asset_id}`)
                            : (item.asset?.ticker || item.asset?.name || `Asset #${item.asset_id}`);
                          const displaySub = isKR
                            ? item.asset?.ticker
                            : item.asset?.name;

                          return (
                            <div key={item.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-5 py-3 items-center hover:bg-slate-700/20">
                              <div>
                                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                                {displaySub && (
                                  <p className="text-xs text-slate-500 truncate">{displaySub}</p>
                                )}
                              </div>
                              <p className="text-sm text-slate-300 text-right whitespace-nowrap">
                                {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)}주
                              </p>
                              <p className="text-sm text-slate-300 text-right whitespace-nowrap">
                                {item.currency === 'USD' ? `$${item.price.toFixed(2)}` : `₩${item.price.toLocaleString()}`}
                              </p>
                              <p className="text-sm font-semibold text-purple-400 text-right whitespace-nowrap">
                                {formatCurrencyFull(valKRW)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
