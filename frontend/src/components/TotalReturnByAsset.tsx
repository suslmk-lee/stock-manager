import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account, Holding, RealizedPnL, Dividend } from '../types/models';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';

interface TotalReturnByAssetProps {
  accountId?: number;
  marketType?: string;
  onSelectAsset?: (asset: { assetId: number; ticker: string; name: string }) => void;
}

interface AssetRow {
  assetId: number;
  name: string;
  ticker: string;
  currency: 'KRW' | 'USD';
  qty: number;          // 현재 보유 수량
  costHolding: number;  // 현재 보유 원가 (Σ qty×평단)
  realized: number;     // 실현 손익
  costSold: number;     // 매도분 원가 (Σ 매도 평단×수량)
  dividend: number;     // 배당(세후 실수령)
}

const currencyOf = (ticker?: string): 'KRW' | 'USD' => {
  const t = (ticker || '').toUpperCase();
  return t.endsWith('.KS') || t.endsWith('.KQ') ? 'KRW' : 'USD';
};

const formatMoney = (value: number, currency: string) => {
  const symbol = currency === 'USD' ? '$' : '₩';
  if (currency === 'USD')
    return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${symbol}${Math.round(value).toLocaleString('ko-KR')}`;
};

const signed = (value: number, currency: string) => `${value >= 0 ? '+' : ''}${formatMoney(value, currency)}`;

const formatNumber = (n: number, fractionDigits = 0) =>
  n.toLocaleString('ko-KR', { maximumFractionDigits: fractionDigits });

export default function TotalReturnByAsset({ accountId, marketType = 'all', onSelectAsset }: TotalReturnByAssetProps) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [exchangeRate, setExchangeRate] = useState(1300);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, marketType]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [holdingsData, pnlData, dividendsData, accountsData, rate] = await Promise.all([
        apiClient.GetAllHoldings(),
        apiClient.GetAllRealizedPnL(),
        apiClient.GetAllDividends(),
        apiClient.GetAllAccounts(),
        apiClient.GetUSDToKRW(),
      ]);

      const holdings = (holdingsData as Holding[]) || [];
      const pnls = (pnlData as RealizedPnL[]) || [];
      const dividends = (dividendsData as Dividend[]) || [];
      const accounts = (accountsData as Account[]) || [];
      setExchangeRate(rate as number);

      const accountMap = new Map(accounts.map((a) => [a.id, a]));
      const inScope = (accId: number) => {
        if (accountId && accId !== accountId) return false;
        const acc = accountMap.get(accId);
        if (marketType === 'domestic' && acc?.market_type !== 'Domestic') return false;
        if (marketType === 'international' && acc?.market_type !== 'International') return false;
        return true;
      };

      const map = new Map<number, AssetRow>();
      const ensure = (assetId: number, name: string, ticker: string): AssetRow => {
        let row = map.get(assetId);
        if (!row) {
          row = {
            assetId,
            name: name || ticker || `Asset #${assetId}`,
            ticker,
            currency: currencyOf(ticker),
            qty: 0,
            costHolding: 0,
            realized: 0,
            costSold: 0,
            dividend: 0,
          };
          map.set(assetId, row);
        }
        return row;
      };

      // 현재 보유 → 수량/보유원가
      holdings.forEach((h) => {
        if (!inScope(h.account_id)) return;
        const row = ensure(h.asset_id, h.asset?.name || '', h.asset?.ticker || '');
        row.qty += h.quantity || 0;
        row.costHolding += (h.quantity || 0) * (h.average_price || 0);
      });

      // 실현 손익 → 실현손익/매도분 원가
      pnls.forEach((p) => {
        if (!inScope(p.account_id)) return;
        const row = ensure(p.asset_id, p.asset?.name || '', p.asset?.ticker || '');
        row.realized += p.profit || 0;
        row.costSold += (p.buy_avg_price || 0) * (p.quantity || 0);
      });

      // 배당(세후 실수령 = 배당금 − 세금)
      dividends.forEach((d) => {
        if (!inScope(d.account_id)) return;
        const row = ensure(d.asset_id, d.asset?.name || '', d.asset?.ticker || '');
        row.dividend += (d.amount || 0) - (d.tax || 0);
      });

      const list = Array.from(map.values()).filter(
        (r) => r.qty > 0 || r.realized !== 0 || r.dividend !== 0 || r.costSold > 0
      );
      setRows(list);
      setLoading(false);

      // 시세는 비차단으로 받아 평가손익 갱신
      const tickers = Array.from(
        new Set(list.filter((r) => r.qty > 0 && r.ticker).map((r) => r.ticker))
      );
      if (tickers.length > 0) {
        apiClient
          .GetCurrentPrices(tickers)
          .then((res) => {
            const prices = (res || {}) as Record<string, any>;
            const m: Record<string, number> = {};
            tickers.forEach((t) => {
              const pd = prices[t.toUpperCase()] || prices[t];
              const price = Number(pd?.price || 0);
              if (price > 0) m[t] = price;
            });
            setPriceMap(m);
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error('Failed to load total return:', err);
      setLoading(false);
    }
  };

  const toKRW = (value: number, currency: string) => (currency === 'USD' ? value * exchangeRate : value);

  // 행별 계산
  const computed = rows.map((r) => {
    const price = priceMap[r.ticker];
    const hasPrice = r.qty <= 0 ? true : price !== undefined && price > 0;
    const marketValue = r.qty > 0 && price ? r.qty * price : 0;
    const unrealized = r.qty > 0 && price ? marketValue - r.costHolding : 0;
    const total = unrealized + r.realized + r.dividend;
    const cost = r.costHolding + r.costSold;
    const yieldPercent = cost > 0 ? (total / cost) * 100 : 0;
    return { ...r, marketValue, unrealized, total, cost, yieldPercent, hasPrice };
  });

  // KRW 환산 실질손익 기준 정렬
  const sorted = [...computed].sort((a, b) => toKRW(b.total, b.currency) - toKRW(a.total, a.currency));

  // 합계 (KRW 환산)
  const summary = sorted.reduce(
    (acc, r) => {
      acc.marketValue += toKRW(r.marketValue, r.currency);
      acc.unrealized += toKRW(r.unrealized, r.currency);
      acc.realized += toKRW(r.realized, r.currency);
      acc.dividend += toKRW(r.dividend, r.currency);
      acc.total += toKRW(r.total, r.currency);
      acc.cost += toKRW(r.cost, r.currency);
      return acc;
    },
    { marketValue: 0, unrealized: 0, realized: 0, dividend: 0, total: 0, cost: 0 }
  );
  const summaryYield = summary.cost > 0 ? (summary.total / summary.cost) * 100 : 0;

  const pnlClass = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-red-400');

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-slate-700">
        <div className="text-center py-8 text-slate-400">종합 손익 계산 중...</div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-4 sm:p-6 border border-slate-700">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg sm:text-xl font-bold text-white">종목별 실질 손익</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        실질손익 = 평가손익(미실현) + 실현손익 + 배당(세후) · 수익률 = 실질손익 ÷ (보유원가 + 매도분 원가)
      </p>

      {sorted.length === 0 ? (
        <div className="text-center py-10 text-slate-400">
          <Wallet className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>표시할 손익 데이터가 없습니다.</p>
        </div>
      ) : (
        <>
          {/* 합계 요약 (KRW 환산) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <div className="bg-gradient-to-br from-slate-700/40 to-slate-900/60 rounded-lg p-3 border border-slate-700/50">
              <p className="text-xs text-slate-500 mb-1">평가금</p>
              <p className="text-sm font-bold text-white">{formatMoney(summary.marketValue, 'KRW')}</p>
            </div>
            <div className="bg-gradient-to-br from-slate-700/40 to-slate-900/60 rounded-lg p-3 border border-slate-700/50">
              <p className="text-xs text-slate-500 mb-1">평가손익</p>
              <p className={`text-sm font-bold ${pnlClass(summary.unrealized)}`}>{signed(summary.unrealized, 'KRW')}</p>
            </div>
            <div className="bg-gradient-to-br from-slate-700/40 to-slate-900/60 rounded-lg p-3 border border-slate-700/50">
              <p className="text-xs text-slate-500 mb-1">실현손익</p>
              <p className={`text-sm font-bold ${pnlClass(summary.realized)}`}>{signed(summary.realized, 'KRW')}</p>
            </div>
            <div className="bg-gradient-to-br from-slate-700/40 to-slate-900/60 rounded-lg p-3 border border-slate-700/50">
              <p className="text-xs text-slate-500 mb-1">배당(세후)</p>
              <p className="text-sm font-bold text-emerald-400">{signed(summary.dividend, 'KRW')}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-500/25 to-purple-500/5 border border-purple-500/30 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">실질손익</p>
              <p className={`text-sm font-bold ${pnlClass(summary.total)}`}>{signed(summary.total, 'KRW')}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-500/25 to-purple-500/5 border border-purple-500/30 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">수익률</p>
              <p className={`text-sm font-bold ${pnlClass(summaryYield)}`}>
                {summaryYield >= 0 ? '+' : ''}
                {summaryYield.toFixed(2)}%
              </p>
            </div>
          </div>

          {/* 종목별 테이블 */}
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-800/70 text-xs text-slate-400 border-b border-slate-700">
                  <th className="text-left font-medium px-3 py-2.5">종목</th>
                  <th className="text-right font-medium px-3 py-2.5">평가금</th>
                  <th className="text-right font-medium px-3 py-2.5">평가손익</th>
                  <th className="text-right font-medium px-3 py-2.5">실현손익</th>
                  <th className="text-right font-medium px-3 py-2.5">배당(세후)</th>
                  <th className="text-right font-medium px-3 py-2.5">실질손익</th>
                  <th className="text-right font-medium px-3 py-2.5">수익률</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {sorted.map((r) => (
                  <tr
                    key={r.assetId}
                    onClick={onSelectAsset ? () => onSelectAsset({ assetId: r.assetId, ticker: r.ticker, name: r.name }) : undefined}
                    className={`hover:bg-slate-800/50 transition-colors ${onSelectAsset ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-3 py-2.5 min-w-[170px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">{r.currency === 'KRW' ? '🇰🇷' : '🇺🇸'}</span>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{r.name}</p>
                          <p className="text-xs text-slate-500">
                            {r.ticker}
                            {r.qty <= 0 && <span className="ml-1 text-slate-600">· 보유종료</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    {/* 평가금 */}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {r.qty <= 0 ? (
                        <span className="text-slate-600">—</span>
                      ) : r.hasPrice ? (
                        <div>
                          <p className="text-white font-medium">{formatMoney(r.marketValue, r.currency)}</p>
                          <p className="text-xs text-slate-500">{formatNumber(r.qty, 4)}주</p>
                        </div>
                      ) : (
                        <span className="text-slate-500">…</span>
                      )}
                    </td>
                    {/* 평가손익 */}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {r.qty <= 0 ? (
                        <span className="text-slate-600">—</span>
                      ) : r.hasPrice ? (
                        <span className={pnlClass(r.unrealized)}>{signed(r.unrealized, r.currency)}</span>
                      ) : (
                        <span className="text-slate-500">…</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {r.realized !== 0 ? (
                        <span className={pnlClass(r.realized)}>{signed(r.realized, r.currency)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {r.dividend !== 0 ? (
                        <span className="text-emerald-400">{signed(r.dividend, r.currency)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <span className={`font-semibold ${pnlClass(r.total)}`}>{signed(r.total, r.currency)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {r.cost > 0 ? (
                        <span className={`text-xs font-medium ${pnlClass(r.yieldPercent)}`}>
                          {r.yieldPercent >= 0 ? '+' : ''}
                          {r.yieldPercent.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1">
            <TrendingDown className="w-3 h-3" />
            합계는 USD를 환율 ₩{Math.round(exchangeRate).toLocaleString('ko-KR')} 기준으로 환산했습니다. 평가손익은 실시간 시세 기준입니다.
          </p>
        </>
      )}
    </div>
  );
}
