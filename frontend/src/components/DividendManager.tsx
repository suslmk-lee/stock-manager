import { useState, useEffect, useRef } from 'react';
import { apiClient } from '../api/client';
import { Account, Asset, Dividend, Transaction } from '../types/models';
import { accountTypePrefix } from '../utils/accountType';
import { Plus, DollarSign, Calendar, Edit2, Trash2, ChevronRight, LayoutList, Clock, TrendingUp, Wallet, X } from 'lucide-react';
import IconTile from './ui/IconTile';
import DividendQuickStats from './DividendQuickStats';
import Portal from './ui/Portal';

interface DividendManagerProps {
  selectedAccountId?: number;
  onAccountChange?: (accountId: number) => void;
}

export default function DividendManager({ selectedAccountId = 0, onAccountChange }: DividendManagerProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDividend, setEditingDividend] = useState<Dividend | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<number>(selectedAccountId);
  const [exchangeRate, setExchangeRate] = useState(1300);
  const [showAllDividends, setShowAllDividends] = useState(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState('');
  const [showAssetDropdown, setShowAssetDropdown] = useState(false);
  // 폼 계좌의 거래 이력에 등장한 자산 id (전량 매도해 보유 0인 종목도 배당 입력 허용)
  const [accountTxAssetIds, setAccountTxAssetIds] = useState<Set<number>>(new Set());
  const [statsKey, setStatsKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Dividend | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
  const timelineRef = useRef<HTMLDivElement>(null);
  const [assetDetailModal, setAssetDetailModal] = useState<{ assetId: number; ticker: string; name: string } | null>(null);
  const [assetDetailData, setAssetDetailData] = useState<{
    dividends: Dividend[];
    monthlyChart: { month: string; total: number }[];
    totalAmount: number;
    holdingInfo: { accountName: string; quantity: number; marketValue: number; avgPrice: number }[];
    yieldPercent: number;
  } | null>(null);
  const [assetDetailLoading, setAssetDetailLoading] = useState(false);
  const [formData, setFormData] = useState({
    accountId: 0,
    assetId: 0,
    date: new Date().toISOString().split('T')[0],
    amount: '',
    currency: 'USD',
    tax: '',
    isReceived: true,
    notes: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedAccountId > 0 && selectedAccountId !== selectedAccount) {
      setSelectedAccount(selectedAccountId);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (selectedAccount > 0) {
      loadDividends(selectedAccount).catch((err) => {
        setError(err instanceof Error ? err.message : '배당금 목록을 불러오는데 실패했습니다.');
      });
    }
  }, [selectedAccount]);

  // 폼 계좌의 거래 이력 자산 id 로드 (전량 매도된 종목도 배당 입력 가능하도록)
  useEffect(() => {
    if (!formData.accountId) {
      setAccountTxAssetIds(new Set());
      return;
    }
    let cancelled = false;
    apiClient
      .GetTransactionsByAccount(formData.accountId)
      .then((txs) => {
        if (cancelled) return;
        const ids = new Set<number>();
        (txs as Transaction[]).forEach((t) => ids.add(t.asset_id));
        setAccountTxAssetIds(ids);
      })
      .catch(() => {
        if (!cancelled) setAccountTxAssetIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [formData.accountId]);

  // 배당 입력 시 선택 가능한 자산인지 판별:
  // 현재 보유 / 과거 거래 이력 / 기존 배당 이력 중 하나라도 해당 계좌에 있으면 허용
  const isAssetSelectableForDividend = (asset: Asset) =>
    !!asset.holdings?.some((h) => h.account_id === formData.accountId) ||
    accountTxAssetIds.has(asset.id) ||
    dividends.some((d) => d.account_id === formData.accountId && d.asset_id === asset.id);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [accountsData, assetsData, rate] = await Promise.all([
        apiClient.GetAllAccounts(),
        apiClient.GetAllAssets(),
        apiClient.GetUSDToKRW(),
      ]);
      setAccounts(accountsData as Account[]);
      setAssets(assetsData as Asset[]);
      setExchangeRate(rate as number);
      
      if ((accountsData as Account[]).length > 0) {
        const firstAccount = (accountsData as Account[])[0];
        const accountToSelect = selectedAccountId > 0 ? selectedAccountId : firstAccount.id;
        setSelectedAccount(accountToSelect);
        setFormData(prev => ({ ...prev, accountId: accountToSelect }));
        if (onAccountChange) {
          onAccountChange(accountToSelect);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다.');
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDividends = async (accountId: number) => {
    try {
      console.log('Loading dividends for account:', accountId);
      const dividendsData = await apiClient.GetDividendsByAccount(accountId);
      console.log('Loaded dividends:', dividendsData);
      setDividends(dividendsData as Dividend[]);
    } catch (err) {
      console.error('Failed to load dividends:', err);
      throw err;
    }
  };

  const openAssetDetail = async (assetId: number, ticker: string, name: string) => {
    setAssetDetailModal({ assetId, ticker, name });
    setAssetDetailLoading(true);
    setAssetDetailData(null);

    try {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      // 해당 종목의 모든 배당금 (현재 계좌 기준)
      const allDivs = dividends.filter(d => d.asset_id === assetId);
      const yearDivs = allDivs.filter(d => new Date(d.date) >= oneYearAgo);

      // 월별 차트 데이터
      const monthlyMap = new Map<string, number>();
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyMap.set(key, 0);
      }
      yearDivs.forEach(div => {
        const divDate = new Date(div.date);
        const key = `${divDate.getFullYear()}-${String(divDate.getMonth() + 1).padStart(2, '0')}`;
        const amountKRW = div.currency === 'USD' ? div.amount * exchangeRate : div.amount;
        monthlyMap.set(key, (monthlyMap.get(key) || 0) + amountKRW);
      });
      const monthlyChart = Array.from(monthlyMap.entries()).map(([month, total]) => ({ month, total }));

      // 총 배당금 (1년)
      const totalAmount = yearDivs.reduce((sum, div) => {
        return sum + (div.currency === 'USD' ? div.amount * exchangeRate : div.amount);
      }, 0);

      // 보유 정보 조회 (모든 계좌에서 이 종목 보유현황)
      const holdingsData = await apiClient.GetAllHoldings() as any[];
      const assetHoldings = holdingsData.filter((h: any) => h.asset_id === assetId && (h.quantity || 0) > 0);

      // 시세 조회
      let currentPrice = 0;
      let priceCurrency = '';
      try {
        const priceData = await apiClient.GetCurrentPrice(ticker) as any;
        currentPrice = Number(priceData?.price || 0);
        priceCurrency = String(priceData?.currency || '');
      } catch { /* ignore */ }

      const holdingInfo = assetHoldings.map((h: any) => {
        const acct = accounts.find(a => a.id === h.account_id);
        const priceInKRW = priceCurrency === 'USD' ? currentPrice * exchangeRate : currentPrice;
        return {
          accountName: acct?.name || `계좌 #${h.account_id}`,
          quantity: h.quantity || 0,
          marketValue: (h.quantity || 0) * priceInKRW,
          avgPrice: h.average_price || 0,
        };
      });

      // 투자금 대비 배당률
      const totalMarketValue = holdingInfo.reduce((sum, h) => sum + h.marketValue, 0);
      const yieldPercent = totalMarketValue > 0 ? (totalAmount / totalMarketValue) * 100 : 0;

      setAssetDetailData({
        dividends: yearDivs,
        monthlyChart,
        totalAmount,
        holdingInfo,
        yieldPercent,
      });
    } catch (err) {
      console.error('Failed to load asset detail:', err);
    } finally {
      setAssetDetailLoading(false);
    }
  };

  const handleCreateDividend = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingDividend) {
        await apiClient.UpdateDividend(
          editingDividend.id,
          formData.accountId,
          formData.assetId,
          formData.date,
          parseFloat(formData.amount),
          parseFloat(formData.tax),
          formData.currency,
          true,
          formData.notes
        );
      } else {
        await apiClient.CreateDividend(
          formData.accountId,
          formData.assetId,
          formData.date,
          parseFloat(formData.amount),
          parseFloat(formData.tax),
          formData.currency,
          true,
          formData.notes
        );
      }
      
      // 배당금 목록 새로고침 (폼 닫기 전에)
      await loadDividends(selectedAccount);
      
      // 통계 컴포넌트 백그라운드 갱신 (리마운트 없이)
      setStatsKey(prev => prev + 1);
      
      // 폼 초기화 (날짜는 유지, 자산은 초기화)
      setFormData({
        accountId: selectedAccount,
        assetId: 0,
        date: formData.date, // 이전 선택 날짜 유지
        amount: '',
        currency: 'USD',
        tax: '',
        isReceived: true,
        notes: '',
      });
      setAssetSearchQuery(''); // 자산 검색 필드 초기화
      setEditingDividend(null);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : (editingDividend ? '배당금 수정에 실패했습니다.' : '배당금 기록에 실패했습니다.'));
      console.error('Failed to save dividend:', err);
    }
  };

  const handleEditDividend = (dividend: Dividend) => {
    setEditingDividend(dividend);
    const asset = assets.find(a => a.id === dividend.asset_id);
    setAssetSearchQuery(asset ? `${asset.ticker} - ${asset.name}` : '');
    setFormData({
      accountId: dividend.account_id,
      assetId: dividend.asset_id,
      date: dividend.date.split('T')[0],
      amount: dividend.amount.toString(),
      currency: dividend.currency,
      tax: dividend.tax.toString(),
      isReceived: dividend.is_received,
      notes: dividend.notes || '',
    });
    setShowForm(true);
  };

  const handleDeleteDividend = (dividend: Dividend, event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    setDeleteTarget(dividend);
  };

  const confirmDeleteDividend = async () => {
    if (!deleteTarget || deleting) {
      return;
    }

    try {
      setDeleting(true);
      await apiClient.DeleteDividend(deleteTarget.id);
      setDividends(prev => prev.filter(item => item.id !== deleteTarget.id));
      setStatsKey(prev => prev + 1);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '배당금 삭제에 실패했습니다.');
      console.error('Failed to delete dividend:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingDividend(null);
    setFormData({
      accountId: selectedAccount,
      assetId: 0,
      date: new Date().toISOString().split('T')[0],
      amount: '',
      currency: 'USD',
      tax: '',
      isReceived: true,
      notes: '',
    });
    setAssetSearchQuery('');
    setShowAssetDropdown(false);
    setShowForm(false);
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        {/* 헤더 스켈레톤 */}
        <div className="flex items-center justify-between mb-6">
          <div className="h-7 w-40 rounded bg-white/[0.08]" />
          <div className="flex gap-2">
            <div className="h-10 w-32 rounded-xl bg-white/[0.06]" />
            <div className="h-10 w-28 rounded-xl bg-white/[0.06]" />
          </div>
        </div>

        {/* 요약 통계 카드 스켈레톤 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="surface p-6"
            >
              <div className="h-3 w-20 rounded bg-white/[0.08] mb-3" />
              <div className="h-6 w-28 rounded bg-white/[0.08] mb-2" />
              <div className="h-2.5 w-16 rounded bg-white/[0.08]" />
            </div>
          ))}
        </div>

        {/* 최근 배당금 리스트 스켈레톤 */}
        <div className="surface p-6">
          <div className="h-4 w-32 rounded bg-white/[0.08] mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 bg-white/[0.03] rounded-lg p-4">
                <div className="w-10 h-10 rounded-lg bg-white/[0.14]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-40 rounded bg-white/[0.14]" />
                  <div className="h-2.5 w-24 rounded bg-white/[0.14]" />
                </div>
                <div className="h-4 w-20 rounded bg-white/[0.14]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-400">
        <DollarSign className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <p className="text-lg">먼저 계좌를 등록해주세요.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-3">
            <IconTile icon={DollarSign} tone="mint" />
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">배당금 관리</h2>
          </div>
          <select
            value={selectedAccount}
            onChange={(e) => {
              const accountId = Number(e.target.value);
              setSelectedAccount(accountId);
              if (onAccountChange) {
                onAccountChange(accountId);
              }
            }}
            className="input-field sm:!w-auto"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountTypePrefix(account)}{account.broker} ({account.name})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            if (!showForm) {
              setFormData({
                accountId: selectedAccount,
                assetId: 0,
                date: formData.date || new Date().toISOString().split('T')[0], // 이전 날짜 유지, 없으면 오늘
                amount: '',
                currency: 'USD',
                tax: '',
                isReceived: true,
                notes: '',
              });
              setAssetSearchQuery(''); // 자산 검색 필드 초기화
            }
            setShowForm(!showForm);
          }}
          className="btn-primary w-full sm:w-auto"
        >
          <Plus className="w-5 h-5" />
          배당금 기록
        </button>
      </div>

      {error && (
        <div className={`px-4 py-3 rounded-2xl mb-6 flex items-start justify-between gap-2 ${
          error.includes('Google Sheets') || error.includes('GSYNC')
            ? 'bg-amber-400/10 border border-amber-400/30 text-amber-200'
            : 'bg-rose-500/10 border border-rose-400/30 text-rose-200'
        }`}>
          <div>
            {(error.includes('Google Sheets') || error.includes('GSYNC')) && (
              <span className="font-semibold">[Sheets 동기화 실패] </span>
            )}
            {error}
          </div>
          <button onClick={() => setError(null)} className="text-current opacity-60 hover:opacity-100 shrink-0">✕</button>
        </div>
      )}

      {/* 통계 섹션 (카드 → 최근 배당금 → 월별 차트 → Top10) */}
      {selectedAccount > 0 && (
        <div className="mb-6">
          <DividendQuickStats accountId={selectedAccount} refreshTrigger={statsKey}>
            {/* 최근 배당금 — 통계 카드 아래, 월별 차트 위 */}
            <div className="relative overflow-hidden surface p-6">
              <div className="relative flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <IconTile icon={Clock} tone="sky" size="sm" />
                  <h3 className="section-title">최근 배당금 내역</h3>
                </div>
                <div className="flex items-center gap-2">
                  {viewMode === 'list' && dividends.length > 3 && (
                    <button
                      onClick={() => setShowAllDividends(true)}
                      className="flex items-center gap-1 text-sm text-mint-300 hover:text-white transition-colors"
                    >
                      전체 보기 ({dividends.length}건)
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                  <div className="glass-pill flex p-0.5">
                    <button
                      onClick={() => setViewMode('timeline')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                        viewMode === 'timeline'
                          ? 'bg-white/[0.12] text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      타임라인
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                        viewMode === 'list'
                          ? 'bg-white/[0.12] text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <LayoutList className="w-3.5 h-3.5" />
                      리스트
                    </button>
                  </div>
                </div>
              </div>

              {dividends.length === 0 ? (
                <div className="text-center py-12 text-zinc-400">
                  <Calendar className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">배당금 기록이 없습니다.</p>
                  <p className="text-sm mt-2">위의 "배당금 기록" 버튼을 눌러 배당금을 기록하세요.</p>
                </div>
              ) : viewMode === 'timeline' ? (
                /* ===== 타임라인 뷰 ===== */
                <div className="relative">
                  {/* 타임라인 선 */}
                  <div className="absolute top-[52px] left-0 right-0 h-0.5 bg-gradient-to-r from-white/10 via-mint-400/30 to-mint-400 z-0" />

                  <div
                    ref={timelineRef}
                    className="grid grid-cols-6 gap-3 pt-2"
                  >
                    {[...dividends].slice(0, 6).reverse().map((dividend, idx) => {
                      const divDate = new Date(dividend.date);
                      const amountKRW = dividend.currency === 'USD'
                        ? dividend.amount * exchangeRate
                        : dividend.amount;

                      return (
                        <div
                          key={dividend.id}
                          className="flex flex-col items-center group"
                          style={{
                            animation: `timelineCardIn 0.4s ease-out ${idx * 0.06}s both`,
                          }}
                        >
                          {/* 날짜 */}
                          <p className="label-mono mb-2 whitespace-nowrap">
                            {divDate.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                          </p>

                          {/* 도트 */}
                          <div className="w-3 h-3 rounded-full bg-mint-400 border-2 border-ink-950 z-10 mb-6 group-hover:scale-125 transition-transform shadow-[0_0_8px_rgb(var(--c-mint-400)_/_0.5)]" />

                          {/* 카드 */}
                          <div
                            onClick={() => openAssetDetail(dividend.asset_id, dividend.asset?.ticker || '', dividend.asset?.name || '')}
                            className="w-full h-full surface-inset surface-interactive p-3 hover:border-mint-400/40 hover:-translate-y-1 cursor-pointer flex flex-col">
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                dividend.is_received
                                  ? 'bg-mint-400/15 text-mint-300'
                                  : 'bg-amber-400/15 text-amber-300'
                              }`}>
                                <DollarSign className="w-3.5 h-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-white truncate">
                                  {(dividend.asset?.ticker?.includes('.KS') || dividend.asset?.ticker?.includes('.KQ'))
                                    ? (dividend.asset?.name || 'N/A')
                                    : (dividend.asset?.ticker || 'N/A')}
                                </p>
                                <p className="label-mono !text-[10px] truncate">
                                  {(dividend.asset?.ticker?.includes('.KS') || dividend.asset?.ticker?.includes('.KQ'))
                                    ? (dividend.asset?.ticker || '')
                                    : (dividend.asset?.name || 'N/A')}
                                </p>
                              </div>
                            </div>
                            <p className="num text-sm font-medium text-mint-300 mb-1">
                              ₩{amountKRW.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                            </p>
                            {dividend.currency === 'USD' && (
                              <p className="text-[10px] text-zinc-500">
                                ${dividend.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                            )}
                            <div className="flex items-center gap-1 mt-auto pt-2 border-t border-white/[0.08]">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                dividend.is_received
                                  ? 'bg-mint-400/15 text-mint-300'
                                  : 'bg-amber-400/15 text-amber-300'
                              }`}>
                                {dividend.is_received ? '수령' : '예정'}
                              </span>
                              <div className="flex-1" />
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleEditDividend(dividend); }}
                                className="text-zinc-500 hover:text-mint-300 transition-colors p-0.5"
                                title="수정"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleDeleteDividend(dividend, e); }}
                                className="text-zinc-500 hover:text-rose-300 transition-colors p-0.5"
                                title="삭제"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {dividends.length > 6 && (
                    <p className="text-xs text-zinc-500 text-right mt-2">최근 6건 표시 중 (전체 {dividends.length}건)</p>
                  )}
                </div>
              ) : (
                /* ===== 리스트 뷰 ===== */
                <div className="space-y-3">
                  {dividends.slice(0, 3).map((dividend) => (
                  <div
                    key={dividend.id}
                    onClick={() => openAssetDetail(dividend.asset_id, dividend.asset?.ticker || '', dividend.asset?.name || '')}
                    className="surface-inset surface-interactive p-4 hover:border-mint-400/40 animate-[fadeSlideIn_0.3s_ease-out]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <IconTile icon={DollarSign} tone="mint" className="!w-12 !h-12" />
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-medium text-white">
                              {dividend.asset?.name || 'N/A'}
                            </h3>
                            <span className={`badge ${
                              dividend.is_received 
                                ? 'bg-mint-400/15 text-mint-300' 
                                : 'bg-amber-400/15 text-amber-300'
                            }`}>
                              {dividend.is_received ? '수령완료' : '수령예정'}
                            </span>
                          </div>
                          <p className="text-sm text-zinc-400 mt-1">
                            {dividend.asset?.ticker || 'N/A'} • {new Date(dividend.date).toLocaleDateString('ko-KR')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="num text-xl font-medium text-mint-300">
                            ₩{(dividend.currency === 'USD' 
                              ? dividend.amount * exchangeRate 
                              : dividend.amount
                            ).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                          </p>
                          {dividend.tax > 0 && (
                            <p className="text-xs text-zinc-500">
                              세금: ₩{(dividend.currency === 'USD' 
                                ? dividend.tax * exchangeRate 
                                : dividend.tax
                              ).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                            </p>
                          )}
                          {dividend.currency === 'USD' && (
                            <p className="text-xs text-zinc-500 mt-1">
                              (USD ${dividend.amount.toLocaleString()})
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleEditDividend(dividend); }}
                          className="text-zinc-500 hover:text-mint-300 transition-colors"
                          title="수정"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteDividend(dividend, e); }}
                          className="text-zinc-500 hover:text-rose-300 transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {dividend.notes && (
                      <p className="text-sm text-zinc-400 mt-3 pl-16">{dividend.notes}</p>
                    )}
                  </div>
                  ))}
                </div>
              )}
            </div>
          </DividendQuickStats>
        </div>
      )}

      {showForm && (
        <Portal>
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={handleCancelEdit}
          >
            <div 
              className="surface p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="section-title !text-lg">배당금 기록</h3>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="btn-icon"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <form 
                onSubmit={handleCreateDividend} 
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
                    e.preventDefault();
                  }
                }}
                className="space-y-4"
              >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">계좌 *</label>
                  <select
                    value={formData.accountId}
                    onChange={(e) => setFormData({ ...formData, accountId: Number(e.target.value) })}
                    className="input-field"
                    required
                  >
                    <option value={0}>계좌를 선택하세요</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        🏦 {accountTypePrefix(account)}{account.name} ({account.broker})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">자산 *</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={assetSearchQuery}
                      autoComplete="off"
                      onChange={(e) => {
                        setAssetSearchQuery(e.target.value);
                        setShowAssetDropdown(true);
                        if (!e.target.value) {
                          setFormData({ ...formData, assetId: 0 });
                        }
                      }}
                      onFocus={() => setShowAssetDropdown(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log('Enter key pressed in asset search');
                          // 검색 결과 중 첫 번째 자산 자동 선택 (선택된 계좌에 속한 자산만)
                          const filteredAssets = assets.filter(asset => {
                            // 보유/거래/배당 이력이 있는 자산만 (전량 매도된 종목 포함)
                            if (!isAssetSelectableForDividend(asset)) return false;

                            const query = assetSearchQuery.toLowerCase();
                            return (
                              asset.ticker.toLowerCase().includes(query) ||
                              asset.name.toLowerCase().includes(query)
                            );
                          });
                          console.log('Filtered assets:', filteredAssets);
                          if (filteredAssets.length > 0) {
                            const selectedAsset = filteredAssets[0];
                            const isKoreanAsset = selectedAsset.ticker.includes('.KS') || selectedAsset.ticker.includes('.KQ');
                            console.log('Selecting asset:', selectedAsset.ticker, 'Currency:', isKoreanAsset ? 'KRW' : 'USD');
                            setFormData({ 
                              ...formData, 
                              assetId: selectedAsset.id,
                              currency: isKoreanAsset ? 'KRW' : 'USD'
                            });
                            setAssetSearchQuery(`${selectedAsset.ticker} - ${selectedAsset.name}`);
                            setShowAssetDropdown(false);
                          }
                        }
                      }}
                      placeholder="티커 또는 자산명 검색..."
                      className="input-field"
                      required={formData.assetId === 0}
                    />
                    {showAssetDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-ink-900 border border-white/[0.12] rounded-xl max-h-60 overflow-y-auto shadow-2xl shadow-black/50">
                        {assets
                          .filter(asset => {
                            // 보유/거래/배당 이력이 있는 자산만 (전량 매도된 종목 포함)
                            if (!isAssetSelectableForDividend(asset)) return false;

                            const query = assetSearchQuery.toLowerCase();
                            return (
                              asset.ticker.toLowerCase().includes(query) ||
                              asset.name.toLowerCase().includes(query)
                            );
                          })
                          .map((asset) => (
                            <button
                              key={asset.id}
                              type="button"
                              onClick={() => {
                                // 한국 ETF 판별 (티커에 .KS 또는 .KQ 포함)
                                const isKoreanAsset = asset.ticker.includes('.KS') || asset.ticker.includes('.KQ');
                                setFormData({ 
                                  ...formData, 
                                  assetId: asset.id,
                                  currency: isKoreanAsset ? 'KRW' : 'USD'
                                });
                                setAssetSearchQuery(`${asset.ticker} - ${asset.name}`);
                                setShowAssetDropdown(false);
                              }}
                              className="w-full text-left px-4 py-2 hover:bg-white/[0.08] transition-colors text-sm"
                            >
                              <span className="font-medium text-mint-300">{asset.ticker}</span>
                              <span className="text-zinc-300"> - {asset.name}</span>
                            </button>
                          ))}
                        {assets.filter(asset => {
                          // 선택된 계좌에 속한 자산만 필터링
                          const belongsToAccount = asset.holdings?.some(h => h.account_id === formData.accountId);
                          if (!belongsToAccount) return false;
                          
                          const query = assetSearchQuery.toLowerCase();
                          return (
                            asset.ticker.toLowerCase().includes(query) ||
                            asset.name.toLowerCase().includes(query)
                          );
                        }).length === 0 && (
                          <div className="px-4 py-3 text-sm text-zinc-400 text-center">
                            검색 결과가 없습니다.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="field-label">지급일 *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">배당금액 *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="input-field"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">세금</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.tax}
                    onChange={(e) => setFormData({ ...formData, tax: e.target.value })}
                    className="input-field"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">통화</label>
                  <select
                    value={formData.currency}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    className="input-field"
                  >
                    <option value="USD">USD</option>
                    <option value="KRW">KRW</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">수령 여부</label>
                  <select
                    value={formData.isReceived ? 'true' : 'false'}
                    onChange={(e) => setFormData({ ...formData, isReceived: e.target.value === 'true' })}
                    className="input-field"
                  >
                    <option value="true">수령 완료</option>
                    <option value="false">수령 예정</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">메모</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="input-field"
                  placeholder="추가 메모"
                  rows={2}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="btn-primary flex-1"
                >
                  {editingDividend ? '수정' : '기록'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="btn-ghost flex-1"
                >
                  취소
                </button>
              </div>
            </form>
            </div>
          </div>
        </Portal>
      )}

      {/* 전체 배당금 모달 */}
      {showAllDividends && (
        <Portal>
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowAllDividends(false)}
          >
            <div
              className="relative surface max-w-3xl w-full max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-6 pb-4 border-b border-white/[0.08]">
                <h3 className="section-title">배당금 전체 내역 ({dividends.length}건)</h3>
                <button
                  onClick={() => setShowAllDividends(false)}
                  className="btn-icon"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto p-6 pt-4 space-y-3">
                {dividends.map((dividend) => (
                  <div
                    key={dividend.id}
                    className="surface-inset p-4 hover:border-mint-400/40 transition-all duration-200"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <IconTile icon={DollarSign} tone="mint" />
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-white">
                              {dividend.asset?.name || 'N/A'}
                            </h4>
                            <span className={`badge ${
                              dividend.is_received
                                ? 'bg-mint-400/15 text-mint-300'
                                : 'bg-amber-400/15 text-amber-300'
                            }`}>
                              {dividend.is_received ? '수령완료' : '수령예정'}
                            </span>
                          </div>
                          <p className="text-sm text-zinc-400 mt-0.5">
                            {dividend.asset?.ticker || 'N/A'} • {new Date(dividend.date).toLocaleDateString('ko-KR')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="num text-lg font-medium text-mint-300">
                            ₩{(dividend.currency === 'USD'
                              ? dividend.amount * exchangeRate
                              : dividend.amount
                            ).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                          </p>
                          {dividend.currency === 'USD' && (
                            <p className="text-xs text-zinc-500">
                              (USD ${dividend.amount.toLocaleString()})
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => { setShowAllDividends(false); handleEditDividend(dividend); }}
                          className="text-zinc-500 hover:text-mint-300 transition-colors"
                          title="수정"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { setShowAllDividends(false); handleDeleteDividend(dividend, e); }}
                          className="text-zinc-500 hover:text-rose-300 transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {dividend.notes && (
                      <p className="text-sm text-zinc-400 mt-2 pl-14">{dividend.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* 종목 상세 배당금 모달 */}
      {assetDetailModal && (
        <Portal>
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setAssetDetailModal(null)}
          >
            <div
              className="relative surface max-w-2xl w-full max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div className="sticky top-0 bg-ink-900/95 backdrop-blur border-b border-white/[0.08] rounded-t-3xl px-6 py-4 flex items-center justify-between z-10">
                <div>
                  <h3 className="section-title !text-lg">
                    {(assetDetailModal.ticker.includes('.KS') || assetDetailModal.ticker.includes('.KQ'))
                      ? assetDetailModal.name
                      : assetDetailModal.ticker}
                  </h3>
                  <p className="label-mono mt-0.5">
                    {(assetDetailModal.ticker.includes('.KS') || assetDetailModal.ticker.includes('.KQ'))
                      ? assetDetailModal.ticker
                      : assetDetailModal.name}
                    {' · 최근 1년 배당금'}
                  </p>
                </div>
                <button
                  onClick={() => setAssetDetailModal(null)}
                  className="btn-icon"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {assetDetailLoading ? (
                <div className="p-12 text-center text-zinc-400">데이터 로딩 중...</div>
              ) : assetDetailData ? (
                <div className="p-6 space-y-6">
                  {/* 요약 카드 */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="surface-inset p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="w-4 h-4 text-mint-300" />
                        <span className="label-mono">1년 배당금</span>
                      </div>
                      <p className="num text-lg font-medium text-mint-300">
                        ₩{assetDetailData.totalAmount.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="surface-inset p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="w-4 h-4 text-amber-300" />
                        <span className="label-mono">투자 대비 배당률</span>
                      </div>
                      <p className="num text-lg font-medium text-amber-300">
                        {assetDetailData.yieldPercent > 0 ? `${assetDetailData.yieldPercent.toFixed(2)}%` : '-'}
                      </p>
                    </div>
                    <div className="surface-inset p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Calendar className="w-4 h-4 text-sky-300" />
                        <span className="label-mono">배당 횟수</span>
                      </div>
                      <p className="num text-lg font-medium text-sky-300">
                        {assetDetailData.dividends.length}회
                      </p>
                    </div>
                  </div>

                  {/* 월별 배당금 차트 */}
                  <div className="surface-inset p-4">
                    <h4 className="text-sm font-medium text-white mb-4">월별 배당금 추이</h4>
                    <div className="flex items-end gap-1 h-32">
                      {(() => {
                        const maxVal = Math.max(...assetDetailData.monthlyChart.map(m => m.total), 1);
                        return assetDetailData.monthlyChart.map((item, idx) => {
                          const height = item.total > 0 ? Math.max((item.total / maxVal) * 100, 4) : 0;
                          const [, month] = item.month.split('-');
                          return (
                            <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                              <div className="w-full flex items-end justify-center" style={{ height: '100px' }}>
                                <div
                                  className={`w-full max-w-[24px] rounded-t transition-all duration-300 ${
                                    item.total > 0
                                      ? 'bg-gradient-to-t from-mint-600/60 to-mint-300'
                                      : 'bg-white/[0.08]'
                                  }`}
                                  style={{ height: item.total > 0 ? `${height}%` : '4px' }}
                                  title={`₩${item.total.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`}
                                />
                              </div>
                              <span className="label-mono !text-[9px]">{parseInt(month)}월</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {/* 보유 현황 */}
                  {assetDetailData.holdingInfo.length > 0 && (
                    <div className="surface-inset p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Wallet className="w-4 h-4 text-zinc-300" />
                        <h4 className="text-sm font-medium text-white">보유 현황</h4>
                      </div>
                      <div className="space-y-2">
                        {assetDetailData.holdingInfo.map((h, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-white/[0.04] rounded-xl px-4 py-3">
                            <div>
                              <p className="text-sm font-medium text-white">{h.accountName}</p>
                              <p className="text-xs text-zinc-400">{h.quantity}주 보유</p>
                            </div>
                            <div className="text-right">
                              <p className="num text-sm font-medium text-mint-300">
                                ₩{h.marketValue.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                              </p>
                              <p className="text-xs text-zinc-400">
                                평단 ₩{h.avgPrice.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 배당금 내역 리스트 */}
                  <div className="surface-inset p-4">
                    <h4 className="text-sm font-medium text-white mb-3">배당금 내역 ({assetDetailData.dividends.length}건)</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {assetDetailData.dividends.map(div => {
                        const amtKRW = div.currency === 'USD' ? div.amount * exchangeRate : div.amount;
                        return (
                          <div key={div.id} className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-white/[0.05]">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${div.is_received ? 'bg-mint-400' : 'bg-amber-300'}`} />
                              <span className="text-sm text-zinc-300">
                                {new Date(div.date).toLocaleDateString('ko-KR')}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="num text-sm font-medium text-mint-300">
                                ₩{amtKRW.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                              </span>
                              {div.currency === 'USD' && (
                                <span className="text-xs text-zinc-500 ml-2">
                                  (${div.amount.toFixed(2)})
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-12 text-center text-zinc-400">데이터를 불러올 수 없습니다.</div>
              )}
            </div>
          </div>
        </Portal>
      )}

      {deleteTarget && (
        <Portal>
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => !deleting && setDeleteTarget(null)}
          >
            <div
              className="surface p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-white mb-2">배당금 삭제</h3>
              <p className="text-zinc-300 mb-6">
                {`${deleteTarget.asset?.name || ''} 배당금 (${new Date(deleteTarget.date).toLocaleDateString('ko-KR')})을 삭제하시겠습니까?`}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="btn-ghost flex-1"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteDividend}
                  disabled={deleting}
                  className="btn-danger flex-1"
                >
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
