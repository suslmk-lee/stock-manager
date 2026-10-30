import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, LineChart as LineChartIcon, RefreshCw } from 'lucide-react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceArea, CartesianGrid } from 'recharts';
import { apiClient } from '../api/client';
import { DailyAssetPoint, DailyAssetSeries } from '../types/models';
import CountUp from './CountUp';
import Portal from './ui/Portal';
import IconTile from './ui/IconTile';
import { useThemeColors } from '../appearance/AppearanceContext';

interface TotalAssetTrendModalProps {
  onClose: () => void;
}

type RangeKey = '1m' | '3m' | '6m' | '1y' | '2y' | 'all';
type ViewKey = 'total' | 'split' | 'dividend';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '1m', label: '1개월' },
  { key: '3m', label: '3개월' },
  { key: '6m', label: '6개월' },
  { key: '1y', label: '1년' },
  { key: '2y', label: '2년' },
  { key: 'all', label: '전체' },
];
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'total', label: '총자산' },
  { key: 'split', label: '인출 가능/제한' },
  { key: 'dividend', label: '배당 포함' },
];

// 차트용 가공 포인트: 실제/추정 구간을 별도 키로 나눠 스타일을 다르게 그린다.
interface ChartPoint extends DailyAssetPoint {
  total_real: number | null;
  total_est: number | null;
  with_div: number;
}

const formatKRW = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`;
const compactKRW = (v: number) => {
  const a = Math.abs(v);
  if (a >= 100000000) return `${(v / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  if (a >= 10000) return `${Math.round(v / 10000).toLocaleString()}만`;
  return `${Math.round(v).toLocaleString('ko-KR')}`;
};
const signed = (v: number) => `${v >= 0 ? '+' : '-'}${formatKRW(Math.abs(v))}`;
const signedPct = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`;
const deltaColor = (v: number) => (v > 0 ? 'text-mint-300' : v < 0 ? 'text-rose-300' : 'text-zinc-300');
const errMsg = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : '알 수 없는 오류');

export default function TotalAssetTrendModal({ onClose }: TotalAssetTrendModalProps) {
  const tc = useThemeColors();
  const [range, setRange] = useState<RangeKey>('1y');
  const [view, setView] = useState<ViewKey>('total');
  const [series, setSeries] = useState<DailyAssetSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const TOTAL_COLOR = tc.accent;
  const COST_COLOR = tc.palette[2] ?? tc.axis;
  const DIV_COLOR = tc.palette[1];
  const LIQUID_COLOR = tc.accent;
  const RESTRICTED_COLOR = tc.restricted;

  // Esc 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiClient.GetDailyAssetSeries(range, 'auto');
        if (!cancelled) setSeries(data);
      } catch (e) {
        if (!cancelled) {
          setSeries(null);
          setError(errMsg(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, reloadKey]);

  const handleCapture = useCallback(async () => {
    setCapturing(true);
    setError('');
    setNotice('');
    try {
      const res = await apiClient.CaptureDailySnapshot();
      setNotice(res?.backfill_started ? '기록했습니다. 과거 추정 데이터를 계산하는 중입니다.' : '오늘의 자산을 기록했습니다.');
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCapturing(false);
    }
  }, []);

  const points = series?.points ?? [];

  const data = useMemo<ChartPoint[]>(() => {
    return points.map((p, i) => {
      const prev = points[i - 1];
      const next = points[i + 1];
      // 구간 경계에서 선이 끊기지 않도록 추정 구간 끝에 맞닿은 실제 점도 추정 시리즈에 포함
      const joinEst = !p.estimated && prev?.estimated;
      const joinReal = p.estimated && next && !next.estimated;
      return {
        ...p,
        total_real: !p.estimated || joinReal ? p.total_krw : null,
        total_est: p.estimated || joinEst ? p.total_krw : null,
        with_div: p.total_krw + p.dividends_cum_krw,
      };
    });
  }, [points]);

  // 연속된 추정 구간
  const estimatedRuns = useMemo(() => {
    const runs: { x1: string; x2: string }[] = [];
    let start: string | null = null;
    let last = '';
    for (const p of points) {
      if (p.estimated) {
        if (start === null) start = p.date;
        last = p.date;
      } else if (start !== null) {
        runs.push({ x1: start, x2: last });
        start = null;
      }
    }
    if (start !== null) runs.push({ x1: start, x2: last });
    return runs;
  }, [points]);

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const first = points[0];
    const last = points[points.length - 1];
    let max = first;
    let min = first;
    let peak = first.total_krw;
    let maxDd = 0;
    for (const p of points) {
      if (p.total_krw > max.total_krw) max = p;
      if (p.total_krw < min.total_krw) min = p;
      if (p.total_krw > peak) peak = p.total_krw;
      if (peak > 0) maxDd = Math.max(maxDd, (peak - p.total_krw) / peak);
    }
    const change = last.total_krw - first.total_krw;
    const pl = last.total_krw - last.cost_krw;
    return {
      first,
      last,
      max,
      min,
      change,
      changePct: first.total_krw > 0 ? (change / first.total_krw) * 100 : null,
      maxDd: maxDd * 100,
      pl,
      plPct: last.cost_krw > 0 ? (pl / last.cost_krw) * 100 : null,
    };
  }, [points]);

  const longRange = range === '1y' || range === '2y' || range === 'all';
  const tickFormat = (d: string) => {
    const [y, m, day] = d.split('-');
    if (!y || !m) return d;
    return longRange ? `${y.slice(2)}.${m}` : `${Number(m)}/${Number(day)}`;
  };

  const showRestricted = points.some((p) => p.restricted_krw > 0);
  const hasEstimated = estimatedRuns.length > 0;
  const axisTick = { fontSize: 11, fill: tc.axis, fontFamily: 'JetBrains Mono, monospace' };

  const subtitle = series
    ? `실제 기록 ${series.real_count}일 · 추정 ${series.estimated_count}일${series.last_real_date ? ` · 마지막 기록 ${series.last_real_date}` : ''}`
    : '일별 총자산 기록';

  const pill = (active: boolean) => `pill-item ${active ? 'pill-item-active' : ''}`;
  const tile = 'surface-inset p-3 sm:p-4 min-w-0';

  const renderTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const p = payload[0].payload as ChartPoint;
    const pl = p.total_krw - p.cost_krw;
    const row = (label: string, value: string, color?: string) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: tc.muted }}>{label}</span>
        <span style={{ color: color ?? tc.text }}>{value}</span>
      </div>
    );
    return (
      <div style={{ ...tc.tooltip.contentStyle, padding: '10px 12px', minWidth: 190 }}>
        <p style={{ color: tc.tooltip.labelStyle.color, marginBottom: 4 }}>
          {p.date}
          {p.estimated && <span className="ml-1.5 chip !px-1.5 !py-0 !text-[10px]">추정</span>}
        </p>
        {row('총자산', formatKRW(p.total_krw), TOTAL_COLOR)}
        {row('투자 원금', formatKRW(p.cost_krw))}
        {row('손익', signed(pl), pl >= 0 ? undefined : undefined)}
        {row('인출 가능', formatKRW(p.liquid_krw))}
        {row('인출 제한', formatKRW(p.restricted_krw))}
        {row('누적 배당', formatKRW(p.dividends_cum_krw), DIV_COLOR)}
        {row('USD/KRW', p.usd_krw ? p.usd_krw.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '-')}
      </div>
    );
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="총자산 추이"
          className="surface w-full max-w-5xl max-h-[92vh] overflow-y-auto p-4 sm:p-6"
        >
          {/* 헤더 */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <IconTile icon={LineChartIcon} tone="mint" size="sm" />
              <div className="min-w-0">
                <h3 className="section-title">총자산 추이</h3>
                <p className="label-mono !normal-case !text-zinc-500 mt-0.5 break-words">{subtitle}</p>
              </div>
            </div>
            <button onClick={onClose} className="btn-icon shrink-0" aria-label="닫기" title="닫기 (Esc)">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 필터 */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="glass-pill flex flex-wrap">
              {RANGES.map((r) => (
                <button key={r.key} onClick={() => setRange(r.key)} className={pill(range === r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="glass-pill flex flex-wrap">
              {VIEWS.map((v) => (
                <button key={v.key} onClick={() => setView(v.key)} className={pill(view === v.key)}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="animate-pulse" aria-busy="true">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-16 rounded-2xl bg-white/[0.05]" />
                ))}
              </div>
              <div className="h-80 rounded-2xl bg-white/[0.04]" />
            </div>
          ) : points.length === 0 || !stats ? (
            <div className="surface-inset p-6 text-center">
              <p className="text-sm text-zinc-300 mb-1">표시할 기록이 없습니다.</p>
              <p className="text-xs text-zinc-500 leading-relaxed">
                총자산은 매일 한 번 자동으로 기록됩니다. 과거 기록은 거래 내역과 과거 시세로 계산해 채우는 중일 수 있으니
                잠시 후 다시 확인하거나 지금 기록해 보세요.
              </p>
            </div>
          ) : (
            <>
              {/* 요약 */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
                <div className={tile}>
                  <p className="label-mono mb-1.5">현재 총자산</p>
                  <p className="num text-lg sm:text-xl font-light text-white break-all">
                    <CountUp value={stats.last.total_krw} format={formatKRW} />
                  </p>
                </div>
                <div className={tile}>
                  <p className="label-mono mb-1.5">기간 증감</p>
                  <p className={`num text-sm sm:text-base font-light break-all ${deltaColor(stats.change)}`}>
                    {signed(stats.change)}
                    {stats.changePct !== null && <span className="ml-1 text-xs">({signedPct(stats.changePct)})</span>}
                  </p>
                </div>
                <div className={tile}>
                  <p className="label-mono mb-1.5">기간 최고 / 최저</p>
                  <p className="num text-xs text-mint-300 break-all">
                    {formatKRW(stats.max.total_krw)} <span className="text-zinc-500">{stats.max.date}</span>
                  </p>
                  <p className="num text-xs text-rose-300 break-all">
                    {formatKRW(stats.min.total_krw)} <span className="text-zinc-500">{stats.min.date}</span>
                  </p>
                </div>
                <div className={tile}>
                  <p className="label-mono mb-1.5">최고점 대비 하락</p>
                  <p className={`num text-sm sm:text-base font-light ${stats.maxDd > 0 ? 'text-rose-300' : 'text-zinc-300'}`}>
                    {stats.maxDd > 0 ? `-${stats.maxDd.toFixed(1)}%` : '0.0%'}
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">기간 중 최대 낙폭</p>
                </div>
                <div className={`${tile} col-span-2 lg:col-span-1`}>
                  <p className="label-mono mb-1.5">원금 대비 손익</p>
                  <p className={`num text-sm sm:text-base font-light break-all ${deltaColor(stats.pl)}`}>
                    {signed(stats.pl)}
                    {stats.plPct !== null && <span className="ml-1 text-xs">({signedPct(stats.plPct)})</span>}
                  </p>
                </div>
              </div>

              {/* 차트 */}
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="tat-total" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={TOTAL_COLOR} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={TOTAL_COLOR} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="tat-total-est" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={TOTAL_COLOR} stopOpacity={0.14} />
                        <stop offset="100%" stopColor={TOTAL_COLOR} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="tat-liquid" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={LIQUID_COLOR} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={LIQUID_COLOR} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="tat-restricted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={RESTRICTED_COLOR} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={RESTRICTED_COLOR} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={tc.grid} strokeOpacity={0.4} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={axisTick}
                      tickFormatter={tickFormat}
                      minTickGap={36}
                      axisLine={{ stroke: tc.grid }}
                      tickLine={false}
                    />
                    <YAxis tick={axisTick} domain={[0, 'auto']} width={55} axisLine={false} tickLine={false} tickFormatter={compactKRW} />
                    <Tooltip content={renderTooltip} />
                    <Legend wrapperStyle={{ fontSize: 11, color: tc.muted }} iconType="circle" iconSize={8} />
                    {estimatedRuns.map((r) => (
                      <ReferenceArea
                        key={r.x1}
                        x1={r.x1}
                        x2={r.x2}
                        fill={tc.text}
                        fillOpacity={0.05}
                        stroke="none"
                        ifOverflow="extendDomain"
                        label={{ value: '추정', position: 'insideTop', fill: tc.axis, fontSize: 10 }}
                      />
                    ))}

                    {view === 'total' && (
                      <>
                        <Area type="monotone" dataKey="total_est" name="총자산 (추정)" legendType="none" stroke={TOTAL_COLOR} strokeOpacity={0.55} strokeDasharray="4 3" strokeWidth={1.5} fill="url(#tat-total-est)" connectNulls={false} dot={false} isAnimationActive={false} />
                        <Area type="monotone" dataKey="total_real" name="총자산" stroke={TOTAL_COLOR} strokeWidth={1.75} fill="url(#tat-total)" connectNulls={false} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="cost_krw" name="투자 원금" stroke={COST_COLOR} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                      </>
                    )}
                    {view === 'split' && (
                      <>
                        <Area type="monotone" dataKey="liquid_krw" name="인출 가능" stackId="a" stroke={LIQUID_COLOR} strokeWidth={1.75} fill="url(#tat-liquid)" dot={false} isAnimationActive={false} />
                        {showRestricted && (
                          <Area type="monotone" dataKey="restricted_krw" name="인출 제한" stackId="a" stroke={RESTRICTED_COLOR} strokeWidth={1.75} fill="url(#tat-restricted)" dot={false} isAnimationActive={false} />
                        )}
                      </>
                    )}
                    {view === 'dividend' && (
                      <>
                        <Line type="monotone" dataKey="total_krw" name="총자산" stroke={TOTAL_COLOR} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="with_div" name="총자산 + 누적 배당" stroke={DIV_COLOR} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="cost_krw" name="투자 원금" stroke={COST_COLOR} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                      </>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {hasEstimated && (
                <p className="mt-2 label-mono !text-zinc-500 normal-case">
                  추정 구간(음영·점선): 거래 내역과 과거 시세로 계산
                </p>
              )}
            </>
          )}

          {/* 푸터 */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={handleCapture} disabled={capturing} className="btn-ghost !py-1.5 !text-xs disabled:opacity-60">
              <RefreshCw className={`w-4 h-4 ${capturing ? 'animate-spin' : ''}`} />
              {capturing ? '기록 중...' : '지금 기록'}
            </button>
            {notice && !error && <span className="text-xs text-mint-300">{notice}</span>}
            {error && (
              <span className="text-xs text-rose-300 break-all" role="alert">
                {error}
              </span>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
