import { useState, useEffect } from 'react';
import { PageActions } from './shell/PageSlots';
import { apiClient } from '../api/client';
import { Account } from '../types/models';
import { accountTypePrefix } from '../utils/accountType';
import CardIcon from './ui/CardIcon';
import { Camera, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { IconCamera, IconTrend } from './ui/appIcons';

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
      <div className="text-center py-20 text-zinc-400">
        <div className="animate-spin w-8 h-8 border-2 border-mint-400 border-t-transparent rounded-full mx-auto mb-4" />
        데이터 로딩 중...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageActions
        lead={
          <select
            aria-label="계좌"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(Number(e.target.value))}
            className="input-field !w-auto !py-1.5 px-3 text-sm"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {accountTypePrefix(acc)}{acc.name} ({acc.broker})
              </option>
            ))}
          </select>
        }
      >
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-primary"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? '기록 중...' : '이번달 기록'}
        </button>
      </PageActions>

      {snapshots.length === 0 ? (
        <div className="surface p-12 text-center">
          <Camera className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-400 mb-2">스냅샷 데이터가 없습니다.</p>
          <p className="text-sm text-zinc-500">'이번달 기록' 버튼을 눌러 현재 보유 종목의 평가금을 기록하세요.</p>
        </div>
      ) : (
        <>
          {/* 월별 평가금 추이 차트 */}
          {chartData.length > 1 && (
            <div className="surface p-5">
              <h3 className="section-title mb-4 flex items-center gap-3">
                <CardIcon icon={IconTrend} tone="mint" size="sm" />
                월별 총 평가금 추이
              </h3>
              <div className="flex items-end gap-2 h-40">
                {chartData.map((g, idx) => {
                  const height = g.totalKRW > 0 ? Math.max((g.totalKRW / chartMax) * 100, 4) : 0;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                      <span className="label-mono !text-[9px] whitespace-nowrap">
                        {formatCurrency(g.totalKRW)}
                      </span>
                      <div className="w-full flex items-end justify-center" style={{ height: '110px' }}>
                        <div
                          className="w-full max-w-[28px] rounded-t-md bg-gradient-to-t from-mint-600/60 to-mint-300 transition-all duration-300"
                          style={{ height: `${height}%` }}
                        />
                      </div>
                      <span className="label-mono !text-[10px]">{g.month}월</span>
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
                <div key={key} className="surface overflow-hidden">
                  <button
                    onClick={() => toggleMonth(key)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <CardIcon icon={IconCamera} tone="mint" />
                      <div className="text-left">
                        <p className="text-base font-semibold text-white">{group.label}</p>
                        <p className="label-mono mt-0.5">{group.items.length}개 종목</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="num text-lg font-medium text-mint-300">{formatCurrencyFull(group.totalKRW)}</p>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-zinc-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-zinc-400" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-white/[0.08]">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-5 py-2 table-head border-b border-white/[0.08]">
                        <span>종목</span>
                        <span className="text-right">수량</span>
                        <span className="text-right">시세</span>
                        <span className="text-right">평가금</span>
                      </div>
                      <div className="divide-y divide-white/[0.05]">
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
                            <div key={item.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-5 py-3 items-center hover:bg-white/[0.03]">
                              <div>
                                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                                {displaySub && (
                                  <p className="text-xs text-zinc-500 truncate">{displaySub}</p>
                                )}
                              </div>
                              <p className="num text-sm text-zinc-300 text-right whitespace-nowrap">
                                {item.quantity % 1 === 0 ? item.quantity : item.quantity.toLocaleString('ko-KR', { maximumFractionDigits: item.quantity < 1 ? 6 : 2 })}주
                              </p>
                              <p className="num text-sm text-zinc-300 text-right whitespace-nowrap">
                                {item.currency === 'USD' ? `$${item.price.toFixed(2)}` : `₩${item.price.toLocaleString()}`}
                              </p>
                              <p className="num text-sm font-medium text-mint-300 text-right whitespace-nowrap">
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
