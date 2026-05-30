import { useState, useEffect, useMemo } from 'react';
import { apiClient } from '../api/client';
import { Account, Asset, Transaction, Holding, RealizedPnL } from '../types/models';
import { Plus, ArrowUpCircle, ArrowDownCircle, TrendingUp, TrendingDown, History, X, Search, Info } from 'lucide-react';
import { calculateFee, roundFee } from '../utils/fees';

interface TransactionManagerProps {
  selectedAccountId?: number;
  onAccountChange?: (accountId: number) => void;
}

type ViewTab = 'history' | 'pnl' | 'holdings';

export default function TransactionManager({ selectedAccountId = 0, onAccountChange }: TransactionManagerProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pnls, setPnls] = useState<RealizedPnL[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<number>(selectedAccountId);
  const [viewTab, setViewTab] = useState<ViewTab>('history');
  const [assetSearch, setAssetSearch] = useState('');
  const [showAssetDropdown, setShowAssetDropdown] = useState(false);
  // 보유 종목 현재 시세
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  // 평단가/수량 수정 중인 holding id
  const [editingHoldingId, setEditingHoldingId] = useState<number | null>(null);
  const [editHoldingField, setEditHoldingField] = useState<'price' | 'quantity' | null>(null);
  const [editHoldingPrice, setEditHoldingPrice] = useState('');
  const [editHoldingQty, setEditHoldingQty] = useState('');
  const [holdingSearch, setHoldingSearch] = useState('');

  const [formData, setFormData] = useState({
    accountId: 0,
    assetId: 0,
    type: 'Buy' as 'Buy' | 'Sell',
    date: new Date().toISOString().split('T')[0],
    price: '',
    quantity: '',
    fee: '',
    notes: '',
  });
  // 수수료 자동 계산 모드 (사용자가 직접 입력하면 false)
  const [feeAutoMode, setFeeAutoMode] = useState(true);
  // 매도가 자동 채움 모드 (사용자가 직접 입력하면 false)
  const [sellPriceAutoMode, setSellPriceAutoMode] = useState(true);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedAccountId > 0 && selectedAccountId !== selectedAccount) {
      setSelectedAccount(selectedAccountId);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (selectedAccount > 0) {
      reloadAccountData(selectedAccount);
      setFormData((prev) => ({ ...prev, accountId: selectedAccount }));
    }
  }, [selectedAccount]);

  // 매도가 자동 채움: 매도 종목 선택 시 현재 시세 가져오기
  useEffect(() => {
    if (!sellPriceAutoMode) return;
    if (formData.type !== 'Sell' || !formData.assetId) return;
    if (formData.price !== '') return; // 이미 가격이 있으면 스킵

    const asset = assets.find((a) => a.id === formData.assetId);
    if (!asset || !asset.ticker) return;

    let cancelled = false;
    apiClient.GetCurrentPrice(asset.ticker).then((res: any) => {
      if (cancelled) return;
      const fetchedPrice = res?.price;
      if (fetchedPrice && fetchedPrice > 0) {
        setFormData((prev) => (prev.price === '' ? { ...prev, price: String(fetchedPrice) } : prev));
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [formData.assetId, formData.type, sellPriceAutoMode, assets]);

  // 수수료 자동 계산: 가격/수량/유형/계좌 통화가 바뀌면 자동 갱신 (사용자가 직접 입력했다면 스킵)
  useEffect(() => {
    if (!feeAutoMode) return;
    const price = parseFloat(formData.price);
    const qty = parseFloat(formData.quantity);
    if (!price || !qty) {
      setFormData((prev) => (prev.fee === '' ? prev : { ...prev, fee: '' }));
      return;
    }
    const currency = accounts.find((a) => a.id === formData.accountId)?.currency || 'KRW';
    const breakdown = calculateFee(price, qty, currency, formData.type);
    const rounded = roundFee(breakdown.total, currency);
    setFormData((prev) => {
      const newFee = rounded > 0 ? String(rounded) : '';
      return prev.fee === newFee ? prev : { ...prev, fee: newFee };
    });
  }, [formData.price, formData.quantity, formData.type, formData.accountId, feeAutoMode, accounts]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [accountsData, assetsData] = await Promise.all([
        apiClient.GetAllAccounts(),
        apiClient.GetAllAssets(),
      ]);
      const accountsList = accountsData as Account[];
      setAccounts(accountsList);
      setAssets(assetsData as Asset[]);

      if (accountsList.length > 0) {
        const target = selectedAccountId > 0 ? selectedAccountId : accountsList[0].id;
        setSelectedAccount(target);
        onAccountChange?.(target);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const reloadAccountData = async (accountId: number) => {
    try {
      const [txData, holdingsData, pnlData] = await Promise.all([
        apiClient.GetTransactionsByAccount(accountId),
        apiClient.GetHoldingsByAccount(accountId),
        apiClient.GetRealizedPnLByAccount(accountId),
      ]);
      setTransactions((txData as Transaction[]) || []);
      const loadedHoldings = (holdingsData as Holding[]) || [];
      setHoldings(loadedHoldings);
      setPnls((pnlData as RealizedPnL[]) || []);

      // 보유 종목 시세 로드
      const tickers = loadedHoldings
        .map((h) => h.asset?.ticker || '')
        .filter((t) => t !== '');
      if (tickers.length > 0) {
        setPriceLoading(true);
        apiClient.GetCurrentPrices(tickers).then((res: any) => {
          const prices: Record<string, number> = {};
          if (res && typeof res === 'object') {
            Object.entries(res).forEach(([t, v]) => {
              const price = typeof v === 'number' ? v : (v as any)?.price;
              if (price) prices[t] = price;
            });
          }
          setPriceMap(prices);
        }).catch(() => {}).finally(() => setPriceLoading(false));
      } else {
        setPriceMap({});
      }
    } catch (err) {
      console.error('Failed to reload account data:', err);
    }
  };

  const handleUpdateHolding = async (holdingId: number, field: 'price' | 'quantity', rawValue: string) => {
    const newValue = parseFloat(rawValue);
    if (Number.isNaN(newValue) || newValue <= 0) {
      setError(field === 'price' ? '유효한 평단가를 입력하세요.' : '유효한 수량을 입력하세요.');
      return;
    }
    try {
      const holding = holdings.find((h) => h.id === holdingId);
      if (!holding) return;
      setError(null);
      const newQty = field === 'quantity' ? newValue : holding.quantity;
      const newPrice = field === 'price' ? newValue : holding.average_price;
      await apiClient.UpdateHolding(holdingId, newQty, newPrice);
      await reloadAccountData(selectedAccount);
      setEditingHoldingId(null);
      setEditHoldingField(null);
      setEditHoldingPrice('');
      setEditHoldingQty('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '보유 수정에 실패했습니다.');
    }
  };

  const openSellForm = (assetId: number) => {
    const asset = assets.find((a) => a.id === assetId);
    const holding = holdings.find((h) => h.asset_id === assetId);
    if (!asset || !holding) return;
    resetForm();
    setFormData({
      accountId: selectedAccount,
      assetId,
      type: 'Sell',
      date: new Date().toISOString().split('T')[0],
      price: '',
      quantity: String(holding.quantity),
      fee: '',
      notes: '',
    });
    setSellPriceAutoMode(true);
    setFeeAutoMode(true);
    setShowForm(true);
  };

  const currentAccount = accounts.find((a) => a.id === selectedAccount);
  const currencySymbol = currentAccount?.currency === 'USD' ? '$' : '₩';

  // 매도 시 자동으로 보유 종목만 표시
  const formAssetOptions = useMemo(() => {
    if (formData.type === 'Sell') {
      const heldIds = new Set(holdings.filter((h) => h.quantity > 0).map((h) => h.asset_id));
      return assets.filter((a) => heldIds.has(a.id));
    }
    return assets;
  }, [assets, holdings, formData.type]);

  const filteredAssetOptions = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    if (!q) return formAssetOptions.slice(0, 50);
    return formAssetOptions
      .filter((a) => a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [formAssetOptions, assetSearch]);

  const selectedAsset = assets.find((a) => a.id === formData.assetId);
  const selectedHolding = holdings.find((h) => h.asset_id === formData.assetId);

  // 매도 시 실현손익 미리보기
  const pnlPreview = useMemo(() => {
    if (formData.type !== 'Sell' || !selectedHolding) return null;
    const sellPrice = parseFloat(formData.price);
    const qty = parseFloat(formData.quantity);
    const fee = parseFloat(formData.fee || '0');
    if (!sellPrice || !qty) return null;

    const buyAvg = selectedHolding.average_price;
    const profit = (sellPrice - buyAvg) * qty - fee;
    const costBasis = buyAvg * qty;
    const profitPercent = costBasis > 0 ? (profit / costBasis) * 100 : 0;
    return { buyAvg, profit, profitPercent, costBasis };
  }, [formData, selectedHolding]);

  const resetForm = () => {
    setFormData({
      accountId: selectedAccount,
      assetId: 0,
      type: 'Buy',
      date: new Date().toISOString().split('T')[0],
      price: '',
      quantity: '',
      fee: '',
      notes: '',
    });
    setAssetSearch('');
    setShowAssetDropdown(false);
    setFeeAutoMode(true);
    setSellPriceAutoMode(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.assetId === 0) {
      setError('종목을 선택하세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.CreateTransaction(
        formData.accountId,
        formData.assetId,
        formData.type,
        formData.date,
        parseFloat(formData.price),
        parseFloat(formData.quantity),
        parseFloat(formData.fee || '0'),
        formData.notes,
      );
      resetForm();
      setShowForm(false);
      await reloadAccountData(selectedAccount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '거래 기록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatNumber = (n: number, fractionDigits = 0) =>
    n.toLocaleString('ko-KR', { maximumFractionDigits: fractionDigits });

  const getCurrencyFromTicker = (ticker: string): string => {
    const upper = ticker.toUpperCase();
    if (upper.endsWith('.KS') || upper.endsWith('.KQ')) return 'KRW';
    return 'USD';
  };

  const formatMoney = (value: number, currency: string) => {
    const symbol = currency === 'USD' ? '$' : '₩';
    if (currency === 'USD') return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${symbol}${Math.round(value).toLocaleString('ko-KR')}`;
  };

  const previewCurrency = getCurrencyFromTicker(selectedAsset?.ticker || '');

  // 실현 손익 합계 (통화별) - 티커 기준으로 통화 재정의
  const pnlSummary = useMemo(() => {
    const summary: Record<string, { total: number; count: number; wins: number }> = {};
    pnls.forEach((p) => {
      const cur = getCurrencyFromTicker(p.asset?.ticker || '');
      if (!summary[cur]) summary[cur] = { total: 0, count: 0, wins: 0 };
      summary[cur].total += p.profit;
      summary[cur].count += 1;
      if (p.profit > 0) summary[cur].wins += 1;
    });
    return summary;
  }, [pnls]);

  if (loading) return <div className="text-center py-12 text-slate-400">로딩 중...</div>;

  if (accounts.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <TrendingUp className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <p className="text-lg">먼저 계좌를 등록해주세요.</p>
      </div>
    );
  }

  return (
    <div>
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-white">매매 관리</h2>
          <select
            value={selectedAccount}
            onChange={(e) => {
              const id = Number(e.target.value);
              setSelectedAccount(id);
              onAccountChange?.(id);
            }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.broker} ({a.name})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5" />
          거래 기록
        </button>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">{error}</div>
      )}

      {/* 실현 손익 요약 카드 */}
      {Object.keys(pnlSummary).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {Object.entries(pnlSummary).map(([cur, s]) => {
            const isProfit = s.total >= 0;
            const winRate = s.count > 0 ? ((s.wins / s.count) * 100).toFixed(0) : '0';
            return (
              <div
                key={cur}
                className={`rounded-xl p-4 border ${
                  isProfit ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
                }`}
              >
                <p className="text-xs text-slate-400 mb-1">실현 손익 ({cur})</p>
                <p className={`text-2xl font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isProfit ? '+' : ''}
                  {formatMoney(s.total, cur)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {s.count}건 매도 · 승률 {winRate}%
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-2 mb-4 border-b border-slate-700">
        <button
          onClick={() => setViewTab('history')}
          className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            viewTab === 'history'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <History className="w-4 h-4" />
          거래 내역 ({transactions.length})
        </button>
        <button
          onClick={() => setViewTab('pnl')}
          className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            viewTab === 'pnl'
              ? 'text-white border-b-2 border-emerald-500'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          실현 손익 ({pnls.length})
        </button>
        <button
          onClick={() => setViewTab('holdings')}
          className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            viewTab === 'holdings'
              ? 'text-white border-b-2 border-purple-500'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          보유 현황 ({holdings.length})
        </button>
      </div>

      {/* 거래 내역 */}
      {viewTab === 'history' && (
        <div className="space-y-3">
          {transactions.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>거래 내역이 없습니다.</p>
              <p className="text-sm mt-1 text-slate-500">'거래 기록' 버튼으로 매수/매도를 등록하세요.</p>
            </div>
          ) : (
            transactions.map((tx) => {
              const isBuy = tx.type === 'Buy';
              const total = tx.price * tx.quantity + (isBuy ? tx.fee : -tx.fee);
              const txCurrency = getCurrencyFromTicker(tx.asset?.ticker || '');
              return (
                <div
                  key={tx.id}
                  className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-blue-500/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          isBuy
                            ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                            : 'bg-gradient-to-br from-red-500 to-orange-500'
                        }`}
                      >
                        {isBuy ? <ArrowDownCircle className="w-5 h-5" /> : <ArrowUpCircle className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-semibold text-white truncate">
                            {tx.asset?.name || tx.asset?.ticker || `Asset #${tx.asset_id}`}
                          </h3>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                              isBuy ? 'bg-blue-500/20 text-blue-300' : 'bg-red-500/20 text-red-300'
                            }`}
                          >
                            {isBuy ? '매수' : '매도'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          {tx.asset?.ticker} · {new Date(tx.date).toLocaleDateString('ko-KR')}
                        </p>
                        <p className="text-xs text-slate-300 mt-0.5">
                          <span className="text-slate-500">{isBuy ? '매수가' : '매도가'}</span>{' '}
                          <span className="font-medium">{formatMoney(tx.price, txCurrency)}</span>
                          <span className="text-slate-500"> × </span>
                          <span className="font-medium">{formatNumber(tx.quantity, 4)}주</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-base font-bold ${isBuy ? 'text-blue-400' : 'text-red-400'}`}>
                        {formatMoney(total, txCurrency)}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {isBuy ? '총 지불액' : '실수령액'}
                      </p>
                      {tx.fee > 0 && (
                        <p className="text-[11px] text-slate-500 mt-0.5">수수료 {formatMoney(tx.fee, txCurrency)}</p>
                      )}
                    </div>
                  </div>
                  {tx.notes && <p className="text-xs text-slate-400 mt-2 pl-13 ml-13">{tx.notes}</p>}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 실현 손익 */}
      {viewTab === 'pnl' && (
        <div className="space-y-3">
          {pnls.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>실현 손익 내역이 없습니다.</p>
              <p className="text-sm mt-1 text-slate-500">매도 거래가 기록되면 자동으로 표시됩니다.</p>
            </div>
          ) : (
            pnls.map((p) => {
              const isProfit = p.profit >= 0;
              const pnlCurrency = getCurrencyFromTicker(p.asset?.ticker || '');
              return (
                <div
                  key={p.id}
                  className={`rounded-lg p-4 border transition-colors ${
                    isProfit
                      ? 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40'
                      : 'bg-red-500/5 border-red-500/20 hover:border-red-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          isProfit
                            ? 'bg-gradient-to-br from-emerald-500 to-teal-500'
                            : 'bg-gradient-to-br from-red-500 to-pink-500'
                        }`}
                      >
                        {isProfit ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-white truncate">
                          {p.asset?.name || p.asset?.ticker || `Asset #${p.asset_id}`}
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {p.asset?.ticker} · {new Date(p.date).toLocaleDateString('ko-KR')} · {formatNumber(p.quantity, 4)}주
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          평단 {formatMoney(p.buy_avg_price, pnlCurrency)} → 매도 {formatMoney(p.sell_price, pnlCurrency)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-lg font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}
                        {formatMoney(p.profit, pnlCurrency)}
                      </p>
                      <p className={`text-xs ${isProfit ? 'text-emerald-300' : 'text-red-300'}`}>
                        {isProfit ? '+' : ''}
                        {p.profit_percent.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 보유 현황 */}
      {viewTab === 'holdings' && (
        <div>
          {priceLoading && (
            <div className="text-xs text-slate-500 mb-3 flex items-center gap-2">
              <div className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
              시세 로딩 중...
            </div>
          )}
          {holdings.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>보유 종목이 없습니다.</p>
              <p className="text-sm mt-1 text-slate-500">매매 기록을 등록하거나 주식/ETF 탭에서 보유를 등록하세요.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* 종목 검색 */}
              <div className="relative">
                <input
                  type="text"
                  value={holdingSearch}
                  onChange={(e) => setHoldingSearch(e.target.value)}
                  placeholder="종목 검색 (티커 또는 종목명)"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                {holdingSearch && (
                  <button
                    onClick={() => setHoldingSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white px-1"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* 헤더 */}
              <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-3 px-3 py-2 text-xs text-slate-500 font-medium border-b border-slate-700">
                <span>종목</span>
                <span className="text-right">수량</span>
                <span className="text-right">평단가</span>
                <span className="text-right">현재가</span>
                <span className="text-right">평가금</span>
                <span className="text-right">손익</span>
                <span className="text-right">액션</span>
              </div>

              {/* 보유 목록 - 평가금 내림차순 */}
              {(() => {
                const filtered = [...holdings]
                  .filter((h) => {
                    const q = holdingSearch.trim().toLowerCase();
                    if (!q) return true;
                    const name = (h.asset?.name || '').toLowerCase();
                    const ticker = (h.asset?.ticker || '').toLowerCase();
                    return name.includes(q) || ticker.includes(q);
                  })
                  .sort((a, b) => {
                    const aPrice = priceMap[a.asset?.ticker || ''] || 0;
                    const bPrice = priceMap[b.asset?.ticker || ''] || 0;
                    return bPrice * b.quantity - aPrice * a.quantity;
                  });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      검색 결과가 없습니다.
                    </div>
                  );
                }

                return filtered.map((h) => {
                  const ticker = h.asset?.ticker || '';
                  const curPrice = priceMap[ticker];
                  const hasPrice = curPrice !== undefined && curPrice > 0;
                  const marketValue = hasPrice ? curPrice * h.quantity : 0;
                  const totalCost = h.average_price * h.quantity;
                  const profit = marketValue - totalCost;
                  const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;
                  const isProfit = profit >= 0;
                  const currency = getCurrencyFromTicker(ticker);

                  return (
                    <div
                      key={h.id}
                      className="bg-slate-800 rounded-lg p-3 sm:px-3 sm:py-2 border border-slate-700 hover:border-purple-500/40 transition-colors"
                    >
                      {/* 모바일 카드 */}
                      <div className="sm:hidden space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">
                              {h.asset?.name || ticker}
                            </p>
                            <p className="text-xs text-slate-400">{ticker}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasPrice && (
                              <p className={`text-sm font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isProfit ? '+' : ''}
                                {formatMoney(profit, currency)}
                              </p>
                            )}
                            <button
                              onClick={() => openSellForm(h.asset_id)}
                              className="px-2 py-1 bg-red-600/80 hover:bg-red-600 rounded text-xs"
                            >
                              매도
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-slate-500">수량</span>
                            {editingHoldingId === h.id && editHoldingField === 'quantity' ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="any"
                                  autoFocus
                                  value={editHoldingQty}
                                  onChange={(e) => setEditHoldingQty(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handleUpdateHolding(h.id, 'quantity', editHoldingQty);
                                    } else if (e.key === 'Escape') {
                                      setEditingHoldingId(null);
                                      setEditHoldingField(null);
                                    }
                                  }}
                                  className="w-20 bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-xs text-right"
                                />
                                <button
                                  onClick={() => handleUpdateHolding(h.id, 'quantity', editHoldingQty)}
                                  className="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 rounded text-[10px] text-white font-medium leading-none"
                                >
                                  저장
                                </button>
                                <button
                                  onClick={() => { setEditingHoldingId(null); setEditHoldingField(null); }}
                                  className="px-1.5 py-0.5 bg-slate-600 hover:bg-slate-500 rounded text-[10px] text-white font-medium leading-none"
                                >
                                  취소
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingHoldingId(h.id);
                                  setEditHoldingField('quantity');
                                  setEditHoldingQty(String(h.quantity));
                                }}
                                className="text-slate-300 hover:text-white underline decoration-slate-600 underline-offset-2"
                              >
                                {formatNumber(h.quantity, 4)}주
                              </button>
                            )}
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">평단가</span>
                            {editingHoldingId === h.id && editHoldingField === 'price' ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="any"
                                  autoFocus
                                  value={editHoldingPrice}
                                  onChange={(e) => setEditHoldingPrice(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handleUpdateHolding(h.id, 'price', editHoldingPrice);
                                    } else if (e.key === 'Escape') {
                                      setEditingHoldingId(null);
                                      setEditHoldingField(null);
                                    }
                                  }}
                                  className="w-20 bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-xs text-right"
                                />
                                <button
                                  onClick={() => handleUpdateHolding(h.id, 'price', editHoldingPrice)}
                                  className="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 rounded text-[10px] text-white font-medium leading-none"
                                >
                                  저장
                                </button>
                                <button
                                  onClick={() => { setEditingHoldingId(null); setEditHoldingField(null); }}
                                  className="px-1.5 py-0.5 bg-slate-600 hover:bg-slate-500 rounded text-[10px] text-white font-medium leading-none"
                                >
                                  취소
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingHoldingId(h.id);
                                  setEditHoldingField('price');
                                  setEditHoldingPrice(String(h.average_price));
                                }}
                                className="text-slate-300 hover:text-white underline decoration-slate-600 underline-offset-2"
                              >
                                {formatMoney(h.average_price, currency)}
                              </button>
                            )}
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">현재가</span>
                            <span className="text-slate-300">
                              {hasPrice ? formatMoney(curPrice, currency) : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">평가금</span>
                            <span className="text-slate-300">
                              {hasPrice ? formatMoney(marketValue, currency) : '—'}
                            </span>
                          </div>
                        </div>
                        {hasPrice && (
                          <p className={`text-xs ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isProfit ? '+' : ''}{profitPercent.toFixed(2)}%
                          </p>
                        )}
                      </div>

                      {/* 데스크톱 테이블 */}
                      <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-3 items-center text-sm">
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{h.asset?.name || ticker}</p>
                          <p className="text-xs text-slate-500">{ticker}</p>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          {editingHoldingId === h.id && editHoldingField === 'quantity' ? (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                step="any"
                                autoFocus
                                value={editHoldingQty}
                                onChange={(e) => setEditHoldingQty(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleUpdateHolding(h.id, 'quantity', editHoldingQty);
                                  } else if (e.key === 'Escape') {
                                    setEditingHoldingId(null);
                                    setEditHoldingField(null);
                                  }
                                }}
                                className="w-20 bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-xs text-right"
                              />
                              <button
                                onClick={() => handleUpdateHolding(h.id, 'quantity', editHoldingQty)}
                                className="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 rounded text-[10px] text-white font-medium leading-none"
                              >
                                저장
                              </button>
                              <button
                                onClick={() => { setEditingHoldingId(null); setEditHoldingField(null); }}
                                className="px-1.5 py-0.5 bg-slate-600 hover:bg-slate-500 rounded text-[10px] text-white font-medium leading-none"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingHoldingId(h.id);
                                setEditHoldingField('quantity');
                                setEditHoldingQty(String(h.quantity));
                              }}
                              className="text-slate-300 hover:text-white underline decoration-slate-600 underline-offset-2"
                            >
                              {formatNumber(h.quantity, 4)}주
                            </button>
                          )}
                        </div>
                        <div className="text-right whitespace-nowrap">
                          {editingHoldingId === h.id && editHoldingField === 'price' ? (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                step="any"
                                autoFocus
                                value={editHoldingPrice}
                                onChange={(e) => setEditHoldingPrice(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleUpdateHolding(h.id, 'price', editHoldingPrice);
                                  } else if (e.key === 'Escape') {
                                    setEditingHoldingId(null);
                                    setEditHoldingField(null);
                                  }
                                }}
                                className="w-20 bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-xs text-right"
                              />
                              <button
                                onClick={() => handleUpdateHolding(h.id, 'price', editHoldingPrice)}
                                className="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 rounded text-[10px] text-white font-medium leading-none"
                              >
                                저장
                              </button>
                              <button
                                onClick={() => { setEditingHoldingId(null); setEditHoldingField(null); }}
                                className="px-1.5 py-0.5 bg-slate-600 hover:bg-slate-500 rounded text-[10px] text-white font-medium leading-none"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingHoldingId(h.id);
                                setEditHoldingField('price');
                                setEditHoldingPrice(String(h.average_price));
                              }}
                              className="text-slate-300 hover:text-white underline decoration-slate-600 underline-offset-2"
                            >
                              {formatMoney(h.average_price, currency)}
                            </button>
                          )}
                        </div>
                        <p className="text-slate-300 text-right whitespace-nowrap">
                          {hasPrice ? formatMoney(curPrice, currency) : '—'}
                        </p>
                        <p className="text-white font-medium text-right whitespace-nowrap">
                          {hasPrice ? formatMoney(marketValue, currency) : '—'}
                        </p>
                        <div className="text-right whitespace-nowrap">
                          {hasPrice ? (
                            <>
                              <p className={`font-medium ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isProfit ? '+' : ''}{formatMoney(profit, currency)}
                              </p>
                              <p className={`text-xs ${isProfit ? 'text-emerald-300' : 'text-red-300'}`}>
                                {isProfit ? '+' : ''}{profitPercent.toFixed(2)}%
                              </p>
                            </>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <button
                            onClick={() => openSellForm(h.asset_id)}
                            className="px-2 py-1 bg-red-600/80 hover:bg-red-600 rounded text-xs transition-colors"
                          >
                            매도
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              )()}

              {/* 합계 - 통화별 분리 */}
              {(() => {
                const byCurrency: Record<string, { cost: number; value: number }> = {};
                holdings.forEach((h) => {
                  const cur = getCurrencyFromTicker(h.asset?.ticker || '');
                  const p = priceMap[h.asset?.ticker || ''];
                  if (!byCurrency[cur]) byCurrency[cur] = { cost: 0, value: 0 };
                  byCurrency[cur].cost += h.average_price * h.quantity;
                  byCurrency[cur].value += (p ? p * h.quantity : 0);
                });

                return (
                  <div className="mt-4 bg-slate-800/80 rounded-lg p-4 border border-slate-700 space-y-3">
                    {Object.entries(byCurrency).map(([cur, { cost, value }]) => {
                      const profit = value - cost;
                      const isProfit = profit >= 0;
                      return (
                        <div key={cur} className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex gap-6 flex-wrap">
                            <div>
                              <p className="text-xs text-slate-500">총 매입원가 ({cur})</p>
                              <p className="text-base font-bold text-white">{formatMoney(cost, cur)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">총 평가금 ({cur})</p>
                              <p className="text-base font-bold text-white">{formatMoney(value, cur)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">총 손익 ({cur})</p>
                              <p className={`text-base font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isProfit ? '+' : ''}{formatMoney(profit, cur)}
                              </p>
                            </div>
                          </div>
                          <div className={`text-lg font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                            {cost > 0 ? `${isProfit ? '+' : ''}${((profit / cost) * 100).toFixed(2)}%` : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* 거래 기록 모달 */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !submitting && setShowForm(false)}
        >
          <div
            className="bg-slate-800 rounded-xl p-6 w-full max-w-2xl border border-slate-700 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-white">거래 기록</h3>
              <button
                onClick={() => setShowForm(false)}
                disabled={submitting}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 매수/매도 토글 */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSellPriceAutoMode(true);
                    setFormData({ ...formData, type: 'Buy', assetId: 0, price: '' });
                  }}
                  className={`flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                    formData.type === 'Buy'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  <ArrowDownCircle className="w-5 h-5" />
                  매수
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSellPriceAutoMode(true);
                    setFormData({ ...formData, type: 'Sell', assetId: 0, price: '' });
                  }}
                  className={`flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                    formData.type === 'Sell'
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  <ArrowUpCircle className="w-5 h-5" />
                  매도
                </button>
              </div>

              {/* 종목 검색 */}
              <div className="relative">
                <label className="block text-sm font-medium mb-2">
                  종목 *
                  {formData.type === 'Sell' && (
                    <span className="text-xs text-slate-500 ml-2">(보유 종목만 표시)</span>
                  )}
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={selectedAsset ? `${selectedAsset.ticker} - ${selectedAsset.name}` : assetSearch}
                    onChange={(e) => {
                      setAssetSearch(e.target.value);
                      setFormData({ ...formData, assetId: 0 });
                      setShowAssetDropdown(true);
                    }}
                    onFocus={() => setShowAssetDropdown(true)}
                    placeholder={formData.type === 'Sell' ? '보유 종목 선택...' : '종목 검색...'}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                {showAssetDropdown && filteredAssetOptions.length > 0 && !selectedAsset && (
                  <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg max-h-48 overflow-y-auto shadow-lg">
                    {filteredAssetOptions.map((a) => {
                      const h = holdings.find((x) => x.asset_id === a.id);
                      return (
                        <button
                          type="button"
                          key={a.id}
                          onClick={() => {
                            setFormData({ ...formData, assetId: a.id });
                            setShowAssetDropdown(false);
                            setAssetSearch('');
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-600 text-sm flex items-center justify-between"
                        >
                          <span className="text-white">
                            <span className="font-medium">{a.ticker}</span> · {a.name}
                          </span>
                          {h && (
                            <span className="text-xs text-slate-400">
                              {formatNumber(h.quantity, 4)}주 · 평단 {formatMoney(h.average_price, getCurrencyFromTicker(a.ticker))}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {formData.type === 'Sell' && selectedHolding && (
                  <p className="text-xs text-slate-400 mt-1">
                    보유 수량: {formatNumber(selectedHolding.quantity, 4)}주 · 평단:{' '}
                    {formatMoney(selectedHolding.average_price, getCurrencyFromTicker(selectedAsset?.ticker || ''))}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-2">거래일 *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">
                      {formData.type === 'Sell' ? '주당 매도가' : '주당 매수가'} ({currencySymbol}) *
                      {formData.type === 'Sell' && formData.price && sellPriceAutoMode && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">시세</span>
                      )}
                    </label>
                  </div>
                  <input
                    type="number"
                    step="any"
                    value={formData.price}
                    onChange={(e) => {
                      setSellPriceAutoMode(false);
                      setFormData({ ...formData, price: e.target.value });
                    }}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="1주당 가격"
                    required
                  />
                  {formData.type === 'Sell' && !sellPriceAutoMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setSellPriceAutoMode(true);
                        setFormData({ ...formData, price: '' });
                      }}
                      className="text-[10px] text-blue-400 hover:text-blue-300 mt-1"
                    >
                      현재 시세 다시 가져오기
                    </button>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">수량 *</label>
                  <input
                    type="number"
                    step="any"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                    required
                    max={formData.type === 'Sell' && selectedHolding ? selectedHolding.quantity : undefined}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">
                      수수료 ({currencySymbol})
                      {feeAutoMode ? (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">자동</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setFeeAutoMode(true)}
                          className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-600 text-slate-300 hover:bg-slate-500"
                        >
                          자동 복귀
                        </button>
                      )}
                    </label>
                  </div>
                  <input
                    type="number"
                    step="any"
                    value={formData.fee}
                    onChange={(e) => {
                      setFeeAutoMode(false);
                      setFormData({ ...formData, fee: e.target.value });
                    }}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                  />
                  {(() => {
                    const p = parseFloat(formData.price);
                    const q = parseFloat(formData.quantity);
                    if (!p || !q) return null;
                    const cur = currentAccount?.currency || 'KRW';
                    const bd = calculateFee(p, q, cur, formData.type);
                    if (bd.total <= 0) return null;
                    return (
                      <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        {bd.rateDescription}
                      </p>
                    );
                  })()}
                </div>
              </div>

              {/* 거래 총액 미리보기 */}
              {(() => {
                const p = parseFloat(formData.price);
                const q = parseFloat(formData.quantity);
                const f = parseFloat(formData.fee || '0');
                if (!p || !q) return null;
                const gross = p * q;
                const net = formData.type === 'Buy' ? gross + f : gross - f;
                return (
                  <div className="bg-slate-700/40 border border-slate-600 rounded-lg p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">
                        {formatMoney(p, previewCurrency)} × {formatNumber(q, 4)}주
                      </span>
                      <span className="text-white font-semibold">
                        = {formatMoney(gross, previewCurrency)}
                      </span>
                    </div>
                    {f > 0 && (
                      <div className="flex items-center justify-between text-xs text-slate-500 mt-1 pt-1 border-t border-slate-600/50">
                        <span>{formData.type === 'Buy' ? '+ 수수료' : '- 수수료'}</span>
                        <span>
                          {formData.type === 'Buy' ? '실제 지불액' : '실수령액'}:{' '}
                          <span className={`font-semibold ${formData.type === 'Buy' ? 'text-blue-300' : 'text-red-300'}`}>
                            {formatMoney(net, previewCurrency)}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 매도 시 실현손익 미리보기 */}
              {pnlPreview && (
                <div
                  className={`rounded-lg p-3 border ${
                    pnlPreview.profit >= 0
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-red-500/10 border-red-500/30'
                  }`}
                >
                  <p className="text-xs text-slate-400 mb-1">예상 실현 손익</p>
                  <div className="flex items-baseline gap-2">
                    <p
                      className={`text-xl font-bold ${
                        pnlPreview.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {pnlPreview.profit >= 0 ? '+' : ''}
                      {formatMoney(pnlPreview.profit, previewCurrency)}
                    </p>
                    <p
                      className={`text-sm ${
                        pnlPreview.profit >= 0 ? 'text-emerald-300' : 'text-red-300'
                      }`}
                    >
                      ({pnlPreview.profit >= 0 ? '+' : ''}
                      {pnlPreview.profitPercent.toFixed(2)}%)
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    매입원가 {formatMoney(pnlPreview.costBasis, previewCurrency)} (평단 {formatMoney(pnlPreview.buyAvg, previewCurrency)})
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">메모</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="추가 메모 (선택)"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={submitting}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`flex-1 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                    formData.type === 'Buy' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {submitting ? '처리 중...' : formData.type === 'Buy' ? '매수 기록' : '매도 기록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
