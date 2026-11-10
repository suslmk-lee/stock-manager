import { useState, useEffect } from 'react';
import { PageActions } from './shell/PageSlots';
import SplitView from './shell/SplitView';
import { apiClient } from '../api/client';
import { Asset, Account, TickerInfo, Holding } from '../types/models';
import { accountTypePrefix } from '../utils/accountType';
import { Plus, Trash2, TrendingUp, Search, Edit2 } from 'lucide-react';
import Portal from './ui/Portal';

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

interface AssetWithPrice extends Asset {
  currentPrice?: number;
  currency?: string;
  changePercent?: number;
  totalValue?: number;
}

export default function AssetManager() {
  const [assets, setAssets] = useState<AssetWithPrice[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [searching, setSearching] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [editingHolding, setEditingHolding] = useState<{id: number, quantity: number, averagePrice: number} | null>(null);
  const [addingHoldingForAsset, setAddingHoldingForAsset] = useState<number | null>(null);
  const [newHoldingData, setNewHoldingData] = useState({accountId: 0, quantity: '', averagePrice: ''});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [split, setSplit] = useState<boolean | null>(null);
  const [formData, setFormData] = useState({
    ticker: '',
    name: '',
    type: 'Stock' as 'Stock' | 'ETF',
    sector: '',
    accountId: 0,
    quantity: '',
  });

  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    try {
      setLoading(true);
      setError(null);
      const [accountsData, assetsData, rate] = await Promise.all([
        apiClient.GetAllAccounts(),
        apiClient.GetAllAssets(),
        apiClient.GetUSDToKRW(),
      ]);
      
      const assetsArray = assetsData as Asset[];
      setAccounts(accountsData as Account[]);
      
      // 각 자산의 현재가 조회
      const assetsWithPrices = await Promise.all(
        assetsArray.map(async (asset) => {
          try {
            const priceData = await apiClient.GetCurrentPrice(asset.ticker);
            const price = priceData as any;
            
            // 모든 holdings의 수량 합산
            const totalQuantity = asset.holdings?.reduce((sum, h) => sum + h.quantity, 0) || 0;
            
            // USD는 환율 적용, KRW는 그대로
            const priceInKRW = price.currency === 'USD' 
              ? price.price * (rate as number)
              : price.price;
            
            return {
              ...asset,
              currentPrice: priceInKRW,
              currency: 'KRW',
              changePercent: price.change_percent,
              totalValue: priceInKRW * totalQuantity,
            };
          } catch (err) {
            console.error(`Failed to get price for ${asset.ticker}:`, err);
            return {
              ...asset,
              currentPrice: 0,
              currency: 'KRW',
              changePercent: 0,
              totalValue: 0,
            };
          }
        })
      );
      
      setAssets(assetsWithPrices);
    } catch (err) {
      setError(err instanceof Error ? err.message : '자산 목록을 불러오는데 실패했습니다.');
      console.error('Failed to load assets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTickerSearch = async () => {
    if (!formData.ticker || formData.ticker.length < 1) return;
    
    try {
      setSearching(true);
      setError(null);
      const data = await apiClient.GetTickerInfo(formData.ticker.toUpperCase());
      const info = data as TickerInfo;
      
      setFormData(prev => ({
        ...prev,
        ticker: info.symbol,
        name: info.name || prev.name,
        type: (info.type === 'ETF' ? 'ETF' : 'Stock') as 'Stock' | 'ETF',
        sector: info.sector || prev.sector,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '티커 정보를 가져오는데 실패했습니다.');
      console.error('Failed to fetch ticker info:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingAsset) {
        await apiClient.UpdateAsset(
          editingAsset.id,
          formData.name,
          formData.type,
          formData.sector
        );
      } else {
        console.log('Creating asset with:', {
          ticker: formData.ticker.toUpperCase(),
          name: formData.name,
          type: formData.type,
          sector: formData.sector,
          accountId: formData.accountId,
          quantity: parseFloat(formData.quantity || '0'),
        });
        await apiClient.CreateAsset(
          formData.ticker.toUpperCase(),
          formData.name,
          formData.type,
          formData.sector,
          formData.accountId,
          parseFloat(formData.quantity || '0'),
          0
        );
      }
      setFormData({ 
        ticker: '', 
        name: '', 
        type: 'Stock', 
        sector: '',
        accountId: 0,
        quantity: '',
      });
      setShowForm(false);
      setEditingAsset(null);
      await loadAssets();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : (editingAsset ? '자산 수정에 실패했습니다.' : '자산 등록에 실패했습니다.');
      setError(errorMessage);
      console.error('Failed to save asset:', err);
      console.error('Error details:', errorMessage);
    }
  };

  const handleEditAsset = (asset: Asset) => {
    setEditingAsset(asset);
    setFormData({
      ticker: asset.ticker,
      name: asset.name,
      type: asset.type as 'Stock' | 'ETF',
      sector: asset.sector || '',
      accountId: 0,
      quantity: '',
    });
    setShowForm(true);
  };

  const handleCancelEdit = () => {
    setEditingAsset(null);
    setFormData({ 
      ticker: '', 
      name: '', 
      type: 'Stock', 
      sector: '',
      accountId: 0,
      quantity: '',
    });
    setShowForm(false);
  };

  const handleDeleteAsset = async (id: number) => {
    if (!confirm('이 종목을 목록에서 삭제(숨김)하시겠습니까?\n과거 배당금·거래·실현손익 이력은 그대로 보존되며, 같은 티커를 다시 추가하면 복구됩니다.\n(보유 수량이 남아있으면 삭제할 수 없습니다)')) return;
    
    try {
      await apiClient.DeleteAsset(id);
      await loadAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : '자산 삭제에 실패했습니다.');
      console.error('Failed to delete asset:', err);
    }
  };

  const handleEditHolding = (holding: Holding) => {
    setEditingHolding({
      id: holding.id,
      quantity: holding.quantity,
      averagePrice: holding.average_price,
    });
  };

  const handleUpdateHolding = async (holdingId: number, quantity: number, averagePrice: number) => {
    try {
      await apiClient.UpdateHolding(holdingId, quantity, averagePrice);
      setEditingHolding(null);
      await loadAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : '보유 수량 수정에 실패했습니다.');
      console.error('Failed to update holding:', err);
    }
  };

  const handleDeleteHolding = async (holdingId: number) => {
    if (!confirm('정말로 이 보유 내역을 삭제하시겠습니까?')) return;
    
    try {
      await apiClient.DeleteHolding(holdingId);
      await loadAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : '보유 내역 삭제에 실패했습니다.');
      console.error('Failed to delete holding:', err);
    }
  };

  const handleAddHolding = async (assetId: number) => {
    if (newHoldingData.accountId === 0) {
      setError('계좌를 선택해주세요.');
      return;
    }
    if (!newHoldingData.quantity || parseFloat(newHoldingData.quantity) <= 0) {
      setError('보유 수량을 입력해주세요.');
      return;
    }

    try {
      await apiClient.CreateHolding(
        newHoldingData.accountId,
        assetId,
        parseFloat(newHoldingData.quantity),
        parseFloat(newHoldingData.averagePrice || '0')
      );
      setAddingHoldingForAsset(null);
      setNewHoldingData({accountId: 0, quantity: '', averagePrice: ''});
      await loadAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : '보유 내역 추가에 실패했습니다.');
      console.error('Failed to add holding:', err);
    }
  };

  // 검색 필터링
  const filteredAssets = assets.filter(asset => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      asset.ticker.toLowerCase().includes(query) ||
      asset.name.toLowerCase().includes(query) ||
      (asset.sector && asset.sector.toLowerCase().includes(query))
    );
  });
  const selected = filteredAssets.find((a) => a.id === selectedId) ?? null;

  // 넓은 화면은 항상 자산 하나를 보여 주고, 좁은 화면은 고를 때만 상세로 간다
  const firstVisibleId = filteredAssets[0]?.id ?? null;
  const selectedVisible = selected != null;
  useEffect(() => {
    if (split === null) return;
    if (split && !selectedVisible && firstVisibleId != null) setSelectedId(firstVisibleId);
    if (!split && selectedId != null && !selectedVisible) setSelectedId(null);
  }, [split, selectedVisible, firstVisibleId, selectedId]);

  if (loading) {
    return <div className="text-center py-12 text-zinc-400">로딩 중...</div>;
  }

  return (
    <div>
      <PageActions>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary flex items-center gap-2 px-4 py-2"
        >
          <Plus className="w-4 h-4" />
          자산 추가
        </button>
      </PageActions>


      {error && (
        <div className="bg-rose-500/10 border border-rose-400/30 text-rose-200 px-4 py-3 rounded-2xl mb-6">
          {error}
        </div>
      )}

      {showForm && (
        <Portal>
          {/* 입력 중인 값을 잃지 않도록 바깥을 눌러도 닫지 않는다 — 닫기·취소로만 닫는다 */}
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div 
              className="surface p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">{editingAsset ? '자산 수정' : '새 자산 추가'}</h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingAsset(null);
                    setFormData({
                      ticker: '',
                      name: '',
                      type: 'Stock' as 'Stock' | 'ETF',
                      sector: '',
                      accountId: 0,
                      quantity: '',
                    });
                  }}
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <form onSubmit={handleCreateAsset} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">티커 심볼 *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.ticker}
                      onChange={(e) => setFormData({ ...formData, ticker: e.target.value })}
                      onKeyPress={(e) => e.key === 'Enter' && !editingAsset && (e.preventDefault(), handleTickerSearch())}
                      className="input-field flex-1 px-4 py-2 uppercase"
                      placeholder="예: AAPL, 005930"
                      required
                      disabled={!!editingAsset}
                    />
                    {!editingAsset && (
                      <button
                        type="button"
                        onClick={handleTickerSearch}
                        disabled={searching || !formData.ticker}
                        className="btn-primary px-4 py-2"
                      >
                        {searching ? '검색중...' : <Search className="w-5 h-5" />}
                      </button>
                    )}
                  </div>
                  {!editingAsset && <p className="text-xs text-zinc-400 mt-1">티커 입력 후 검색 버튼 클릭 (검색 실패 시 수동 입력 가능)</p>}
                  {editingAsset && <p className="text-xs text-zinc-400 mt-1">티커는 수정할 수 없습니다</p>}
                </div>
                <div>
                  <label className="field-label">자산명 * (한글 가능)</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input-field w-full px-4 py-2"
                    placeholder="예: SOL골드커버드콜액티브, Apple Inc."
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">타입 *</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'Stock' | 'ETF' })}
                    className="input-field w-full px-4 py-2"
                  >
                    <option value="Stock">주식 (Stock)</option>
                    <option value="ETF">ETF</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">섹터</label>
                  <select
                    value={formData.sector}
                    onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                    className="input-field w-full px-4 py-2"
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
              {editingAsset ? (
                <div className="border-t border-white/[0.08] pt-4 mt-2">
                  <h4 className="text-sm font-medium mb-3 text-zinc-300">현재 보유 내역</h4>
                  {editingAsset.holdings && editingAsset.holdings.length > 0 ? (
                    <div className="space-y-2">
                      {editingAsset.holdings.map((holding) => {
                        const account = accounts.find(acc => acc.id === holding.account_id);
                        return (
                          <div key={holding.id} className="bg-white/[0.04] rounded p-2 flex justify-between items-center">
                            <span className="text-sm text-zinc-300">
                              {account?.name || '알 수 없음'}
                            </span>
                            <span className="text-sm text-white font-medium">
                              {holding.quantity.toLocaleString()} 주
                            </span>
                          </div>
                        );
                      })}
                      <p className="text-xs text-mint-400 mt-2">
                        💡 보유 수량을 수정하려면 자산 카드의 계좌별 보유 내역에서 수정 버튼(✏️)을 클릭하세요.
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-400">보유 내역이 없습니다.</p>
                  )}
                </div>
              ) : (
                <div className="border-t border-white/[0.08] pt-4 mt-2">
                  <h4 className="text-sm font-medium mb-3 text-zinc-300">보유 정보 (선택)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="field-label">계좌</label>
                    <select
                      value={formData.accountId}
                      onChange={(e) => setFormData({ ...formData, accountId: Number(e.target.value) })}
                      className="input-field w-full px-4 py-2"
                    >
                      <option value={0}>선택 안함</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {accountTypePrefix(account)}{account.broker} ({account.name})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">보유 수량</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={formData.quantity}
                      onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                      className="input-field w-full px-4 py-2"
                      placeholder="0"
                    />
                  </div>
                </div>
                  <p className="text-xs text-zinc-400 mt-2">계좌와 수량을 입력하면 보유 내역이 생성됩니다. 평단가는 거래 내역을 통해 자동 계산됩니다.</p>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="btn-primary flex-1 px-4 py-2"
                >
                  {editingAsset ? '수정' : '등록'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="btn-ghost flex-1 px-4 py-2"
                >
                  취소
                </button>
              </div>
            </form>
            </div>
          </div>
        </Portal>
      )}

      {/* 자산 목록 + 상세 */}
      {assets.length === 0 ? (
        <div className="surface text-center py-12 text-zinc-400">
          <TrendingUp className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 opacity-50" />
          <p className="text-base sm:text-lg">등록된 자산이 없습니다.</p>
          <p className="text-xs sm:text-sm mt-2">위의 "자산 추가" 버튼을 눌러 주식/ETF를 등록하세요.</p>
        </div>
      ) : (
        <SplitView
          listWidth={420}
          onSplitChange={setSplit}
          showDetail={selected != null}
          onBack={() => setSelectedId(null)}
          backLabel="자산 목록"
          list={
            <>
              <div className="shrink-0 border-b border-white/[0.07] p-3 sm:p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="티커, 이름, 섹터로 검색"
                    aria-label="자산 검색"
                    className="input-field !py-1.5 !pl-8 text-sm"
                  />
                </div>
                <p className="label-mono mt-2">
                  {searchQuery ? `${filteredAssets.length}개 검색됨 · ` : ''}전체 {assets.length}개
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filteredAssets.length === 0 ? (
                  <p className="px-4 py-12 text-center text-sm text-zinc-400">검색 조건과 일치하는 자산이 없습니다.</p>
                ) : (
                  filteredAssets.map((asset) => {
                    const active = asset.id === selectedId;
                    const held = (asset.holdings ?? []).reduce((s, h) => s + h.quantity, 0);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => setSelectedId(asset.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 text-left transition-colors ${
                          active ? 'bg-mint-400/[0.08] shadow-[inset_3px_0_0_rgb(var(--c-mint-400))]' : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className={`truncate text-[13px] ${active ? 'font-medium text-white' : 'text-zinc-100'}`}>{asset.name}</span>
                            <span className="shrink-0 rounded-full bg-mint-400/15 px-1.5 text-[10px] text-mint-300">{asset.type}</span>
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-zinc-500">
                            {asset.ticker}
                            {asset.sector ? ` · ${asset.sector}` : ''}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="num block text-[13px] text-zinc-200">
                            {asset.totalValue ? `₩${asset.totalValue.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}` : '—'}
                          </span>
                          <span className="num mt-0.5 block text-[10.5px] text-zinc-500">
                            {held > 0 ? `${held.toLocaleString()}주` : '보유 없음'}
                            {asset.changePercent !== undefined && asset.changePercent !== 0 && (
                              <span className={asset.changePercent > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {' '}
                                {asset.changePercent > 0 ? '+' : ''}
                                {asset.changePercent.toFixed(2)}%
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          }
          detail={
            selected ? (
              (() => {
                const asset = selected;
                return (
                  <div>
                    <header className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="truncate text-xl font-semibold tracking-tight text-white">{asset.name}</h2>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-mint-400/15 text-mint-300">{asset.type}</span>
                        </div>
                        <p className="label-mono mt-1">
                          {asset.ticker}
                          {asset.sector ? ` · ${asset.sector}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button onClick={() => handleEditAsset(asset)} className="btn-icon" title="자산 수정" aria-label="자산 수정">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAsset(asset.id)}
                          className="btn-icon hover:!border-rose-400/40 hover:!text-rose-300"
                          title="자산 삭제"
                          aria-label="자산 삭제"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </header>

                    {/* 가격 및 보유 정보 */}
                    <div className="mt-5 grid gap-2 sm:grid-cols-3">
                      <div className="surface-inset px-3 py-2.5">
                        <div className="label-mono">현재가</div>
                        <div className="num mt-1 text-sm font-medium text-white">
                          ₩{asset.currentPrice?.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) || '-'}
                          {asset.changePercent !== undefined && asset.changePercent !== 0 && (
                            <span className={`ml-2 text-xs ${asset.changePercent > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {asset.changePercent > 0 ? '+' : ''}
                              {asset.changePercent.toFixed(2)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="surface-inset px-3 py-2.5">
                        <div className="label-mono">총 보유수량</div>
                        <div className="num mt-1 text-sm font-medium text-white">{(asset.holdings ?? []).reduce((sum, h) => sum + h.quantity, 0).toLocaleString()} 주</div>
                      </div>
                      <div className="surface-inset px-3 py-2.5">
                        <div className="label-mono">총 평가금액</div>
                        <div className="num mt-1 text-sm font-medium text-emerald-400">₩{asset.totalValue?.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) || '-'}</div>
                      </div>
                    </div>

                    {/* 계좌별 보유 내역 */}
                    <div className="mt-5 space-y-2">
                      <div className="flex justify-between items-center">
                        <p className="label-mono">계좌별 보유 내역</p>
                        <button
                          onClick={() => {
                            setAddingHoldingForAsset(asset.id);
                            setNewHoldingData({ accountId: 0, quantity: '', averagePrice: '' });
                          }}
                          className="btn-ghost !px-3 !py-1 !text-xs"
                        >
                          <Plus className="w-3 h-3" />
                          보유 추가
                        </button>
                      </div>

                      {addingHoldingForAsset === asset.id && (
                        <div className="surface-inset grid gap-3 p-3 sm:grid-cols-3">
                          <div>
                            <label className="field-label">계좌</label>
                            <select
                              value={newHoldingData.accountId}
                              onChange={(e) => setNewHoldingData({ ...newHoldingData, accountId: Number(e.target.value) })}
                              className="input-field !py-1.5 text-sm"
                            >
                              <option value={0}>선택하세요</option>
                              {accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {accountTypePrefix(account)}
                                  {account.broker} ({account.name})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="field-label">보유 수량</label>
                            <input
                              type="number"
                              step="0.0001"
                              value={newHoldingData.quantity}
                              onChange={(e) => setNewHoldingData({ ...newHoldingData, quantity: e.target.value })}
                              className="input-field !py-1.5 text-sm"
                              placeholder="수량"
                            />
                          </div>
                          <div>
                            <label className="field-label">평균 단가 (선택)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={newHoldingData.averagePrice}
                              onChange={(e) => setNewHoldingData({ ...newHoldingData, averagePrice: e.target.value })}
                              className="input-field !py-1.5 text-sm"
                              placeholder="0"
                            />
                          </div>
                          <div className="flex justify-end gap-2 sm:col-span-3">
                            <button
                              onClick={() => {
                                setAddingHoldingForAsset(null);
                                setNewHoldingData({ accountId: 0, quantity: '', averagePrice: '' });
                              }}
                              className="btn-ghost !px-3 !py-1 !text-xs"
                            >
                              취소
                            </button>
                            <button onClick={() => handleAddHolding(asset.id)} className="btn-primary !px-3 !py-1 !text-xs">
                              추가
                            </button>
                          </div>
                        </div>
                      )}

                      {(asset.holdings ?? []).length === 0 && addingHoldingForAsset !== asset.id && (
                        <p className="surface-inset px-3 py-6 text-center text-sm text-zinc-500">보유 내역이 없습니다.</p>
                      )}

                      {(asset.holdings ?? []).map((holding, index) => {
                        const account = accounts.find((acc) => acc.id === holding.account_id);
                        const holdingValue = (asset.currentPrice || 0) * holding.quantity;
                        const isEditing = editingHolding?.id === holding.id;
                        return (
                          <div key={holding.id || index} className="surface-inset flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3 py-2.5">
                            <span className="min-w-0 truncate text-sm text-zinc-200">
                              {account?.name || '알 수 없음'} <span className="label-mono">{account?.broker || '-'}</span>
                            </span>
                            <div className="flex items-center gap-3">
                              {isEditing && editingHolding ? (
                                <input
                                  type="number"
                                  step="0.0001"
                                  value={editingHolding.quantity}
                                  onChange={(e) => setEditingHolding({ ...editingHolding, quantity: parseFloat(e.target.value) || 0 })}
                                  className="input-field !w-24 !py-1 text-xs"
                                  placeholder="수량"
                                  aria-label="보유 수량"
                                />
                              ) : (
                                <span className="num text-xs text-zinc-300">{holding.quantity.toLocaleString()} 주</span>
                              )}
                              <span className="num text-sm font-semibold text-emerald-400">₩{holdingValue.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}</span>
                              {isEditing && editingHolding ? (
                                <>
                                  <button
                                    onClick={() => handleUpdateHolding(holding.id, editingHolding.quantity, editingHolding.averagePrice)}
                                    className="text-emerald-400 hover:text-emerald-300 text-xs"
                                  >
                                    저장
                                  </button>
                                  <button onClick={() => setEditingHolding(null)} className="text-zinc-400 hover:text-zinc-300 text-xs">
                                    취소
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => handleEditHolding(holding)} className="text-mint-400 hover:text-mint-300" title="수정" aria-label="보유 수량 수정">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleDeleteHolding(holding.id)} className="text-rose-400 hover:text-rose-300" title="삭제" aria-label="보유 내역 삭제">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            ) : (
              <p className="py-16 text-center text-sm text-zinc-400">왼쪽 목록에서 자산을 고르세요.</p>
            )
          }
        />
      )}
    </div>
  );
}
