import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../../api/client';
import type { DivScoreDetail, DivScoreRow, DivScoreWeights, HoldingWithDetails, MissingDividend } from '../../types/models';
import { useThemeColors } from '../../appearance/AppearanceContext';
import { assetPrimary, assetSecondary, tickerFirst } from '../../utils/assetLabel';
import { dps, PART_KEYS, PART_LABEL, partPoints, partReason, pct, shortMonth, signedPct, STATUS_META } from './scoreText';
import PaymentHistory from './PaymentHistory';
import BrokerLogo from '../ui/BrokerLogo';
import { accountDisplayName } from '../../utils/accountLabel';
import PriceTrend from './PriceTrend';
import InvestCash, { type CashContext } from './InvestCash';

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '불러오지 못했습니다.');
const shortDate = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="label-mono">{label}</p>
      <p className="num mt-0.5 truncate text-[15px] text-white">{value}</p>
      {sub && <p className="num truncate text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export function MissingList({ items, onRecord }: { items: MissingDividend[]; onRecord?: (m: MissingDividend) => void }) {
  return (
    <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
      {items.map((m) => (
        <div key={`${m.account_id}-${m.asset_id}-${m.ex_date}`} className="flex items-center gap-3 px-3 py-2">
          <BrokerLogo broker={m.account_broker} className="h-7 w-16 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2 text-[13px] text-zinc-100">
              <span className="shrink-0 font-medium">{/\.(KS|KQ)$/i.test(m.ticker) ? m.asset_name : m.ticker}</span>
              <span className="truncate text-[11.5px] text-zinc-400">{accountDisplayName({ name: m.account_name, broker: m.account_broker })}</span>
            </span>
            <span className="num block text-[11px] text-zinc-500">
              배당락 {shortDate(m.ex_date)} · 주당 {dps(m.per_share, m.currency)} × {m.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}주
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="num block text-[13px] text-zinc-100">≈ {dps(m.expected_net, m.currency)}</span>
            <span className={`block text-[11px] ${m.status === 'missing' ? 'text-amber-300' : 'text-zinc-500'}`}>{m.status === 'missing' ? `${shortDate(m.pay_by)}까지 안 들어옴` : `${shortDate(m.pay_by)}까지 들어올 수 있음`}</span>
          </span>
          {onRecord && (
            <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 !text-xs" onClick={() => onRecord(m)}>
              기록
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ScoreDetail({
  row,
  total,
  weights,
  missing,
  onRecord,
}: {
  row: DivScoreRow;
  total: number;
  weights: DivScoreWeights;
  missing: MissingDividend[];
  onRecord?: (m: MissingDividend) => void;
}) {
  const tc = useThemeColors();
  const [detail, setDetail] = useState<DivScoreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    apiClient
      .GetDividendScoreDetail(row.asset_id)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(errText(e)));
    return () => {
      cancelled = true;
    };
  }, [row.asset_id, weights]);

  // 계좌·예수금·보유는 종목과 상관없이 한 번만 받는다
  const [cash, setCash] = useState<CashContext | null | 'error'>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([apiClient.GetAllAccounts(), apiClient.GetCashBalances(), apiClient.GetAllHoldings()])
      .then(([accounts, cb, holdings]) => {
        if (!cancelled) setCash({ accounts: accounts ?? [], balances: cb?.balances ?? [], usdKrw: cb?.usd_krw ?? 0, holdings: (holdings ?? []) as HoldingWithDetails[] });
      })
      .catch(() => !cancelled && setCash('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  // 현재가: 주가 이력의 마지막 종가 (오기 전에는 점수 계산 때의 가격)
  const [latest, setLatest] = useState<{ id: number; close: number } | null>(null);
  const onLatest = useCallback((close: number) => setLatest({ id: row.asset_id, close }), [row.asset_id]);
  const price = latest?.id === row.asset_id ? latest.close : row.metrics.price ?? null;

  // 내 평단 (보유 계좌 전체의 수량 가중 평균)
  const avgPrice = useMemo(() => {
    if (!cash || cash === 'error') return undefined;
    let q = 0;
    let cost = 0;
    for (const h of cash.holdings) {
      if (h.asset_id !== row.asset_id || h.quantity <= 0) continue;
      q += h.quantity;
      cost += h.quantity * h.average_price;
    }
    return q > 0 && cost > 0 ? cost / q : undefined;
  }, [cash, row.asset_id]);

  const m = row.metrics;
  const ccy = detail?.currency || (/\.(KS|KQ)$/i.test(row.asset.ticker) ? 'KRW' : 'USD');
  const first = tickerFirst(row.asset);
  const st = STATUS_META[m.status];
  const delta = row.prev_rank != null ? row.prev_rank - row.rank : null;
  const axisTick = { fontSize: 11, fill: tc.axis, fontFamily: 'JetBrains Mono, monospace' };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* 머리말 */}
      <div className="border-b border-white/[0.07] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="num rounded-lg bg-mint-400/15 px-2 py-0.5 text-sm font-semibold text-mint-300">#{row.rank}</span>
              <h2 className={`truncate font-semibold text-white ${first ? 'text-2xl tracking-tight' : 'text-lg'}`}>{assetPrimary(row.asset)}</h2>
              <span className={`badge !py-0 text-[11px] ${st.cls}`} title={st.hint}>
                {st.label}
              </span>
              {row.estimated && <span className="chip !px-1.5 !py-0 !text-[10px]">추정</span>}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-zinc-500">
              {assetSecondary(row.asset)} · {total}종목 중 {row.rank}위
              {delta != null && delta !== 0 && <span className={delta > 0 ? 'text-mint-300' : 'text-rose-300'}> · 지난달 {row.prev_rank}위 ({delta > 0 ? `▲${delta}` : `▼${-delta}`})</span>}
              {row.prev_rank == null && ' · 지난달 순위 없음'}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="num text-3xl font-light text-white">
              {row.score.toFixed(1)}
              <span className="text-sm text-zinc-500">점</span>
            </p>
            {row.prev_score != null && <p className={`num text-[11px] ${row.score - row.prev_score >= 0 ? 'text-mint-300' : 'text-rose-300'}`}>지난달 대비 {(row.score - row.prev_score >= 0 ? '+' : '') + (row.score - row.prev_score).toFixed(1)}</p>}
          </div>
        </div>
      </div>

      {/* 항목별 점수 */}
      <div className="space-y-3 border-b border-white/[0.07] p-4 sm:p-5">
        {PART_KEYS.map((k) => {
          const { got, max } = partPoints(k, row.parts, weights);
          return (
            <div key={k}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-zinc-200">{PART_LABEL[k]}</span>
                <span className="num text-zinc-100">
                  {got.toFixed(1)} <span className="text-[11px] text-zinc-500">/ {max.toFixed(0)}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-mint-400" style={{ width: `${row.parts[k] * 100}%` }} />
              </div>
              <p className="num mt-1 text-[11px] text-zinc-500">{partReason(k, m)}</p>
            </div>
          );
        })}
      </div>

      {/* 지표 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-white/[0.07] p-4 sm:grid-cols-3 sm:p-5">
        <Metric label="최근 12개월 주당 배당" value={dps(m.ttm, ccy)} sub={m.specials_12m > 0 ? `특별배당 ${m.specials_12m}회 제외` : m.source === 'records' ? '내 배당 기록으로 계산' : '시장 배당 이력'} />
        <Metric label="배당수익률" value={pct(m.yield_pct, 2)} sub={m.avg_yield_pct != null ? `2년 평균 ${pct(m.avg_yield_pct, 2)}` : undefined} />
        <Metric label="내 평단 대비 배당률" value={pct(row.yoc_pct, 2)} sub="최근 12개월 ÷ 평균 매수가" />
        <Metric label="1년 · 3년 연평균 증가" value={m.growth_1y != null ? signedPct(m.growth_1y) : '—'} sub={m.cagr_3y != null ? `3년 ${signedPct(m.cagr_3y)}/년` : '3년 이력 부족'} />
        <Metric label="주기" value={m.cycle || '—'} sub={`최근 12개월 ${m.payments_12m}회`} />
        <Metric label="마지막 · 다음 배당" value={m.last_payment ? shortDate(m.last_payment) : '—'} sub={m.missed_now ? '다음 회차가 늦어지고 있음' : m.next_expected ? `다음 예상 ${shortDate(m.next_expected)}` : undefined} />
      </div>

      {/* 주가 추이 · 살 수 있는 예수금 */}
      <div className="space-y-5 border-b border-white/[0.07] p-4 sm:p-5">
        <PriceTrend ticker={row.asset.ticker} ccy={ccy} payments={detail?.payments ?? []} source={detail?.source} avgPrice={avgPrice} onLatest={onLatest} />
        <InvestCash asset={row.asset} ccy={ccy} price={price} ctx={cash} />
      </div>

      {error && <p className="m-4 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
      {!detail && !error && <div className="m-4 h-40 animate-pulse rounded-xl bg-white/[0.03]" />}
      {detail && (
        <>
          <div className="grid grid-cols-1 gap-5 border-b border-white/[0.07] p-4 sm:p-5 xl:grid-cols-2">
            <div>
              <p className="label-mono mb-2">연도별 주당 배당 ({ccy === 'KRW' ? '원' : '$'})</p>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={detail.years.map((y) => ({ ...y, label: y.partial ? `${y.year}*` : String(y.year) }))} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={tc.grid} strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis tick={axisTick} width={46} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tc.tooltip.contentStyle} labelStyle={tc.tooltip.labelStyle} itemStyle={tc.tooltip.itemStyle} formatter={(v: number) => dps(v, ccy)} cursor={{ fill: tc.grid, opacity: 0.35 }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: tc.muted }} iconType="circle" iconSize={8} />
                    <Bar dataKey="regular" name="정기" stackId="y" fill={tc.accent} isAnimationActive={false} />
                    <Bar dataKey="special" name="특별" stackId="y" fill={tc.palette[2]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">* 올해는 진행 중</p>
            </div>
            <div>
              <p className="label-mono mb-2">월별 점수 · 순위 (매달 1일 기준)</p>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={detail.history.map((h) => ({ ...h, label: shortMonth(h.month) }))} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={tc.grid} strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis tick={axisTick} width={32} domain={[0, 100]} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={tc.tooltip.contentStyle}
                      labelStyle={tc.tooltip.labelStyle}
                      itemStyle={tc.tooltip.itemStyle}
                      formatter={(v: number, _n: string, p: { payload?: { rank: number; of: number; estimated: boolean } }) => [`${v.toFixed(1)}점 · ${p.payload?.rank}/${p.payload?.of}위${p.payload?.estimated ? ' (추정)' : ''}`, '점수']}
                    />
                    <Line type="monotone" dataKey="score" stroke={tc.accent} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {missing.length > 0 && (
            <div className="border-b border-white/[0.07] p-4 sm:p-5">
              <p className="label-mono mb-1.5">내 배당 기록에 없는 회차</p>
              <MissingList items={missing} onRecord={onRecord} />
            </div>
          )}

          <div className="p-4 sm:p-5">
            <PaymentHistory payments={detail.payments} ccy={ccy} metrics={m} source={detail.source} />
          </div>
        </>
      )}
    </div>
  );
}
