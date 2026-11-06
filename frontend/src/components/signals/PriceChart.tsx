import { useEffect, useMemo, useState } from 'react';
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../../api/client';
import type { PriceHistory } from '../../types/models';
import { useThemeColors } from '../../appearance/AppearanceContext';
import { formatPrice } from './SignalCard';

interface Point {
  t: number;
  close: number;
  ma200?: number;
}

// 종목을 다시 고를 때 같은 이력을 또 받지 않도록 이번 실행 동안 기억한다
const cache = new Map<string, Point[]>();

const DAY = 24 * 60 * 60;

/** 2년 일봉을 받아 최근 1년 종가와 200일 이동평균(그날까지의 200거래일 평균)을 만든다. */
function toSeries(h: PriceHistory | null): Point[] {
  const pts = (h?.points ?? []).filter((p) => p.close > 0);
  const out: Point[] = [];
  let sum = 0;
  const cutoff = (pts.length > 0 ? pts[pts.length - 1].time : 0) - 365 * DAY;
  pts.forEach((p, i) => {
    sum += p.close;
    if (i >= 200) sum -= pts[i - 200].close;
    if (p.time >= cutoff) out.push({ t: p.time, close: p.close, ma200: i >= 199 ? sum / 200 : undefined });
  });
  return out;
}

const monthLabel = (t: number) => `${new Date(t * 1000).getMonth() + 1}월`;
const dayLabel = (t: number) => new Date(t * 1000).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });

interface PriceChartProps {
  ticker: string;
  currency: string;
  avgPrice?: number;
}

/** 상세 패널의 1년 가격 차트: 종가, 200일선, 평단 */
export default function PriceChart({ ticker, currency, avgPrice }: PriceChartProps) {
  const tc = useThemeColors();
  const [series, setSeries] = useState<Point[] | null>(() => cache.get(ticker) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const hit = cache.get(ticker);
    if (hit) {
      setSeries(hit);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setSeries(null);
    setFailed(false);
    apiClient
      .GetPriceHistory(ticker, '2y', '1d')
      .then((h) => {
        const s = toSeries(h as PriceHistory);
        cache.set(ticker, s);
        if (!cancelled) setSeries(s);
      })
      .catch((err) => {
        console.error('Failed to load price history:', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const domain = useMemo<[number, number] | undefined>(() => {
    if (!series || series.length === 0) return undefined;
    const vals = series.flatMap((p) => (p.ma200 ? [p.close, p.ma200] : [p.close]));
    if (avgPrice && avgPrice > 0) vals.push(avgPrice);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || hi * 0.05;
    return [lo - pad, hi + pad];
  }, [series, avgPrice]);

  const hasMa = !!series?.some((p) => p.ma200);
  const fmt = (v: number) => formatPrice(v, currency);

  return (
    <div className="surface-inset px-4 pb-2 pt-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-200">1년 가격</span>
        <span className="flex items-center gap-3 font-mono text-[10.5px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: tc.text }} />
            종가
          </span>
          {hasMa && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: tc.restricted }} />
              200일선
            </span>
          )}
          {!!avgPrice && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: tc.accent }} />
              평단
            </span>
          )}
        </span>
      </div>
      <div className="h-48">
        {failed ? (
          <p className="flex h-full items-center justify-center text-xs text-zinc-500">가격 이력을 불러오지 못했습니다.</p>
        ) : !series ? (
          <div className="h-full animate-pulse rounded-lg bg-white/[0.03]" />
        ) : series.length < 2 ? (
          <p className="flex h-full items-center justify-center text-xs text-zinc-500">표시할 가격 이력이 없습니다.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={tc.accent} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={tc.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={monthLabel}
                tick={{ fontSize: 10, fill: tc.axis, fontFamily: 'JetBrains Mono, monospace' }}
                minTickGap={36}
                axisLine={{ stroke: tc.grid }}
                tickLine={false}
              />
              <YAxis
                orientation="right"
                domain={domain}
                tickFormatter={fmt}
                tick={{ fontSize: 10, fill: tc.axis, fontFamily: 'JetBrains Mono, monospace' }}
                width={currency === 'USD' ? 58 : 72}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tc.tooltip.contentStyle}
                labelStyle={tc.tooltip.labelStyle}
                itemStyle={tc.tooltip.itemStyle}
                labelFormatter={(t) => dayLabel(Number(t))}
                formatter={(v: number, name: string) => [fmt(v), name]}
              />
              {!!avgPrice && <ReferenceLine y={avgPrice} stroke={tc.accent} strokeDasharray="4 4" strokeWidth={1.2} ifOverflow="extendDomain" />}
              <Area type="monotone" dataKey="close" name="종가" stroke={tc.text} strokeWidth={1.6} fill="url(#price-fill)" dot={false} isAnimationActive={false} />
              {hasMa && <Line type="monotone" dataKey="ma200" name="200일선" stroke={tc.restricted} strokeDasharray="5 4" strokeWidth={1.3} dot={false} isAnimationActive={false} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
