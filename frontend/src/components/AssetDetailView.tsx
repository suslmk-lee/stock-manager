import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Holding, RealizedPnL, Dividend, Transaction, PricePoint, PriceHistory } from '../types/models';
import { X } from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

interface AssetDetailViewProps {
  assetId: number;
  ticker: string;
  name: string;
  accountId?: number;   // 지정 시 해당 계좌 기준, 없으면 전 계좌 기준
  accountName?: string;
  onClose: () => void;
}

const currencyOf = (ticker: string): 'KRW' | 'USD' => {
  const t = (ticker || '').toUpperCase();
  return t.endsWith('.KS') || t.endsWith('.KQ') ? 'KRW' : 'USD';
};

const formatMoney = (value: number, currency: string) => {
  const symbol = currency === 'USD' ? '$' : '₩';
  if (currency === 'USD')
    return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${symbol}${Math.round(value).toLocaleString('ko-KR')}`;
};
const formatNumber = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d });
const signed = (v: number, c: string) => `${v >= 0 ? '+' : ''}${formatMoney(v, c)}`;

const RANGES = [
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: '6mo', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: '5y', label: '5Y' },
];

export default function AssetDetailView({ assetId, ticker, name, accountId, accountName, onClose }: AssetDetailViewProps) {
  const cur = currencyOf(ticker);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('6mo');
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [price, setPrice] = useState<{ price: number; changePercent: number; marketState?: string } | null>(null);
  const [trend, setTrend] = useState<{ label: string; value: number }[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [stats, setStats] = useState({
    qty: 0, costHolding: 0, realized: 0, costSold: 0, dividend: 0,
  });

  // 현황/추세/거래 데이터 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [holdingsData, pnlData, divData, txData, priceData, snapData] = await Promise.all([
          apiClient.GetAllHoldings(),
          apiClient.GetAllRealizedPnL(),
          apiClient.GetAllDividends(),
          apiClient.GetTransactionsByAsset(assetId),
          apiClient.GetCurrentPrice(ticker).catch(() => null),
          accountId
            ? apiClient.GetSnapshotsByAccount(accountId)
            : apiClient.GetSnapshotsByAsset(assetId),
        ]);
        if (cancelled) return;

        const inScope = (accId: number) => (accountId ? accId === accountId : true);

        const holdings = (holdingsData as Holding[]).filter((h) => h.asset_id === assetId && inScope(h.account_id));
        const pnls = (pnlData as RealizedPnL[]).filter((p) => p.asset_id === assetId && inScope(p.account_id));
        const divs = (divData as Dividend[]).filter((d) => d.asset_id === assetId && inScope(d.account_id));
        const transactions = (txData as Transaction[]).filter((t) => inScope(t.account_id));

        setStats({
          qty: holdings.reduce((s, h) => s + (h.quantity || 0), 0),
          costHolding: holdings.reduce((s, h) => s + (h.quantity || 0) * (h.average_price || 0), 0),
          realized: pnls.reduce((s, p) => s + (p.profit || 0), 0),
          costSold: pnls.reduce((s, p) => s + (p.buy_avg_price || 0) * (p.quantity || 0), 0),
          dividend: divs.reduce((s, d) => s + ((d.amount || 0) - (d.tax || 0)), 0),
        });

        setTxs(
          [...transactions].sort((a, b) => {
            const d = new Date(b.date).getTime() - new Date(a.date).getTime();
            return d !== 0 ? d : b.id - a.id;
          })
        );

        const pd = priceData as any;
        if (pd) setPrice({ price: Number(pd.price || 0), changePercent: Number(pd.change_percent || 0), marketState: pd.market_state });

        // 평가금 추세: (계좌 스냅샷은 자산 필터) 월별 합산
        const snaps = ((snapData as any[]) || []).filter((s) => (accountId ? s.asset_id === assetId : true));
        const map = new Map<string, number>();
        snaps.forEach((s) => {
          const key = `${s.year}-${String(s.month).padStart(2, '0')}`;
          map.set(key, (map.get(key) || 0) + (s.market_value || 0));
        });
        const trendArr = Array.from(map.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([k, v]) => ({ label: k.slice(2), value: v }));
        setTrend(trendArr);
      } catch (err) {
        console.error('Failed to load asset detail:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId, accountId, ticker]);

  // 주가 히스토리 (range 변경 시)
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setPriceHistory([]);
    apiClient
      .GetPriceHistory(ticker, range, range === '5y' ? '1wk' : '1d')
      .then((res) => {
        if (cancelled) return;
        setPriceHistory(((res as PriceHistory | null)?.points) || []);
      })
      .catch(() => { if (!cancelled) setPriceHistory([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, range]);

  const curPrice = price?.price ?? 0;
  const hasPrice = curPrice > 0;
  const marketValue = hasPrice ? stats.qty * curPrice : 0;
  const unrealized = hasPrice && stats.qty > 0 ? marketValue - stats.costHolding : 0;
  const total = unrealized + stats.realized + stats.dividend;
  const investCost = stats.costHolding + stats.costSold;
  const yieldPct = investCost > 0 ? (total / investCost) * 100 : 0;

  const priceChart = priceHistory.map((p) => ({
    label: new Date(p.time * 1000).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }),
    close: p.close,
  }));

  const pnlClass = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-red-400');
  const yAxisFmt = (v: number) => (cur === 'USD' ? `$${v.toFixed(0)}` : `₩${Math.round(v).toLocaleString('ko-KR')}`);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 sm:p-6 w-full max-w-3xl border border-slate-700 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xl font-bold text-white truncate">{name}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 whitespace-nowrap">
                {accountId ? (accountName || '계좌') : '전체 계좌'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{ticker}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 현재가 */}
        <div className="flex items-baseline gap-3 mb-4">
          <span className="text-2xl font-bold text-white">{hasPrice ? formatMoney(curPrice, cur) : '—'}</span>
          {hasPrice && price!.changePercent !== 0 && (
            <span className={`text-sm font-medium ${pnlClass(price!.changePercent)}`}>
              {price!.changePercent > 0 ? '+' : ''}{price!.changePercent.toFixed(2)}%
            </span>
          )}
          {price?.marketState && <span className="text-[11px] text-slate-500">{price.marketState}</span>}
        </div>

        {/* 기간 선택 + 주가 차트 */}
        <div className="flex gap-1.5 mb-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                range === r.key ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 mb-5 h-[200px] flex items-center justify-center">
          {historyLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <div className="w-4 h-4 border border-slate-500 border-t-transparent rounded-full animate-spin" /> 차트 로딩 중...
            </div>
          ) : priceChart.length === 0 ? (
            <p className="text-sm text-slate-500">시세 데이터를 가져올 수 없습니다.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={40} axisLine={{ stroke: '#334155' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} domain={['auto', 'auto']} width={60} axisLine={false} tickLine={false} tickFormatter={yAxisFmt} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#cbd5e1' }} itemStyle={{ color: '#e2e8f0' }}
                  formatter={(v: number) => [formatMoney(v, cur), '종가']}
                />
                <Line type="monotone" dataKey="close" stroke="#a78bfa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 현황 */}
        <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-4 mb-5">
          <p className="text-xs text-slate-500 mb-3">현황</p>
          {loading ? (
            <div className="h-16 flex items-center text-sm text-slate-500">불러오는 중...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
                <div><p className="text-xs text-slate-500 mb-0.5">보유 수량</p><p className="text-white font-medium">{formatNumber(stats.qty, 4)}주</p></div>
                <div><p className="text-xs text-slate-500 mb-0.5">평단가</p><p className="text-white font-medium">{stats.qty > 0 ? formatMoney(stats.costHolding / stats.qty, cur) : '—'}</p></div>
                <div><p className="text-xs text-slate-500 mb-0.5">평가금</p><p className="text-white font-medium">{hasPrice && stats.qty > 0 ? formatMoney(marketValue, cur) : '—'}</p></div>
                <div><p className="text-xs text-slate-500 mb-0.5">평가손익</p><p className={`font-medium ${pnlClass(unrealized)}`}>{stats.qty > 0 && hasPrice ? signed(unrealized, cur) : '—'}</p></div>
                <div><p className="text-xs text-slate-500 mb-0.5">실현손익</p><p className={`font-medium ${pnlClass(stats.realized)}`}>{stats.realized !== 0 ? signed(stats.realized, cur) : '—'}</p></div>
                <div><p className="text-xs text-slate-500 mb-0.5">배당(세후)</p><p className="font-medium text-emerald-400">{stats.dividend !== 0 ? signed(stats.dividend, cur) : '—'}</p></div>
                <div><p className="text-xs text-slate-500 mb-0.5">실질손익</p><p className={`font-semibold ${pnlClass(total)}`}>{signed(total, cur)}</p></div>
                <div><p className="text-xs text-slate-500 mb-0.5">수익률</p><p className={`font-semibold ${pnlClass(yieldPct)}`}>{investCost > 0 ? `${yieldPct >= 0 ? '+' : ''}${yieldPct.toFixed(2)}%` : '—'}</p></div>
              </div>
            </>
          )}
        </div>

        {/* 평가금 추세 */}
        <div className="mb-5">
          <p className="text-xs text-slate-500 mb-2">평가금 추세 ({accountId ? (accountName || '계좌') : '전체 계좌'})</p>
          <div className="bg-slate-900/50 rounded-lg p-3 h-[180px] flex items-center justify-center">
            {loading ? (
              <p className="text-sm text-slate-500">불러오는 중...</p>
            ) : trend.length === 0 ? (
              <p className="text-sm text-slate-500">스냅샷 추세 데이터가 없습니다. (월별 자동 기록)</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={30} axisLine={{ stroke: '#334155' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} domain={['auto', 'auto']} width={60} axisLine={false} tickLine={false} tickFormatter={yAxisFmt} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#cbd5e1' }} itemStyle={{ color: '#e2e8f0' }}
                    formatter={(v: number) => [formatMoney(v, cur), '평가금']}
                  />
                  <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fill="url(#trendFill)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* 거래 이력 */}
        <div>
          <p className="text-xs text-slate-500 mb-2">거래 이력 ({txs.length}건)</p>
          {txs.length === 0 ? (
            <p className="text-sm text-slate-500">거래 내역이 없습니다.</p>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {txs.map((tx) => {
                const isBuy = tx.type === 'Buy';
                return (
                  <div key={tx.id} className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap ${isBuy ? 'bg-blue-500/20 text-blue-300' : 'bg-red-500/20 text-red-300'}`}>
                        {isBuy ? '매수' : '매도'}
                      </span>
                      <span className="text-slate-400 text-xs">{new Date(tx.date).toLocaleDateString('ko-KR')}</span>
                      {!accountId && <span className="text-slate-500 text-xs truncate">· {tx.account?.name || `#${tx.account_id}`}</span>}
                    </div>
                    <div className="text-right whitespace-nowrap text-slate-300 text-xs">
                      {formatMoney(tx.price, cur)} × {formatNumber(tx.quantity, 4)}주
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
