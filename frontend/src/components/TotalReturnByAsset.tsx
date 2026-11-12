import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account, Holding, RealizedPnL, Dividend } from '../types/models';
import { TrendingDown, Wallet } from 'lucide-react';
import { LiquidityFilter, matchesLiquidity } from '../utils/accountType';
import CardIcon from './ui/CardIcon';
import { IconTrend } from './ui/appIcons';
import { assetPrimary, assetSecondary } from '../utils/assetLabel';

interface TotalReturnByAssetProps {
  accountId?: number;
  marketType?: string;
  liquidity?: LiquidityFilter;
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

export default function TotalReturnByAsset({ accountId, marketType = 'all', liquidity = 'all', onSelectAsset }: TotalReturnByAssetProps) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [exchangeRate, setExchangeRate] = useState(1300);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, marketType, liquidity]);

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
        if (!matchesLiquidity(acc, liquidity)) return false;
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


  const pnlClass = (v: number) => (v >= 0 ? 'text-mint-300' : 'text-rose-300');

  if (loading) {
    return (
      <div className="surface p-6">
        <div className="text-center py-8 label-mono">종합 손익 계산 중...</div>
      </div>
    );
  }

  const summaryTile = 'surface-inset p-3.5';

  return (
    <div className="surface p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-1.5">
        <CardIcon icon={IconTrend} tone="amber" size="sm" />
        <h2 className="section-title">종목별 실질 손익</h2>
      </div>
      <p className="label-mono mb-5 normal-case">
        실질손익 = 평가손익(미실현) + 실현손익 + 배당(세후) · 수익률 = 실질손익 ÷ (보유원가 + 매도분 원가)
      </p>

      {sorted.length === 0 ? (
        <div className="text-center py-10 text-zinc-500">
          <Wallet className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>표시할 손익 데이터가 없습니다.</p>
        </div>
      ) : (
        <>
          {/* 합계 요약 (KRW 환산) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <div className={summaryTile}>
              <p className="label-mono mb-1.5">평가금</p>
              <p className="num text-sm font-medium text-white">{formatMoney(summary.marketValue, 'KRW')}</p>
            </div>
            <div className={summaryTile}>
              <p className="label-mono mb-1.5">평가손익</p>
              <p className={`num text-sm font-medium ${pnlClass(summary.unrealized)}`}>{signed(summary.unrealized, 'KRW')}</p>
            </div>
            <div className={summaryTile}>
              <p className="label-mono mb-1.5">실현손익</p>
              <p className={`num text-sm font-medium ${pnlClass(summary.realized)}`}>{signed(summary.realized, 'KRW')}</p>
            </div>
            <div className={summaryTile}>
              <p className="label-mono mb-1.5">배당(세후)</p>
              <p className="num text-sm font-medium text-mint-300">{signed(summary.dividend, 'KRW')}</p>
            </div>
            <div className={`${summaryTile} !border-mint-400/25`} style={{ background: 'linear-gradient(180deg, rgb(var(--c-mint-400) / 0.1), rgb(var(--c-mint-400) / 0.02))' }}>
              <p className="label-mono mb-1.5 !text-mint-300/80">실질손익</p>
              <p className={`num text-sm font-medium ${pnlClass(summary.total)}`}>{signed(summary.total, 'KRW')}</p>
            </div>
            <div className={`${summaryTile} !border-mint-400/25`} style={{ background: 'linear-gradient(180deg, rgb(var(--c-mint-400) / 0.1), rgb(var(--c-mint-400) / 0.02))' }}>
              <p className="label-mono mb-1.5 !text-mint-300/80">수익률</p>
              <p className={`num text-sm font-medium ${pnlClass(summaryYield)}`}>
                {summaryYield >= 0 ? '+' : ''}
                {summaryYield.toFixed(2)}%
              </p>
            </div>
          </div>

          {/* 종목별 테이블 */}
          <div className="surface-inset overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="table-head border-b border-white/[0.08]">
                  <th className="text-left font-normal px-3 py-3">종목</th>
                  <th className="text-right font-normal px-3 py-3">평가금</th>
                  <th className="text-right font-normal px-3 py-3">평가손익</th>
                  <th className="text-right font-normal px-3 py-3">실현손익</th>
                  <th className="text-right font-normal px-3 py-3">배당(세후)</th>
                  <th className="text-right font-normal px-3 py-3">실질손익</th>
                  <th className="text-right font-normal px-3 py-3">수익률</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.assetId}
                    onClick={onSelectAsset ? () => onSelectAsset({ assetId: r.assetId, ticker: r.ticker, name: r.name }) : undefined}
                    className={`table-row last:border-b-0 ${onSelectAsset ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-3 py-3 min-w-[170px]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{r.currency === 'KRW' ? '🇰🇷' : '🇺🇸'}</span>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{assetPrimary(r)}</p>
                          <p className="label-mono mt-0.5">
                            {assetSecondary(r)}
                            {r.qty <= 0 && <span className="ml-1 text-zinc-600">· 보유종료</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    {/* 평가금 */}
                    <td className="px-3 py-3 text-right whitespace-nowrap num">
                      {r.qty <= 0 ? (
                        <span className="text-zinc-600">—</span>
                      ) : r.hasPrice ? (
                        <div>
                          <p className="text-white font-medium">{formatMoney(r.marketValue, r.currency)}</p>
                          <p className="label-mono mt-0.5">{formatNumber(r.qty, 4)}주</p>
                        </div>
                      ) : (
                        <span className="text-zinc-500">…</span>
                      )}
                    </td>
                    {/* 평가손익 */}
                    <td className="px-3 py-3 text-right whitespace-nowrap num">
                      {r.qty <= 0 ? (
                        <span className="text-zinc-600">—</span>
                      ) : r.hasPrice ? (
                        <span className={pnlClass(r.unrealized)}>{signed(r.unrealized, r.currency)}</span>
                      ) : (
                        <span className="text-zinc-500">…</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap num">
                      {r.realized !== 0 ? (
                        <span className={pnlClass(r.realized)}>{signed(r.realized, r.currency)}</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap num">
                      {r.dividend !== 0 ? (
                        <span className="text-mint-300">{signed(r.dividend, r.currency)}</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap num">
                      <span className={`font-semibold ${pnlClass(r.total)}`}>{signed(r.total, r.currency)}</span>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap num">
                      {r.cost > 0 ? (
                        <span
                          className={`badge ${
                            r.yieldPercent >= 0 ? 'bg-mint-400/10 text-mint-300' : 'bg-rose-400/10 text-rose-300'
                          }`}
                        >
                          {r.yieldPercent >= 0 ? '+' : ''}
                          {r.yieldPercent.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="label-mono mt-4 flex items-center gap-1.5 normal-case">
            <TrendingDown className="w-3 h-3" />
            합계는 USD를 환율 ₩{Math.round(exchangeRate).toLocaleString('ko-KR')} 기준으로 환산했습니다. 평가손익은 실시간 시세 기준입니다.
          </p>
        </>
      )}
    </div>
  );
}
