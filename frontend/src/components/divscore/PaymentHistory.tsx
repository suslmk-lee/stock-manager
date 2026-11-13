import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, Cell as BarCell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DivScoreMetrics } from '../../types/models';
import { useThemeColors } from '../../appearance/AppearanceContext';
import { analyzePayments, SAME_MONTH_BAND, type Cell, type EventKind, type Pay, type PayEvent } from './paymentPattern';
import { dps, signedPct } from './scoreText';

/**
 * 배당 회차 (최근 3년) — 위에서 요약 숫자 · 회차별 막대(1년 평균 추세), 아래에 연도 × 월 달력표, 맨 아래 바뀐 점.
 */

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const EVENT_META: Record<EventKind, { label: string; cls: string }> = {
  up: { label: '인상', cls: 'bg-mint-400/15 text-mint-300' },
  down: { label: '인하', cls: 'bg-rose-500/15 text-rose-300' },
  special: { label: '특별', cls: 'bg-amber-500/15 text-amber-300' },
  extra: { label: '같은 달 추가', cls: 'bg-amber-500/15 text-amber-300' },
  missed: { label: '빠짐', cls: 'bg-rose-500/15 text-rose-300' },
};
const shortDate = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
/** 칸 안 숫자: 달러는 $ 없이 소수 셋째 자리까지, 원은 정수 */
const cellNum = (v: number, ccy: string) =>
  ccy === 'KRW' ? Math.round(v).toLocaleString('ko-KR') : v >= 10 ? v.toFixed(2) : v.toFixed(3);

function Stat({ label, value, sub, tone = 'text-white' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="label-mono">{label}</p>
      <p className={`num mt-0.5 truncate text-[15px] font-semibold ${tone}`}>{value}</p>
      {sub && <p className="num truncate text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

function CalendarCell({ c, ccy }: { c: Cell; ccy: string }) {
  if (c.kind === 'paid' && c.main) {
    const arrow = c.vsLastYear != null && Math.abs(c.vsLastYear) >= SAME_MONTH_BAND ? (c.vsLastYear > 0 ? 'up' : 'down') : null;
    const title = [
      `${c.main.date} · ${dps(c.main.amount, ccy)}${c.main.special ? ' (특별)' : ''}`,
      ...c.extras.map((e) => `${e.date} · ${dps(e.amount, ccy)} (같은 달 추가)`),
      c.vsLastYear != null ? `작년 같은 달 대비 ${signedPct(c.vsLastYear)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return (
      <div
        className={`relative flex h-11 flex-col items-center justify-center rounded-lg ${c.main.special ? 'ring-1 ring-inset ring-amber-400/50' : ''}`}
        style={{ background: `rgb(var(--c-mint-400) / ${(0.06 + c.shade * 0.24).toFixed(3)})` }}
        title={title}
      >
        {arrow && <span className={`absolute right-1 top-0.5 text-[8px] ${arrow === 'up' ? 'text-mint-300' : 'text-rose-300'}`}>{arrow === 'up' ? '▲' : '▼'}</span>}
        <span className={`num text-[11.5px] font-medium leading-tight ${c.main.special ? 'text-amber-300' : 'text-white'}`}>{cellNum(c.main.amount, ccy)}</span>
        {c.extras.map((e) => (
          <span key={e.date} className="num text-[9.5px] leading-tight text-amber-300">
            +{cellNum(e.amount, ccy)}
          </span>
        ))}
      </div>
    );
  }
  if (c.kind === 'missed') {
    return <div className="flex h-11 items-center justify-center rounded-lg border border-dashed border-rose-400/50 text-[10.5px] font-medium text-rose-300">빠짐</div>;
  }
  if (c.kind === 'none') return <div className="flex h-11 items-center justify-center rounded-lg bg-white/[0.025] text-[11px] text-zinc-600">—</div>;
  if (c.kind === 'future') return <div className="h-11 rounded-lg bg-white/[0.015]" />;
  return <div className="h-11" />;
}

function eventText(e: PayEvent, ccy: string) {
  switch (e.kind) {
    case 'up':
    case 'down':
      return `직전 회차 ${dps(e.prev!, ccy)} 대비 ${signedPct(e.change!)}${e.yoy != null ? ` · 1년 전 같은 회차 대비 ${signedPct(e.yoy)}` : ''}`;
    case 'special':
      return '평소보다 크게 나온 일회성 회차 (성장 계산에서 뺌)';
    case 'extra':
      return `${e.m}월 두 번째 회차${e.m === 12 ? ' (다음 해 1월분을 앞당겨 주는 경우가 많음)' : ''}`;
    case 'missed':
      return '다른 해에는 이 달에 받았는데 이번에는 없음';
  }
}

export default function PaymentHistory({ payments, ccy, metrics, source }: { payments: Pay[]; ccy: string; metrics: DivScoreMetrics; source: string }) {
  const tc = useThemeColors();
  const [allEvents, setAllEvents] = useState(false);
  const p = useMemo(() => analyzePayments(payments, metrics.payments_12m || 4), [payments, metrics.payments_12m]);

  if (payments.length === 0) return <p className="py-4 text-center text-xs text-zinc-500">배당 회차가 없습니다.</p>;

  const SPECIAL = tc.palette[2] ?? tc.accent;
  const chartData = p.items.map((it, i) => ({
    key: it.date,
    year: it.y,
    amount: it.amount,
    ma: p.ma[i],
    odd: it.special || it.extra,
  }));
  // 해가 바뀌는 첫 회차에만 연도 눈금
  const yearTicks = chartData.filter((d, i) => i === 0 || chartData[i - 1].year !== d.year).map((d) => d.key);
  const events = allEvents ? p.events : p.events.slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-mono">배당 회차 · 최근 3년</p>
        <span className="label-mono">{source === 'records' ? '내 배당 기록 (주당 환산)' : '시장 이력 · 배당락일 · 세전 주당'}</span>
      </div>

      {/* 요약 숫자 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="최근 12개월" value={dps(metrics.ttm, ccy)} sub={metrics.specials_12m > 0 ? `특별배당 ${metrics.specials_12m}회 제외` : `${metrics.payments_12m}회`} />
        <Stat
          label="1년 전보다"
          value={metrics.growth_1y != null ? signedPct(metrics.growth_1y) : '—'}
          tone={metrics.growth_1y == null ? 'text-zinc-500' : metrics.growth_1y >= 0 ? 'text-mint-300' : 'text-rose-300'}
          sub={metrics.cagr_3y != null ? `3년 연평균 ${signedPct(metrics.cagr_3y)}` : undefined}
        />
        <Stat label="회차 평균" value={p.avg12 > 0 ? dps(p.avg12, ccy) : '—'} sub="최근 12개월 정기 회차" />
        <Stat label="범위" value={`${dps(p.min, ccy)} ~ ${dps(p.max, ccy)}`} sub="3년 정기 회차" />
      </div>

      {/* 회차별 막대 + 1년 평균 추세 */}
      <div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke={tc.grid} strokeOpacity={0.5} />
              <XAxis dataKey="key" ticks={yearTicks} tickFormatter={(k: string) => k.slice(0, 4)} tick={{ fontSize: 10.5, fill: tc.axis }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fontSize: 10.5, fill: tc.axis }} width={44} axisLine={false} tickLine={false} tickFormatter={(v: number) => cellNum(v, ccy)} />
              <Tooltip
                contentStyle={tc.tooltip.contentStyle}
                labelStyle={tc.tooltip.labelStyle}
                itemStyle={tc.tooltip.itemStyle}
                cursor={{ fill: tc.grid, opacity: 0.35 }}
                labelFormatter={(k: string) => k}
                formatter={(v: number, name: string) => [dps(v, ccy), name === 'ma' ? '1년 평균' : '주당 배당']}
              />
              <Bar dataKey="amount" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {chartData.map((d) => (
                  <BarCell key={d.key} fill={d.odd ? SPECIAL : tc.accent} fillOpacity={d.odd ? 0.9 : 0.7} />
                ))}
              </Bar>
              <Line dataKey="ma" type="monotone" stroke={tc.muted} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: tc.accent, opacity: 0.7 }} />
            정기
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SPECIAL }} />
            특별 · 같은 달 추가
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: tc.muted }} />
            1년 평균 추세
          </span>
        </div>
      </div>

      {/* 연도 × 월 달력표 */}
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <div className="grid grid-cols-[3.25rem_repeat(12,minmax(0,1fr))_5.5rem] gap-1">
            <span />
            {MONTHS.map((m) => (
              <span key={m} className="label-mono pb-0.5 text-center">
                {m}월
              </span>
            ))}
            <span className="label-mono pb-0.5 text-right">합계</span>
            {p.rows.map((r) => (
              <div key={r.year} className="contents">
                <span className="flex flex-col justify-center text-[12.5px] font-semibold text-zinc-100">
                  {r.year}
                  {r.current && <span className="text-[9.5px] font-normal text-zinc-500">진행 중</span>}
                </span>
                {r.cells.map((c, i) => (
                  <CalendarCell key={i} c={c} ccy={ccy} />
                ))}
                <span className="flex flex-col items-end justify-center">
                  <span className="num text-[12.5px] font-semibold text-white">{dps(r.total, ccy)}</span>
                  <span className="num text-[10.5px] text-zinc-500">
                    {r.count}회
                    {r.yoy != null && <span className={r.yoy >= 0 ? 'text-mint-300' : 'text-rose-300'}> · {signedPct(r.yoy)}</span>}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          적게
          <i className="inline-block h-2 w-10 rounded" style={{ background: 'linear-gradient(90deg, rgb(var(--c-mint-400) / 0.06), rgb(var(--c-mint-400) / 0.3))' }} />
          많게
        </span>
        <span>
          <span className="text-mint-300">▲</span>
          <span className="text-rose-300">▼</span> 작년 같은 달보다 {SAME_MONTH_BAND}% 넘게
        </span>
        <span>
          <span className="text-amber-300">+0.000</span> 같은 달 추가 회차
        </span>
        <span>
          <span className="text-rose-300">빠짐</span> 다른 해엔 모두 받은 달
        </span>
        <span>— 그달 지급 없음 (해마다 같음)</span>
      </div>

      {/* 바뀐 점 */}
      <div>
        <p className="label-mono mb-1.5">바뀐 점 · 직전 회차·1년 전 같은 회차와 비교해 크게 바뀐 회차와 특이 회차 · 최근 것부터</p>
        {p.events.length === 0 ? (
          <p className="py-3 text-xs text-zinc-500">최근 3년 동안 크게 바뀐 회차가 없습니다.</p>
        ) : (
          <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
            {events.map((e) => (
              <div key={`${e.kind}-${e.key}`} className="flex items-center gap-3 px-3 py-2">
                <span className="num w-16 shrink-0 text-[12px] text-zinc-500">{e.date ? shortDate(e.date) : `${String(e.y).slice(2)}년 ${e.m}월`}</span>
                <span className={`badge shrink-0 !py-0 text-[11px] ${EVENT_META[e.kind].cls}`}>{EVENT_META[e.kind].label}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-400">{eventText(e, ccy)}</span>
                <span className="num shrink-0 text-[13px] font-medium text-white">{e.amount != null ? dps(e.amount, ccy) : '—'}</span>
              </div>
            ))}
          </div>
        )}
        {p.events.length > 6 && (
          <button type="button" onClick={() => setAllEvents((v) => !v)} className="mt-2 text-xs text-mint-300 hover:underline">
            {allEvents ? '최근 6개만 보기' : `${p.events.length - 6}개 더 보기`}
          </button>
        )}
      </div>
    </div>
  );
}
