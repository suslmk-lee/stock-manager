import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../../api/client';
import type { PriceHistory } from '../../types/models';
import { useThemeColors } from '../../appearance/AppearanceContext';
import { niceTicks } from '../signals/PriceChart';
import { fmtCcy } from '../../utils/fx';
import { dps, signedPct } from './scoreText';

/**
 * 배당 점수 종목 상세의 주가 추이 — 종가 · 200일선 · 내 평단 · 배당락(받은 날) 표시,
 * 기간 주가 변화와 배당을 더한 수익률, 52주 범위.
 */

const DAY = 24 * 60 * 60;
const RANGES = [
  { key: '6m', label: '6개월', days: 183 },
  { key: '1y', label: '1년', days: 365 },
  { key: '3y', label: '3년', days: 1096 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

interface Pt {
  t: number;
  /** 거래소 기준 날짜 (YYYY-MM-DD) */
  day: string;
  close: number;
  ma200?: number;
  /** 이날 배당락(또는 받은 날)인 주당 배당 */
  div?: number;
  special?: boolean;
  /** 배당 점을 찍을 높이 (= 종가) */
  mark?: number;
}

// 종목을 다시 고를 때 같은 이력을 또 받지 않도록 이번 실행 동안 기억한다
const cache = new Map<string, Pt[]>();

/** 5년 일봉 → 종가와 200일 이동평균 (그날까지의 200거래일 평균) */
function toPoints(h: PriceHistory | null): Pt[] {
  const off = h?.gmtoffset ?? 0;
  const raw = (h?.points ?? []).filter((p) => p.close > 0);
  let sum = 0;
  return raw.map((p, i) => {
    sum += p.close;
    if (i >= 200) sum -= raw[i - 200].close;
    return { t: p.time, day: new Date((p.time + off) * 1000).toISOString().slice(0, 10), close: p.close, ma200: i >= 199 ? sum / 200 : undefined };
  });
}

const dayLabel = (d: string) => `${d.slice(0, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
const shortDay = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const tickLabel = (t: number, long: boolean) => {
  const d = new Date(t * 1000);
  return long ? `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}` : `${d.getMonth() + 1}월`;
};
const pctTone = (v: number) => (v > 0.05 ? 'text-mint-300' : v < -0.05 ? 'text-rose-300' : 'text-zinc-300');
/** 두 색(#rrggbb)의 거리 — 배당 점 색을 200일선·강조색과 겹치지 않게 고를 때 */
const colorDist = (a: string, b: string) => {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="label-mono">{label}</p>
      <div className="num mt-0.5 truncate text-[15px] text-white">{children}</div>
      {sub && <p className="num truncate text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export default function PriceTrend({
  ticker,
  ccy,
  payments,
  source,
  avgPrice,
  onLatest,
}: {
  ticker: string;
  ccy: string;
  /** 최근 3년 주당 배당 (시장 이력이면 배당락일, 내 기록이면 받은 날) */
  payments: { date: string; amount: number; special: boolean }[];
  source?: string;
  /** 내 평균 매수가 (보유 중일 때) */
  avgPrice?: number;
  /** 가장 최근 종가를 알려 준다 (살 수 있는 수량 계산용) */
  onLatest?: (close: number, day: string) => void;
}) {
  const tc = useThemeColors();
  const divColor = useMemo(() => tc.palette.find((c) => [tc.accent, tc.restricted, tc.text].every((o) => colorDist(c, o) > 90)) ?? tc.palette[1], [tc]);
  const [all, setAll] = useState<Pt[] | null>(() => cache.get(ticker) ?? null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<RangeKey>('1y');

  useEffect(() => {
    const hit = cache.get(ticker);
    if (hit) {
      setAll(hit);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setAll(null);
    setFailed(false);
    apiClient
      .GetPriceHistory(ticker, '5y', '1d')
      .then((h) => {
        const pts = toPoints(h as PriceHistory);
        cache.set(ticker, pts);
        if (!cancelled) setAll(pts);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const last = all && all.length > 0 ? all[all.length - 1] : null;
  useEffect(() => {
    if (last) onLatest?.(last.close, last.day);
  }, [last, onLatest]);

  const byPayDay = source === 'records';
  const markLabel = byPayDay ? '배당 받은 날' : '배당락';

  const view = useMemo(() => {
    if (!all || all.length < 2) return null;
    const end = all[all.length - 1];
    const days = RANGES.find((r) => r.key === range)?.days ?? 365;
    const pts = all.filter((p) => p.t >= end.t - days * DAY).map((p) => ({ ...p }));
    if (pts.length < 2) return null;
    const start = pts[0];

    // 기간 안의 배당: 그날(휴장이면 다음 거래일) 종가 위에 점을 찍고, 수익률에 더한다
    let divSum = 0;
    let divCount = 0;
    for (const pay of payments) {
      if (pay.date <= start.day || pay.date > end.day) continue;
      const p = pts.find((x) => x.day >= pay.date);
      if (!p) continue;
      p.div = (p.div ?? 0) + pay.amount;
      p.special = p.special || pay.special;
      p.mark = p.close;
      divSum += pay.amount;
      divCount++;
    }
    const priceChg = (end.close / start.close - 1) * 100;
    const totalChg = ((end.close + divSum) / start.close - 1) * 100;

    // 52주 최고·최저 (종가 기준)
    const yr = all.filter((p) => p.t >= end.t - 365 * DAY).map((p) => p.close);
    const hi = Math.max(...yr);
    const lo = Math.min(...yr);
    const pos = hi > lo ? (end.close - lo) / (hi - lo) : null;

    const vals = pts.flatMap((p) => (p.ma200 ? [p.close, p.ma200] : [p.close]));
    if (avgPrice && avgPrice > 0) vals.push(avgPrice);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    return { pts, start, end, priceChg, totalChg, divSum, divCount, hi, lo, pos, ticks, hasMa: pts.some((p) => p.ma200) };
  }, [all, range, payments, avgPrice]);

  const fmt = (v: number) => fmtCcy(v, ccy);
  const axisTick = { fontSize: 10, fill: tc.axis, fontFamily: 'JetBrains Mono, monospace' };
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? '';

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="label-mono">주가 추이</p>
        <div className="glass-pill inline-flex p-0.5">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRange(r.key)} className={`pill-item !px-2.5 !py-0.5 !text-[11px] ${range === r.key ? 'pill-item-active' : ''}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <p className="surface-inset flex h-40 items-center justify-center text-xs text-zinc-500">주가 이력을 불러오지 못했습니다.</p>
      ) : !all ? (
        <div className="h-64 animate-pulse rounded-xl bg-white/[0.03]" />
      ) : !view ? (
        <p className="surface-inset flex h-40 items-center justify-center text-xs text-zinc-500">표시할 주가 이력이 없습니다.</p>
      ) : (
        <div className="surface-inset px-4 pb-2 pt-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Stat label="현재가" sub={`${dayLabel(view.end.day)} 종가`}>
              {fmt(view.end.close)}
            </Stat>
            <Stat label={`${rangeLabel} 주가`} sub={`${shortDay(view.start.day)} ${fmt(view.start.close)}부터`}>
              <span className={pctTone(view.priceChg)}>{signedPct(view.priceChg)}</span>
            </Stat>
            <Stat label="배당 포함" sub={view.divCount > 0 ? `주당 배당 ${dps(view.divSum, ccy)} · ${view.divCount}회` : '기간 안 배당 없음'}>
              <span className={pctTone(view.totalChg)}>{signedPct(view.totalChg)}</span>
            </Stat>
            <Stat
              label="52주 범위"
              sub={
                <>
                  {fmt(view.lo)} ~ {fmt(view.hi)}
                </>
              }
            >
              {view.pos != null ? (
                <span className="flex items-center gap-2">
                  <span className="relative h-1.5 flex-1 rounded-full bg-white/[0.08]" title={`최저에서 ${Math.round(view.pos * 100)}% 위치`}>
                    <span className="absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint-400" style={{ left: `${view.pos * 100}%` }} />
                  </span>
                  <span className="text-[12px] text-zinc-300">{Math.round(view.pos * 100)}%</span>
                </span>
              ) : (
                '—'
              )}
            </Stat>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded-full" style={{ background: tc.text }} />
              종가
            </span>
            {view.hasMa && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: tc.restricted }} />
                200일선
              </span>
            )}
            {!!avgPrice && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: tc.accent }} />내 평단 {fmt(avgPrice)}
              </span>
            )}
            {view.divCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: divColor }} />
                {markLabel}
              </span>
            )}
          </div>

          <div className="mt-1 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={view.pts} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ds-price-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tc.accent} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={tc.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => tickLabel(t, range === '3y')} tick={axisTick} minTickGap={36} axisLine={{ stroke: tc.grid }} tickLine={false} />
                <YAxis
                  orientation="right"
                  domain={[view.ticks[0], view.ticks[view.ticks.length - 1]]}
                  ticks={view.ticks}
                  interval={0}
                  tickFormatter={fmt}
                  tick={axisTick}
                  width={ccy === 'USD' ? 58 : 72}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ stroke: tc.grid }}
                  content={({ active, payload }) => {
                    const p = active ? (payload?.[0]?.payload as Pt | undefined) : undefined;
                    if (!p) return null;
                    return (
                      <div style={{ ...tc.tooltip.contentStyle, padding: '8px 10px' }}>
                        <p style={tc.tooltip.labelStyle}>{dayLabel(p.day)}</p>
                        <p className="num" style={tc.tooltip.itemStyle}>
                          종가 {fmt(p.close)}
                        </p>
                        {p.ma200 != null && (
                          <p className="num" style={{ ...tc.tooltip.itemStyle, color: tc.restricted }}>
                            200일선 {fmt(p.ma200)}
                          </p>
                        )}
                        {p.div != null && (
                          <p className="num" style={{ ...tc.tooltip.itemStyle, color: divColor }}>
                            {markLabel} · 주당 {dps(p.div, ccy)}
                            {p.special ? ' (특별)' : ''}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                {!!avgPrice && <ReferenceLine y={avgPrice} stroke={tc.accent} strokeDasharray="4 4" strokeWidth={1.2} ifOverflow="extendDomain" />}
                <Area type="monotone" dataKey="close" stroke={tc.text} strokeWidth={1.6} fill="url(#ds-price-fill)" dot={false} isAnimationActive={false} />
                {view.hasMa && <Line type="monotone" dataKey="ma200" stroke={tc.restricted} strokeDasharray="5 4" strokeWidth={1.3} dot={false} activeDot={false} isAnimationActive={false} connectNulls />}
                {view.divCount > 0 && <Line dataKey="mark" stroke="none" dot={{ r: 2.6, fill: divColor, stroke: tc.surface, strokeWidth: 1 }} activeDot={false} isAnimationActive={false} legendType="none" />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">배당 포함 = 기간 주가 변화 + 받은 주당 배당 (재투자 없이 단순 합산)</p>
        </div>
      )}
    </div>
  );
}
