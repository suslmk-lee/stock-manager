import { useState, useEffect } from 'react';
import { GetAllAssets, GetAllAccounts, CreateAsset, UpdateAsset, DeleteAsset, GetTickerInfo, GetCurrentPrice, GetUSDToKRW, CreateHolding, UpdateHolding, DeleteHolding } from '../../wailsjs/go/main/App';
import { Asset, Account, TickerInfo, Holding } from '../types/models';
import { Plus, Trash2, TrendingUp, Search, Edit2 } from 'lucide-react';

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
      const [assetsData, accountsData, rate] = await Promise.all([
        GetAllAssets(),
        GetAllAccounts(),
        GetUSDToKRW(),
      ]);
      
      const assetsArray = assetsData as Asset[];
      setAccounts(accountsData as Account[]);
      
      // 각 자산의 현재가 조회
      const assetsWithPrices = await Promise.all(
        assetsArray.map(async (asset) => {
          try {
            const priceData = await GetCurrentPrice(asset.ticker);
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
      const data = await GetTickerInfo(formData.ticker.toUpperCase());
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
        await UpdateAsset(
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
        await CreateAsset(
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
    if (!confirm('정말로 이 자산을 삭제하시겠습니까?')) return;
    
    try {
      await DeleteAsset(id);
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
      await UpdateHolding(holdingId, quantity, averagePrice);
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
      await DeleteHolding(holdingId);
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
      await CreateHolding(
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

  if (loading) {
    return <div className="text-center py-12 text-slate-400">로딩 중...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">주식/ETF 관리</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5" />
          자산 추가
        </button>
      </div>

      {/* 검색 바 */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="티커, 이름, 섹터로 검색... (예: TI, Apple, Technology)"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
        {searchQuery && (
          <p className="text-sm text-slate-400 mt-2">
            {filteredAssets.length}개의 자산이 검색되었습니다.
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {showForm && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
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
        >
          <div 
            className="bg-slate-800 rounded-xl p-6 border border-slate-700 max-w-3xl w-full max-h-[90vh] overflow-y-auto"
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
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateAsset} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">티커 심볼 *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formData.ticker}
                    onChange={(e) => setFormData({ ...formData, ticker: e.target.value })}
                    onKeyPress={(e) => e.key === 'Enter' && !editingAsset && (e.preventDefault(), handleTickerSearch())}
                    className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 uppercase"
                    placeholder="예: AAPL, 005930"
                    required
                    disabled={!!editingAsset}
                  />
                  {!editingAsset && (
                    <button
                      type="button"
                      onClick={handleTickerSearch}
                      disabled={searching || !formData.ticker}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 px-4 py-2 rounded-lg transition-colors"
                    >
                      {searching ? '검색중...' : <Search className="w-5 h-5" />}
                    </button>
                  )}
                </div>
                {!editingAsset && <p className="text-xs text-slate-400 mt-1">티커 입력 후 검색 버튼 클릭 (검색 실패 시 수동 입력 가능)</p>}
                {editingAsset && <p className="text-xs text-slate-400 mt-1">티커는 수정할 수 없습니다</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">자산명 * (한글 가능)</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="예: SOL골드커버드콜액티브, Apple Inc."
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">타입 *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as 'Stock' | 'ETF' })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="Stock">주식 (Stock)</option>
                  <option value="ETF">ETF</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">섹터</label>
                <select
                  value={formData.sector}
                  onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
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
              <div className="border-t border-slate-600 pt-4 mt-2">
                <h4 className="text-sm font-medium mb-3 text-slate-300">현재 보유 내역</h4>
                {editingAsset.holdings && editingAsset.holdings.length > 0 ? (
                  <div className="space-y-2">
                    {editingAsset.holdings.map((holding) => {
                      const account = accounts.find(acc => acc.id === holding.account_id);
                      return (
                        <div key={holding.id} className="bg-slate-700/30 rounded p-2 flex justify-between items-center">
                          <span className="text-sm text-slate-300">
                            {account?.name || '알 수 없음'}
                          </span>
                          <span className="text-sm text-white font-medium">
                            {holding.quantity.toLocaleString()} 주
                          </span>
                        </div>
                      );
                    })}
                    <p className="text-xs text-blue-400 mt-2">
                      💡 보유 수량을 수정하려면 자산 카드의 계좌별 보유 내역에서 수정 버튼(✏️)을 클릭하세요.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">보유 내역이 없습니다.</p>
                )}
              </div>
            ) : (
              <div className="border-t border-slate-600 pt-4 mt-2">
                <h4 className="text-sm font-medium mb-3 text-slate-300">보유 정보 (선택)</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">계좌</label>
                  <select
                    value={formData.accountId}
                    onChange={(e) => setFormData({ ...formData, accountId: Number(e.target.value) })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value={0}>선택 안함</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.broker} ({account.name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">보유 수량</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0"
                  />
                </div>
              </div>
                <p className="text-xs text-slate-400 mt-2">계좌와 수량을 입력하면 보유 내역이 생성됩니다. 평단가는 거래 내역을 통해 자동 계산됩니다.</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="submit"
                className="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors"
              >
                {editingAsset ? '수정' : '등록'}
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredAssets.length === 0 ? (
          searchQuery ? (
            <div className="col-span-full text-center py-12 text-slate-400">
              <Search className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">'{searchQuery}'에 대한 검색 결과가 없습니다.</p>
              <p className="text-sm mt-2">다른 검색어를 입력해보세요.</p>
            </div>
          ) : assets.length === 0 ? (
          <div className="col-span-full text-center py-12 text-slate-400">
            <TrendingUp className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">등록된 자산이 없습니다.</p>
            <p className="text-sm mt-2">위의 "자산 추가" 버튼을 눌러 주식/ETF를 등록하세요.</p>
          </div>
        ) : null) : (
          filteredAssets.map((asset) => (
            <div
              key={asset.id}
              className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-green-500 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white">{asset.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300">
                      {asset.type}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 mt-1">{asset.ticker}</p>
                  {asset.sector && (
                    <p className="text-xs text-slate-500 mt-1">{asset.sector}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditAsset(asset)}
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                    title="수정"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteAsset(asset.id)}
                    className="text-red-400 hover:text-red-300 transition-colors"
                    title="삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              {/* 가격 및 보유 정보 */}
              <div className="mt-4 pt-4 border-t border-slate-700 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-400">현재가</span>
                  <div className="text-right">
                    <span className="text-lg font-semibold text-white">
                      ₩{asset.currentPrice?.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) || '-'}
                    </span>
                    {asset.changePercent !== undefined && asset.changePercent !== 0 && (
                      <span className={`ml-2 text-xs ${asset.changePercent > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {asset.changePercent > 0 ? '+' : ''}{asset.changePercent.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
                
                {/* 계좌별 보유 내역 */}
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-slate-500 font-medium">계좌별 보유 내역</p>
                    <button
                      onClick={() => {
                        setAddingHoldingForAsset(asset.id);
                        setNewHoldingData({accountId: 0, quantity: '', averagePrice: ''});
                      }}
                      className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      추가
                    </button>
                  </div>
                  
                  {addingHoldingForAsset === asset.id && (
                    <div className="bg-slate-700/50 rounded p-3 space-y-2">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">계좌</label>
                        <select
                          value={newHoldingData.accountId}
                          onChange={(e) => setNewHoldingData({...newHoldingData, accountId: Number(e.target.value)})}
                          className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value={0}>선택하세요</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.broker} ({account.name})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">보유 수량</label>
                        <input
                          type="number"
                          step="0.0001"
                          value={newHoldingData.quantity}
                          onChange={(e) => setNewHoldingData({...newHoldingData, quantity: e.target.value})}
                          className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-white"
                          placeholder="수량"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">평균 단가 (선택)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={newHoldingData.averagePrice}
                          onChange={(e) => setNewHoldingData({...newHoldingData, averagePrice: e.target.value})}
                          className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-white"
                          placeholder="0"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAddHolding(asset.id)}
                          className="flex-1 bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-xs text-white"
                        >
                          추가
                        </button>
                        <button
                          onClick={() => {
                            setAddingHoldingForAsset(null);
                            setNewHoldingData({accountId: 0, quantity: '', averagePrice: ''});
                          }}
                          className="flex-1 bg-slate-600 hover:bg-slate-500 px-3 py-1 rounded text-xs text-white"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {asset.holdings && asset.holdings.length > 0 && (
                    <>
                      {asset.holdings.map((holding, index) => {
                        const account = accounts.find(acc => acc.id === holding.account_id);
                        const holdingValue = (asset.currentPrice || 0) * holding.quantity;
                        const isEditing = editingHolding?.id === holding.id;
                        return (
                          <div key={holding.id || index} className="bg-slate-700/30 rounded p-2 space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-slate-400">
                                {account?.name || '알 수 없음'} ({account?.broker || '-'})
                              </span>
                              <div className="flex items-center gap-2">
                                {isEditing && editingHolding ? (
                                  <input
                                    type="number"
                                    step="0.0001"
                                    value={editingHolding.quantity}
                                    onChange={(e) => setEditingHolding({...editingHolding, quantity: parseFloat(e.target.value) || 0})}
                                    className="w-20 bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-white"
                                    placeholder="수량"
                                  />
                                ) : (
                                  <span className="text-xs text-slate-300">
                                    {holding.quantity.toLocaleString()} 주
                                  </span>
                                )}
                                {isEditing && editingHolding ? (
                                  <>
                                    <button
                                      onClick={() => handleUpdateHolding(holding.id, editingHolding.quantity, editingHolding.averagePrice)}
                                      className="text-green-400 hover:text-green-300 text-xs"
                                    >
                                      저장
                                    </button>
                                    <button
                                      onClick={() => setEditingHolding(null)}
                                      className="text-slate-400 hover:text-slate-300 text-xs"
                                    >
                                      취소
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleEditHolding(holding)}
                                      className="text-blue-400 hover:text-blue-300"
                                      title="수정"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteHolding(holding.id)}
                                      className="text-red-400 hover:text-red-300"
                                      title="삭제"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-slate-500">평가금액</span>
                              <span className="text-sm font-semibold text-green-400">
                                ₩{holdingValue.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                  
                  {/* 총 보유 정보 */}
                  {asset.holdings && asset.holdings.length > 1 && (
                    <div className="mt-3 pt-3 border-t border-slate-600">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-slate-300">총 보유수량</span>
                        <span className="text-sm font-semibold text-white">
                          {asset.holdings.reduce((sum, h) => sum + h.quantity, 0).toLocaleString()} 주
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm font-medium text-slate-300">총 평가금액</span>
                        <span className="text-lg font-bold text-green-400">
                          ₩{asset.totalValue?.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) || '-'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
