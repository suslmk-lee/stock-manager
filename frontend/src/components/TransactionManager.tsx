import { useState, useEffect, useMemo } from 'react';
import { apiClient } from '../api/client';
import { Account, Asset, Transaction, Holding, RealizedPnL, TickerInfo, PricePoint, PriceHistory } from '../types/models';
import { Plus, ArrowUpCircle, ArrowDownCircle, TrendingUp, TrendingDown, History, X, Search, Info } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { calculateFee, roundFee } from '../utils/fees';

interface TransactionManagerProps {
  selectedAccountId?: number;
  onAccountChange?: (accountId: number) => void;
}

type ViewTab = 'history' | 'pnl' | 'holdings';
type HoldingSortKey = 'name' | 'quantity' | 'price' | 'current' | 'value' | 'profit';

const SECTORS = [
  'Technology',
  'Finance',
  'Healthcare',
  'Consumer',
  'Energy',
  'Materials',
  'Industrials',
  'Utilities',
  'Real Estate',
  'Communication',
  '금(Gold)',
  '채권(Bond)',
  '원자재(Commodity)',
  '배당(Dividend)',
  '커버드콜(Covered Call)',
  '레버리지(Leverage)',
  '인버스(Inverse)',
  '혼합(Mixed)',
  '기타',
];

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
  // 실현 손익 상세 모달
  const [selectedPnl, setSelectedPnl] = useState<RealizedPnL | null>(null);
  // 거래 내역 상세 모달
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  // 거래 수정 모드
  const [txEditMode, setTxEditMode] = useState(false);
  const [txActionLoading, setTxActionLoading] = useState(false);
  const [txEditData, setTxEditData] = useState({
    type: 'Buy' as 'Buy' | 'Sell',
    date: '',
    price: '',
    quantity: '',
    fee: '',
    notes: '',
  });
  // 보유 현황 정렬
  const [holdingSort, setHoldingSort] = useState<{ key: HoldingSortKey; dir: 'asc' | 'desc' }>({
    key: 'value',
    dir: 'desc',
  });
  // 보유 종목 상세(차트/주식정보) 모달
  const [detailHolding, setDetailHolding] = useState<Holding | null>(null);
  const [detailRange, setDetailRange] = useState('6mo');
  const [detailInfo, setDetailInfo] = useState<{ info: TickerInfo | null; price: any } | null>(null);
  const [detailHistory, setDetailHistory] = useState<PricePoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  // 자산 추가 모달
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetSearching, setAssetSearching] = useState(false);
  const [assetFormData, setAssetFormData] = useState({
    ticker: '',
    name: '',
    type: 'Stock' as 'Stock' | 'ETF',
    sector: '',
    quantity: '',
    averagePrice: '',
  });
  // 보유 종목 현재 시세
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  // 평단가/수량 수정 중인 holding id
  const [editingHoldingId, setEditingHoldingId] = useState<number | null>(null);
  const [editHoldingField, setEditHoldingField] = useState<'price' | 'quantity' | null>(null);
  const [editHoldingPrice, setEditHoldingPrice] = useState('');
  const [editHoldingQty, setEditHoldingQty] = useState('');
  const [holdingSearch, setHoldingSearch] = useState('');
  // 보유 현황 시장 필터 (전체/한국/미국)
  const [holdingMarket, setHoldingMarket] = useState<'all' | 'kr' | 'us'>('all');

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

  // 매수/매도가 자동 채움: 종목 선택 시 현재 시세 가져오기
  useEffect(() => {
    if (!sellPriceAutoMode) return;
    if (!formData.assetId) return;
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

  // 상세 모달: 종목 정보 + 현재가 로드 (range 무관)
  useEffect(() => {
    const ticker = detailHolding?.asset?.ticker;
    if (!ticker) return;
    let cancelled = false;
    setDetailInfo(null);
    Promise.all([
      apiClient.GetTickerInfo(ticker).catch(() => null),
      apiClient.GetCurrentPrice(ticker).catch(() => null),
    ]).then(([info, price]) => {
      if (cancelled) return;
      setDetailInfo({ info: info as TickerInfo | null, price });
    });
    return () => { cancelled = true; };
  }, [detailHolding]);

  // 상세 모달: 시세 히스토리 로드 (range 변경 시 재조회)
  useEffect(() => {
    const ticker = detailHolding?.asset?.ticker;
    if (!ticker) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailHistory([]);
    const interval = detailRange === '5y' ? '1wk' : '1d';
    apiClient.GetPriceHistory(ticker, detailRange, interval)
      .then((res) => {
        if (cancelled) return;
        setDetailHistory(((res as PriceHistory | null)?.points) || []);
      })
      .catch(() => { if (!cancelled) setDetailHistory([]); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [detailHolding, detailRange]);

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
    const holding = holdings.find((h) => h.id === holdingId);
    if (!holding) return;
    // 입력이 비어있으면 기존 값을 유지 (변경 없음)
    const trimmed = rawValue.trim();
    const newValue = trimmed === '' ? (field === 'price' ? holding.average_price : holding.quantity) : parseFloat(trimmed);
    if (Number.isNaN(newValue) || newValue <= 0) {
      setError(field === 'price' ? '유효한 평단가를 입력하세요.' : '유효한 수량을 입력하세요.');
      return;
    }
    try {
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

  const openBuyForm = (assetId: number) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    resetForm();
    setFormData({
      accountId: selectedAccount,
      assetId,
      type: 'Buy',
      date: new Date().toISOString().split('T')[0],
      price: '',
      quantity: '',
      fee: '',
      notes: '',
    });
    setSellPriceAutoMode(true);
    setFeeAutoMode(true);
    setShowForm(true);
  };

  const openTxDetail = (tx: Transaction) => {
    setTxEditMode(false);
    setSelectedTx(tx);
  };

  const startTxEdit = (tx: Transaction) => {
    setTxEditData({
      type: tx.type,
      date: new Date(tx.date).toISOString().split('T')[0],
      price: String(tx.price),
      quantity: String(tx.quantity),
      fee: String(tx.fee),
      notes: tx.notes || '',
    });
    setTxEditMode(true);
  };

  const handleUpdateTransaction = async () => {
    if (!selectedTx) return;
    const price = parseFloat(txEditData.price);
    const quantity = parseFloat(txEditData.quantity);
    if (!price || price <= 0) {
      setError('가격을 올바르게 입력하세요.');
      return;
    }
    if (!quantity || quantity <= 0) {
      setError('수량을 올바르게 입력하세요.');
      return;
    }
    setTxActionLoading(true);
    setError(null);
    try {
      await apiClient.UpdateTransaction(
        selectedTx.id,
        txEditData.type,
        txEditData.date,
        price,
        quantity,
        parseFloat(txEditData.fee || '0'),
        txEditData.notes,
      );
      setSelectedTx(null);
      setTxEditMode(false);
      await reloadAccountData(selectedAccount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '거래 수정에 실패했습니다.');
    } finally {
      setTxActionLoading(false);
    }
  };

  const handleDeleteTransaction = async () => {
    if (!selectedTx) return;
    if (!confirm('이 거래를 삭제하시겠습니까?\n삭제 후 보유 수량과 실현 손익이 자동으로 재계산됩니다.')) return;
    setTxActionLoading(true);
    setError(null);
    try {
      await apiClient.DeleteTransaction(selectedTx.id);
      setSelectedTx(null);
      setTxEditMode(false);
      await reloadAccountData(selectedAccount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '거래 삭제에 실패했습니다.');
    } finally {
      setTxActionLoading(false);
    }
  };

  const openHoldingDetail = (h: Holding) => {
    setDetailRange('6mo');
    setDetailHistory([]);
    setDetailInfo(null);
    setDetailHolding(h);
  };

  const resetAssetForm = () => {
    setAssetFormData({ ticker: '', name: '', type: 'Stock', sector: '', quantity: '', averagePrice: '' });
  };

  const handleAssetTickerSearch = async () => {
    if (!assetFormData.ticker) return;
    try {
      setAssetSearching(true);
      setError(null);
      const data = await apiClient.GetTickerInfo(assetFormData.ticker.toUpperCase());
      const info = data as TickerInfo;
      setAssetFormData((prev) => ({
        ...prev,
        ticker: info.symbol,
        name: info.name || prev.name,
        type: (info.type === 'ETF' ? 'ETF' : 'Stock') as 'Stock' | 'ETF',
        sector: info.sector || prev.sector,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '티커 정보를 가져오는데 실패했습니다.');
    } finally {
      setAssetSearching(false);
    }
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetFormData.ticker || !assetFormData.name) {
      setError('티커와 자산명을 입력하세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.CreateAsset(
        assetFormData.ticker.toUpperCase(),
        assetFormData.name,
        assetFormData.type,
        assetFormData.sector,
        selectedAccount,
        parseFloat(assetFormData.quantity || '0'),
        parseFloat(assetFormData.averagePrice || '0'),
      );
      resetAssetForm();
      setShowAssetForm(false);
      // 자산 목록 및 현재 계좌 데이터 갱신
      const assetsData = await apiClient.GetAllAssets();
      setAssets(assetsData as Asset[]);
      await reloadAccountData(selectedAccount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '자산 등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
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

  const toggleHoldingSort = (key: HoldingSortKey) =>
    setHoldingSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' }
    );

  const formatDateTimeKST = (iso: string) =>
    new Date(iso).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const formatMoney = (value: number, currency: string) => {
    const symbol = currency === 'USD' ? '$' : '₩';
    if (currency === 'USD') return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${symbol}${Math.round(value).toLocaleString('ko-KR')}`;
  };

  const previewCurrency = getCurrencyFromTicker(selectedAsset?.ticker || '');
  // 입력 폼 통화 심볼: 종목 선택 시 종목 통화(미국 주식=USD) 기준, 미선택 시 계좌 통화 기준
  const formCurrencySymbol = selectedAsset ? (previewCurrency === 'USD' ? '$' : '₩') : currencySymbol;

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              resetAssetForm();
              setShowAssetForm(true);
            }}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-5 h-5" />
            자산 추가
          </button>
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
            [...transactions]
              .sort((a, b) => {
                const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
                if (dateDiff !== 0) return dateDiff;
                const createdDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                if (createdDiff !== 0) return createdDiff;
                return b.id - a.id;
              })
              .map((tx) => {
              const isBuy = tx.type === 'Buy';
              const total = tx.price * tx.quantity + (isBuy ? tx.fee : -tx.fee);
              const txCurrency = getCurrencyFromTicker(tx.asset?.ticker || '');
              return (
                <div
                  key={tx.id}
                  onClick={() => openTxDetail(tx)}
                  className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-blue-500/50 transition-colors cursor-pointer"
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
            [...pnls]
              .sort((a, b) => {
                const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
                if (dateDiff !== 0) return dateDiff;
                const createdDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                if (createdDiff !== 0) return createdDiff;
                return b.id - a.id;
              })
              .map((p) => {
              const isProfit = p.profit >= 0;
              const pnlCurrency = getCurrencyFromTicker(p.asset?.ticker || '');
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedPnl(p)}
                  className={`rounded-lg p-4 border transition-colors cursor-pointer ${
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
            <div className="space-y-3">
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

              {/* 시장 필터 */}
              <div className="flex gap-1.5">
                {([
                  { key: 'all', label: '모두' },
                  { key: 'kr', label: '🇰🇷 한국' },
                  { key: 'us', label: '🇺🇸 미국' },
                ] as { key: 'all' | 'kr' | 'us'; label: string }[]).map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setHoldingMarket(m.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      holdingMarket === m.key
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* 보유 테이블 */}
              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-800/70 text-xs text-slate-400 border-b border-slate-700">
                      {([
                        { key: 'name', label: '종목', align: 'left' },
                        { key: 'quantity', label: '수량', align: 'right' },
                        { key: 'price', label: '평단가', align: 'right' },
                        { key: 'current', label: '현재가', align: 'right' },
                        { key: 'value', label: '평가금', align: 'right' },
                        { key: 'profit', label: '손익', align: 'right' },
                      ] as { key: HoldingSortKey; label: string; align: 'left' | 'right' }[]).map((col) => (
                        <th
                          key={col.key}
                          onClick={() => toggleHoldingSort(col.key)}
                          className={`font-medium px-3 py-2.5 cursor-pointer select-none hover:text-slate-200 transition-colors ${
                            col.align === 'left' ? 'text-left' : 'text-right'
                          }`}
                        >
                          <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                            {col.label}
                            <span className={holdingSort.key === col.key ? 'text-purple-400' : 'text-slate-600'}>
                              {holdingSort.key === col.key ? (holdingSort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                            </span>
                          </span>
                        </th>
                      ))}
                      <th className="text-right font-medium px-3 py-2.5">액션</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/60">
                    {(() => {
                      const filtered = [...holdings]
                        .filter((h) => {
                          if (holdingMarket === 'all') return true;
                          const isKR = getCurrencyFromTicker(h.asset?.ticker || '') === 'KRW';
                          return holdingMarket === 'kr' ? isKR : !isKR;
                        })
                        .filter((h) => {
                          const q = holdingSearch.trim().toLowerCase();
                          if (!q) return true;
                          const name = (h.asset?.name || '').toLowerCase();
                          const ticker = (h.asset?.ticker || '').toLowerCase();
                          return name.includes(q) || ticker.includes(q);
                        })
                        .sort((a, b) => {
                          const dir = holdingSort.dir === 'asc' ? 1 : -1;
                          if (holdingSort.key === 'name') {
                            const an = (a.asset?.name || a.asset?.ticker || '').toLowerCase();
                            const bn = (b.asset?.name || b.asset?.ticker || '').toLowerCase();
                            return an.localeCompare(bn, 'ko') * dir;
                          }
                          const aPrice = priceMap[a.asset?.ticker || ''] || 0;
                          const bPrice = priceMap[b.asset?.ticker || ''] || 0;
                          const val = (h: Holding, price: number): number => {
                            switch (holdingSort.key) {
                              case 'quantity':
                                return h.quantity;
                              case 'price':
                                return h.average_price;
                              case 'current':
                                return price;
                              case 'value':
                                return price * h.quantity;
                              case 'profit':
                                return price * h.quantity - h.average_price * h.quantity;
                              default:
                                return 0;
                            }
                          };
                          return (val(a, aPrice) - val(b, bPrice)) * dir;
                        });

                      if (filtered.length === 0) {
                        return (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-slate-400 text-sm">
                              검색 결과가 없습니다.
                            </td>
                          </tr>
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
                          <tr key={h.id} className="hover:bg-slate-800/50 transition-colors">
                            {/* 종목 */}
                            <td className="px-3 py-2.5 min-w-[160px]">
                              <button
                                onClick={() => openHoldingDetail(h)}
                                className="text-left group"
                                title="차트 및 주식정보 보기"
                              >
                                <p className="text-white font-medium truncate group-hover:text-purple-400 transition-colors">
                                  {h.asset?.name || ticker}
                                </p>
                                <p className="text-xs text-slate-500">{ticker}</p>
                              </button>
                            </td>

                            {/* 수량 */}
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              {editingHoldingId === h.id && editHoldingField === 'quantity' ? (
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="number"
                                    step="any"
                                    autoFocus
                                    value={editHoldingQty}
                                    placeholder={formatNumber(h.quantity, 4)}
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
                                    setEditHoldingQty('');
                                  }}
                                  className="text-slate-300 hover:text-white underline decoration-slate-600 underline-offset-2"
                                >
                                  {formatNumber(h.quantity, 4)}주
                                </button>
                              )}
                            </td>

                            {/* 평단가 */}
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              {editingHoldingId === h.id && editHoldingField === 'price' ? (
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="number"
                                    step="any"
                                    autoFocus
                                    value={editHoldingPrice}
                                    placeholder={String(h.average_price)}
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
                                    setEditHoldingPrice('');
                                  }}
                                  className="text-slate-300 hover:text-white underline decoration-slate-600 underline-offset-2"
                                >
                                  {formatMoney(h.average_price, currency)}
                                </button>
                              )}
                            </td>

                            {/* 현재가 */}
                            <td className="px-3 py-2.5 text-right whitespace-nowrap text-slate-300">
                              {hasPrice ? formatMoney(curPrice, currency) : '—'}
                            </td>

                            {/* 평가금 */}
                            <td className="px-3 py-2.5 text-right whitespace-nowrap text-white font-medium">
                              {hasPrice ? formatMoney(marketValue, currency) : '—'}
                            </td>

                            {/* 손익 */}
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
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
                            </td>

                            {/* 액션 */}
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => openBuyForm(h.asset_id)}
                                  className="px-2 py-1 bg-blue-600/80 hover:bg-blue-600 rounded text-xs transition-colors"
                                >
                                  매수
                                </button>
                                <button
                                  onClick={() => openSellForm(h.asset_id)}
                                  className="px-2 py-1 bg-red-600/80 hover:bg-red-600 rounded text-xs transition-colors"
                                >
                                  매도
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>

              {/* 합계 - 통화별 분리 */}
              {(() => {
                const byCurrency: Record<string, { cost: number; value: number }> = {};
                holdings.forEach((h) => {
                  const cur = getCurrencyFromTicker(h.asset?.ticker || '');
                  if (holdingMarket === 'kr' && cur !== 'KRW') return;
                  if (holdingMarket === 'us' && cur === 'KRW') return;
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

      {/* 실현 손익 상세 모달 */}
      {selectedPnl && (() => {
        const p = selectedPnl;
        const cur = getCurrencyFromTicker(p.asset?.ticker || '');
        const isProfit = p.profit >= 0;
        const costBasis = p.buy_avg_price * p.quantity;
        const proceeds = p.sell_price * p.quantity;
        return (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedPnl(null)}
          >
            <div
              className="bg-slate-800 rounded-xl p-6 w-full max-w-lg border border-slate-700 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${
                      isProfit
                        ? 'bg-gradient-to-br from-emerald-500 to-teal-500'
                        : 'bg-gradient-to-br from-red-500 to-pink-500'
                    }`}
                  >
                    {isProfit ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xl font-semibold text-white truncate">
                      {p.asset?.name || p.asset?.ticker || `Asset #${p.asset_id}`}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {p.asset?.ticker} · {new Date(p.date).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedPnl(null)}
                  className="text-slate-400 hover:text-white shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 실현 손익 강조 */}
              <div
                className={`rounded-lg p-4 mb-5 border ${
                  isProfit ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
                }`}
              >
                <p className="text-xs text-slate-400 mb-1">실현 손익 ({cur})</p>
                <div className="flex items-baseline gap-2">
                  <span className={`text-2xl font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isProfit ? '+' : ''}{formatMoney(p.profit, cur)}
                  </span>
                  <span className={`text-sm font-medium ${isProfit ? 'text-emerald-300' : 'text-red-300'}`}>
                    ({isProfit ? '+' : ''}{p.profit_percent.toFixed(2)}%)
                  </span>
                </div>
              </div>

              {/* 상세 항목 */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">매도 수량</p>
                  <p className="text-white font-medium">{formatNumber(p.quantity, 4)}주</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">매도일</p>
                  <p className="text-white font-medium">{new Date(p.date).toLocaleDateString('ko-KR')}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">평균 매수가</p>
                  <p className="text-white font-medium">{formatMoney(p.buy_avg_price, cur)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">매도가</p>
                  <p className="text-white font-medium">{formatMoney(p.sell_price, cur)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">매입 원가</p>
                  <p className="text-white font-medium">{formatMoney(costBasis, cur)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">매도 금액</p>
                  <p className="text-white font-medium">{formatMoney(proceeds, cur)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">수수료</p>
                  <p className="text-white font-medium">{formatMoney(p.fee, cur)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">계좌</p>
                  <p className="text-white font-medium truncate">{p.account?.name || `#${p.account_id}`}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-slate-500 mb-0.5">등록 시각 (KST)</p>
                  <p className="text-white font-medium">{formatDateTimeKST(p.created_at)}</p>
                </div>
              </div>

              {p.notes && (
                <div className="mt-5 pt-4 border-t border-slate-700">
                  <p className="text-xs text-slate-500 mb-1">메모</p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">{p.notes}</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 거래 내역 상세 모달 */}
      {selectedTx && (() => {
        const tx = selectedTx;
        const isBuy = tx.type === 'Buy';
        const cur = getCurrencyFromTicker(tx.asset?.ticker || '');
        const gross = tx.price * tx.quantity;
        const total = gross + (isBuy ? tx.fee : -tx.fee);
        return (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => { if (!txActionLoading) { setSelectedTx(null); setTxEditMode(false); } }}
          >
            <div
              className="bg-slate-800 rounded-xl p-6 w-full max-w-lg border border-slate-700 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${
                      isBuy
                        ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                        : 'bg-gradient-to-br from-red-500 to-orange-500'
                    }`}
                  >
                    {isBuy ? <ArrowDownCircle className="w-6 h-6" /> : <ArrowUpCircle className="w-6 h-6" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xl font-semibold text-white truncate">
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
                    <p className="text-xs text-slate-400 mt-0.5">
                      {tx.asset?.ticker} · {new Date(tx.date).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setSelectedTx(null); setTxEditMode(false); }}
                  className="text-slate-400 hover:text-white shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {txEditMode ? (
                /* ===== 수정 폼 ===== */
                <div className="space-y-4">
                  <p className="text-xs text-slate-400">
                    {tx.asset?.ticker} · {tx.account?.name || `#${tx.account_id}`} 거래를 수정합니다. (종목/계좌는 변경할 수 없습니다)
                  </p>

                  {/* 매수/매도 토글 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTxEditData({ ...txEditData, type: 'Buy' })}
                      className={`py-2 rounded-lg font-medium transition-colors ${
                        txEditData.type === 'Buy' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      매수
                    </button>
                    <button
                      type="button"
                      onClick={() => setTxEditData({ ...txEditData, type: 'Sell' })}
                      className={`py-2 rounded-lg font-medium transition-colors ${
                        txEditData.type === 'Sell' ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      매도
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">거래일</label>
                      <input
                        type="date"
                        value={txEditData.date}
                        onChange={(e) => setTxEditData({ ...txEditData, date: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">{txEditData.type === 'Buy' ? '매수가' : '매도가'} ({cur})</label>
                      <input
                        type="number"
                        step="any"
                        value={txEditData.price}
                        onChange={(e) => setTxEditData({ ...txEditData, price: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">수량</label>
                      <input
                        type="number"
                        step="any"
                        value={txEditData.quantity}
                        onChange={(e) => setTxEditData({ ...txEditData, quantity: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">수수료 ({cur})</label>
                      <input
                        type="number"
                        step="any"
                        value={txEditData.fee}
                        onChange={(e) => setTxEditData({ ...txEditData, fee: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">메모</label>
                    <input
                      type="text"
                      value={txEditData.notes}
                      onChange={(e) => setTxEditData({ ...txEditData, notes: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <p className="text-[11px] text-amber-400/80">
                    ⚠ 수정 시 해당 종목의 보유 수량·평단가·실현 손익이 전체 거래 기준으로 재계산됩니다.
                  </p>

                  <div className="flex gap-3 pt-1">
                    <button
                      onClick={handleUpdateTransaction}
                      disabled={txActionLoading}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 px-4 py-2 rounded-lg text-white font-medium transition-colors"
                    >
                      {txActionLoading ? '저장 중...' : '저장'}
                    </button>
                    <button
                      onClick={() => setTxEditMode(false)}
                      disabled={txActionLoading}
                      className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-white transition-colors"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                /* ===== 읽기 전용 ===== */
                <>
                  {/* 금액 강조 */}
                  <div
                    className={`rounded-lg p-4 mb-5 border ${
                      isBuy ? 'bg-blue-500/10 border-blue-500/30' : 'bg-red-500/10 border-red-500/30'
                    }`}
                  >
                    <p className="text-xs text-slate-400 mb-1">{isBuy ? '총 지불액' : '실수령액'} ({cur})</p>
                    <span className={`text-2xl font-bold ${isBuy ? 'text-blue-400' : 'text-red-400'}`}>
                      {formatMoney(total, cur)}
                    </span>
                  </div>

                  {/* 상세 항목 */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">{isBuy ? '매수가' : '매도가'}</p>
                      <p className="text-white font-medium">{formatMoney(tx.price, cur)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">수량</p>
                      <p className="text-white font-medium">{formatNumber(tx.quantity, 4)}주</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">거래 금액</p>
                      <p className="text-white font-medium">{formatMoney(gross, cur)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">수수료</p>
                      <p className="text-white font-medium">{formatMoney(tx.fee, cur)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">거래일</p>
                      <p className="text-white font-medium">{new Date(tx.date).toLocaleDateString('ko-KR')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">계좌</p>
                      <p className="text-white font-medium truncate">{tx.account?.name || `#${tx.account_id}`}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-slate-500 mb-0.5">등록 시각 (KST)</p>
                      <p className="text-white font-medium">{formatDateTimeKST(tx.created_at)}</p>
                    </div>
                  </div>

                  {tx.notes && (
                    <div className="mt-5 pt-4 border-t border-slate-700">
                      <p className="text-xs text-slate-500 mb-1">메모</p>
                      <p className="text-sm text-slate-300 whitespace-pre-wrap">{tx.notes}</p>
                    </div>
                  )}

                  {/* 액션 */}
                  <div className="flex gap-3 mt-6 pt-4 border-t border-slate-700">
                    <button
                      onClick={() => startTxEdit(tx)}
                      className="flex-1 bg-blue-600/80 hover:bg-blue-600 px-4 py-2 rounded-lg text-white font-medium transition-colors"
                    >
                      수정
                    </button>
                    <button
                      onClick={handleDeleteTransaction}
                      disabled={txActionLoading}
                      className="flex-1 bg-red-600/80 hover:bg-red-600 disabled:bg-slate-600 px-4 py-2 rounded-lg text-white font-medium transition-colors"
                    >
                      {txActionLoading ? '삭제 중...' : '삭제'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* 보유 종목 상세(차트/주식정보) 모달 */}
      {detailHolding && (() => {
        const h = detailHolding;
        const ticker = h.asset?.ticker || '';
        const cur = getCurrencyFromTicker(ticker);
        const price = detailInfo?.price;
        const info = detailInfo?.info;
        const curPrice = Number(price?.price ?? priceMap[ticker] ?? 0);
        const changePercent = Number(price?.change_percent ?? 0);
        const hasPrice = curPrice > 0;
        const marketValue = curPrice * h.quantity;
        const totalCost = h.average_price * h.quantity;
        const profit = marketValue - totalCost;
        const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;
        const isProfit = profit >= 0;
        const chartData = detailHistory.map((p) => ({
          label: new Date(p.time * 1000).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }),
          close: p.close,
        }));
        const RANGES: { key: string; label: string }[] = [
          { key: '1mo', label: '1M' },
          { key: '3mo', label: '3M' },
          { key: '6mo', label: '6M' },
          { key: '1y', label: '1Y' },
          { key: '5y', label: '5Y' },
        ];
        return (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setDetailHolding(null)}
          >
            <div
              className="bg-slate-800 rounded-xl p-6 w-full max-w-2xl border border-slate-700 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div className="flex items-start justify-between mb-4">
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold text-white truncate">{h.asset?.name || ticker}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {ticker}
                    {info?.exchange ? ` · ${info.exchange}` : ''}
                    {info?.sector ? ` · ${info.sector}` : ''}
                  </p>
                </div>
                <button onClick={() => setDetailHolding(null)} className="text-slate-400 hover:text-white shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 현재가 */}
              <div className="flex items-baseline gap-3 mb-4">
                <span className="text-2xl font-bold text-white">
                  {hasPrice ? formatMoney(curPrice, cur) : '—'}
                </span>
                {hasPrice && changePercent !== 0 && (
                  <span className={`text-sm font-medium ${changePercent > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%
                  </span>
                )}
                {price?.market_state && (
                  <span className="text-[11px] text-slate-500">{price.market_state}</span>
                )}
              </div>

              {/* 기간 선택 */}
              <div className="flex gap-1.5 mb-2">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setDetailRange(r.key)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      detailRange === r.key
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {/* 차트 */}
              <div className="bg-slate-900/50 rounded-lg p-3 mb-4 h-[240px] flex items-center justify-center">
                {detailLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <div className="w-4 h-4 border border-slate-500 border-t-transparent rounded-full animate-spin" />
                    차트 로딩 중...
                  </div>
                ) : chartData.length === 0 ? (
                  <p className="text-sm text-slate-500">시세 데이터를 가져올 수 없습니다.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        minTickGap={40}
                        axisLine={{ stroke: '#334155' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        domain={['auto', 'auto']}
                        width={60}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v: number) =>
                          cur === 'USD' ? `$${v.toFixed(0)}` : `₩${Math.round(v).toLocaleString('ko-KR')}`
                        }
                      />
                      <Tooltip
                        contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: '#cbd5e1' }}
                        itemStyle={{ color: '#e2e8f0' }}
                        formatter={(v: number) => [formatMoney(v, cur), '종가']}
                      />
                      <Line type="monotone" dataKey="close" stroke="#a78bfa" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* 내 보유 정보 */}
              <div className="rounded-lg border border-slate-700 p-4">
                <p className="text-xs text-slate-500 mb-3">내 보유 정보 ({currentAccount?.name})</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">보유 수량</p>
                    <p className="text-white font-medium">{formatNumber(h.quantity, 4)}주</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">평단가</p>
                    <p className="text-white font-medium">{formatMoney(h.average_price, cur)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">평가금</p>
                    <p className="text-white font-medium">{hasPrice ? formatMoney(marketValue, cur) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">평가 손익</p>
                    {hasPrice ? (
                      <p className={`font-medium ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}{formatMoney(profit, cur)}
                        <span className="text-xs ml-1">({isProfit ? '+' : ''}{profitPercent.toFixed(2)}%)</span>
                      </p>
                    ) : (
                      <p className="text-slate-500">—</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => { setDetailHolding(null); openBuyForm(h.asset_id); }}
                    className="flex-1 px-3 py-2 bg-blue-600/80 hover:bg-blue-600 rounded text-sm text-white font-medium transition-colors"
                  >
                    매수
                  </button>
                  <button
                    onClick={() => { setDetailHolding(null); openSellForm(h.asset_id); }}
                    className="flex-1 px-3 py-2 bg-red-600/80 hover:bg-red-600 rounded text-sm text-white font-medium transition-colors"
                  >
                    매도
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 자산 추가 모달 */}
      {showAssetForm && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !submitting && (setShowAssetForm(false), resetAssetForm())}
        >
          <div
            className="bg-slate-800 rounded-xl p-6 w-full max-w-2xl border border-slate-700 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xl font-semibold text-white">새 자산 추가</h3>
              <button
                onClick={() => { setShowAssetForm(false); resetAssetForm(); }}
                disabled={submitting}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              {currentAccount ? `${currentAccount.broker} (${currentAccount.name})` : ''} 계좌에 자산이 추가됩니다.
            </p>

            <form onSubmit={handleCreateAsset} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-300">티커 심볼 *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={assetFormData.ticker}
                      onChange={(e) => setAssetFormData({ ...assetFormData, ticker: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAssetTickerSearch();
                        }
                      }}
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500 uppercase"
                      placeholder="예: AAPL, 005930"
                      required
                    />
                    <button
                      type="button"
                      onClick={handleAssetTickerSearch}
                      disabled={assetSearching || !assetFormData.ticker}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 px-4 py-2 rounded-lg transition-colors"
                    >
                      {assetSearching ? '검색중...' : <Search className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">티커 입력 후 검색 (실패 시 수동 입력 가능)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-300">자산명 * (한글 가능)</label>
                  <input
                    type="text"
                    value={assetFormData.name}
                    onChange={(e) => setAssetFormData({ ...assetFormData, name: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="예: Apple Inc., 삼성전자"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-300">타입 *</label>
                  <select
                    value={assetFormData.type}
                    onChange={(e) => setAssetFormData({ ...assetFormData, type: e.target.value as 'Stock' | 'ETF' })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="Stock">주식 (Stock)</option>
                    <option value="ETF">ETF</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-300">섹터</label>
                  <select
                    value={assetFormData.sector}
                    onChange={(e) => setAssetFormData({ ...assetFormData, sector: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">선택하세요</option>
                    {SECTORS.map((sector) => (
                      <option key={sector} value={sector}>
                        {sector}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t border-slate-600 pt-4 mt-2">
                <h4 className="text-sm font-medium mb-3 text-slate-300">보유 정보 (선택)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-slate-300">보유 수량</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={assetFormData.quantity}
                      onChange={(e) => setAssetFormData({ ...assetFormData, quantity: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-slate-300">평균 단가</label>
                    <input
                      type="number"
                      step="0.01"
                      value={assetFormData.averagePrice}
                      onChange={(e) => setAssetFormData({ ...assetFormData, averagePrice: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="0"
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2">수량을 입력하면 현재 계좌에 보유 내역이 함께 생성됩니다.</p>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 px-4 py-2 rounded-lg transition-colors text-white font-medium"
                >
                  {submitting ? '처리 중...' : '등록'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAssetForm(false); resetAssetForm(); }}
                  disabled={submitting}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors text-white"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
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
                      {formData.type === 'Sell' ? '주당 매도가' : '주당 매수가'} ({formCurrencySymbol}) *
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
                      수수료 ({formCurrencySymbol})
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
