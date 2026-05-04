import { useState, useEffect, useRef } from 'react';
import { apiClient } from '../api/client';
import { Account, Asset, Dividend } from '../types/models';
import { Plus, DollarSign, Calendar, Edit2, Trash2, ChevronRight, LayoutList, Clock } from 'lucide-react';
import DividendQuickStats from './DividendQuickStats';

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
  const [statsKey, setStatsKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Dividend | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
  const timelineRef = useRef<HTMLDivElement>(null);
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
    return <div className="text-center py-12 text-slate-400">로딩 중...</div>;
  }

  if (accounts.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <DollarSign className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <p className="text-lg">먼저 계좌를 등록해주세요.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <h2 className="text-xl sm:text-2xl font-bold text-white">배당금 관리</h2>
          <select
            value={selectedAccount}
            onChange={(e) => {
              const accountId = Number(e.target.value);
              setSelectedAccount(accountId);
              if (onAccountChange) {
                onAccountChange(accountId);
              }
            }}
            className="w-full sm:w-auto bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.broker} ({account.name})
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
          className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors w-full sm:w-auto"
        >
          <Plus className="w-5 h-5" />
          배당금 기록
        </button>
      </div>

      {error && (
        <div className={`px-4 py-3 rounded-lg mb-6 flex items-start justify-between gap-2 ${
          error.includes('Google Sheets') || error.includes('GSYNC')
            ? 'bg-yellow-500/20 border border-yellow-500 text-yellow-200'
            : 'bg-red-500/20 border border-red-500 text-red-200'
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
            <div className="relative overflow-hidden bg-slate-800 rounded-xl p-6 border border-slate-700">
              <div className="absolute -top-40 -right-32 w-[28rem] h-[28rem] bg-green-500/10 blur-3xl pointer-events-none" />
              <div className="relative flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">최근 배당금 내역</h3>
                <div className="flex items-center gap-2">
                  {viewMode === 'list' && dividends.length > 3 && (
                    <button
                      onClick={() => setShowAllDividends(true)}
                      className="flex items-center gap-1 text-sm text-green-400 hover:text-green-300 transition-colors"
                    >
                      전체 보기 ({dividends.length}건)
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                  <div className="flex bg-slate-700 rounded-lg p-0.5">
                    <button
                      onClick={() => setViewMode('timeline')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                        viewMode === 'timeline'
                          ? 'bg-green-600 text-white shadow-lg shadow-green-600/20'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      타임라인
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                        viewMode === 'list'
                          ? 'bg-green-600 text-white shadow-lg shadow-green-600/20'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <LayoutList className="w-3.5 h-3.5" />
                      리스트
                    </button>
                  </div>
                </div>
              </div>

              {dividends.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Calendar className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">배당금 기록이 없습니다.</p>
                  <p className="text-sm mt-2">위의 "배당금 기록" 버튼을 눌러 배당금을 기록하세요.</p>
                </div>
              ) : viewMode === 'timeline' ? (
                /* ===== 타임라인 뷰 ===== */
                <div className="relative">
                  {/* 타임라인 선 */}
                  <div className="absolute top-[52px] left-0 right-0 h-0.5 bg-gradient-to-r from-slate-700 via-green-500/40 to-green-500 z-0" />

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
                          <p className="text-[11px] text-slate-400 mb-2 whitespace-nowrap">
                            {divDate.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                          </p>

                          {/* 도트 */}
                          <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-slate-800 z-10 mb-6 group-hover:scale-125 transition-transform shadow-[0_0_8px_rgba(34,197,94,0.5)]" />

                          {/* 카드 */}
                          <div className="w-full h-full bg-slate-700/60 backdrop-blur rounded-xl p-3 border border-slate-600/60 hover:border-green-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-green-500/10 hover:-translate-y-1 cursor-pointer flex flex-col">
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                dividend.is_received
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-yellow-500/20 text-yellow-400'
                              }`}>
                                <DollarSign className="w-3.5 h-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-white truncate">
                                  {(dividend.asset?.ticker?.includes('.KS') || dividend.asset?.ticker?.includes('.KQ'))
                                    ? (dividend.asset?.name || 'N/A')
                                    : (dividend.asset?.ticker || 'N/A')}
                                </p>
                                <p className="text-[10px] text-slate-400 truncate">
                                  {(dividend.asset?.ticker?.includes('.KS') || dividend.asset?.ticker?.includes('.KQ'))
                                    ? (dividend.asset?.ticker || '')
                                    : (dividend.asset?.name || 'N/A')}
                                </p>
                              </div>
                            </div>
                            <p className="text-sm font-bold text-green-400 mb-1">
                              ₩{amountKRW.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                            </p>
                            {dividend.currency === 'USD' && (
                              <p className="text-[10px] text-slate-500">
                                ${dividend.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                            )}
                            <div className="flex items-center gap-1 mt-auto pt-2 border-t border-slate-600/40">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                dividend.is_received
                                  ? 'bg-green-500/15 text-green-400'
                                  : 'bg-yellow-500/15 text-yellow-400'
                              }`}>
                                {dividend.is_received ? '수령' : '예정'}
                              </span>
                              <div className="flex-1" />
                              <button
                                type="button"
                                onClick={() => handleEditDividend(dividend)}
                                className="text-slate-500 hover:text-blue-400 transition-colors p-0.5"
                                title="수정"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteDividend(dividend, e)}
                                className="text-slate-500 hover:text-red-400 transition-colors p-0.5"
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
                    <p className="text-xs text-slate-500 text-right mt-2">최근 6건 표시 중 (전체 {dividends.length}건)</p>
                  )}
                </div>
              ) : (
                /* ===== 리스트 뷰 ===== */
                <div className="space-y-3">
                  {dividends.slice(0, 3).map((dividend) => (
                  <div
                    key={dividend.id}
                    className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-green-500 transition-all duration-300 animate-[fadeSlideIn_0.3s_ease-out]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
                          <DollarSign className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold text-white">
                              {dividend.asset?.name || 'N/A'}
                            </h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              dividend.is_received 
                                ? 'bg-green-500/20 text-green-300' 
                                : 'bg-yellow-500/20 text-yellow-300'
                            }`}>
                              {dividend.is_received ? '수령완료' : '수령예정'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-400 mt-1">
                            {dividend.asset?.ticker || 'N/A'} • {new Date(dividend.date).toLocaleDateString('ko-KR')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-xl font-bold text-green-400">
                            ₩{(dividend.currency === 'USD' 
                              ? dividend.amount * exchangeRate 
                              : dividend.amount
                            ).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                          </p>
                          {dividend.tax > 0 && (
                            <p className="text-xs text-slate-500">
                              세금: ₩{(dividend.currency === 'USD' 
                                ? dividend.tax * exchangeRate 
                                : dividend.tax
                              ).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                            </p>
                          )}
                          {dividend.currency === 'USD' && (
                            <p className="text-xs text-slate-500 mt-1">
                              (USD ${dividend.amount.toLocaleString()})
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleEditDividend(dividend)}
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                          title="수정"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteDividend(dividend, e)}
                          className="text-red-400 hover:text-red-300 transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {dividend.notes && (
                      <p className="text-sm text-slate-400 mt-3 pl-16">{dividend.notes}</p>
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
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={handleCancelEdit}
        >
          <div 
            className="bg-slate-800 rounded-xl p-6 border border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">배당금 기록</h3>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <label className="block text-sm font-medium mb-2">계좌 *</label>
                <select
                  value={formData.accountId}
                  onChange={(e) => setFormData({ ...formData, accountId: Number(e.target.value) })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value={0}>계좌를 선택하세요</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      🏦 {account.name} ({account.broker})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">자산 *</label>
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
                          // 선택된 계좌에 속한 자산만 필터링
                          const belongsToAccount = asset.holdings?.some(h => h.account_id === formData.accountId);
                          if (!belongsToAccount) return false;
                          
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
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                    required={formData.assetId === 0}
                  />
                  {showAssetDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg max-h-60 overflow-y-auto shadow-lg">
                      {assets
                        .filter(asset => {
                          // 선택된 계좌에 속한 자산만 필터링
                          const belongsToAccount = asset.holdings?.some(h => h.account_id === formData.accountId);
                          if (!belongsToAccount) return false;
                          
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
                            className="w-full text-left px-4 py-2 hover:bg-slate-600 transition-colors text-sm"
                          >
                            <span className="font-medium text-green-400">{asset.ticker}</span>
                            <span className="text-slate-300"> - {asset.name}</span>
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
                        <div className="px-4 py-3 text-sm text-slate-400 text-center">
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
                <label className="block text-sm font-medium mb-2">지급일 *</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">배당금액 *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">세금</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.tax}
                  onChange={(e) => setFormData({ ...formData, tax: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">통화</label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="USD">USD</option>
                  <option value="KRW">KRW</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">수령 여부</label>
                <select
                  value={formData.isReceived ? 'true' : 'false'}
                  onChange={(e) => setFormData({ ...formData, isReceived: e.target.value === 'true' })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="true">수령 완료</option>
                  <option value="false">수령 예정</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">메모</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="추가 메모"
                rows={2}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors"
              >
                {editingDividend ? '수정' : '기록'}
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors"
              >
                취소
              </button>
            </div>
          </form>
          </div>
        </div>
      )}

      {/* 전체 배당금 모달 */}
      {showAllDividends && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAllDividends(false)}
        >
          <div
            className="relative bg-slate-800 rounded-xl border border-slate-700 max-w-3xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-700">
              <h3 className="text-lg font-semibold text-white">배당금 전체 내역 ({dividends.length}건)</h3>
              <button
                onClick={() => setShowAllDividends(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto p-6 pt-4 space-y-3">
              {dividends.map((dividend) => (
                <div
                  key={dividend.id}
                  className="bg-slate-700/50 rounded-lg p-4 border border-slate-600/60 hover:border-green-500/50 transition-all duration-200"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
                        <DollarSign className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-white">
                            {dividend.asset?.name || 'N/A'}
                          </h4>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            dividend.is_received
                              ? 'bg-green-500/20 text-green-300'
                              : 'bg-yellow-500/20 text-yellow-300'
                          }`}>
                            {dividend.is_received ? '수령완료' : '수령예정'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-400 mt-0.5">
                          {dividend.asset?.ticker || 'N/A'} • {new Date(dividend.date).toLocaleDateString('ko-KR')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-lg font-bold text-green-400">
                          ₩{(dividend.currency === 'USD'
                            ? dividend.amount * exchangeRate
                            : dividend.amount
                          ).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                        </p>
                        {dividend.currency === 'USD' && (
                          <p className="text-xs text-slate-500">
                            (USD ${dividend.amount.toLocaleString()})
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setShowAllDividends(false); handleEditDividend(dividend); }}
                        className="text-blue-400 hover:text-blue-300 transition-colors"
                        title="수정"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { setShowAllDividends(false); handleDeleteDividend(dividend, e); }}
                        className="text-red-400 hover:text-red-300 transition-colors"
                        title="삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {dividend.notes && (
                    <p className="text-sm text-slate-400 mt-2 pl-14">{dividend.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="bg-slate-800 rounded-xl p-6 border border-slate-700 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-2">배당금 삭제</h3>
            <p className="text-slate-300 mb-6">
              {`${deleteTarget.asset?.name || ''} 배당금 (${new Date(deleteTarget.date).toLocaleDateString('ko-KR')})을 삭제하시겠습니까?`}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmDeleteDividend}
                disabled={deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
              >
                {deleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
