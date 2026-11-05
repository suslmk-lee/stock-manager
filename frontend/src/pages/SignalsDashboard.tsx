import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Radar, RefreshCw, SlidersHorizontal, Lock, ChevronDown, Settings2, Bell, Coins, ShieldCheck, MinusCircle, Scissors, ShoppingCart, LayoutGrid, Layers } from 'lucide-react';
import { useAlerts } from '../components/alerts/AlertsProvider';
import SignalHistory from '../components/alerts/SignalHistory';
import { apiClient } from '../api/client';
import { SignalAction, SignalCheck, SignalItem, SignalMode, SignalProfile, SignalReport, SignalRule, SignalRulesResponse, SignalTaxSummary } from '../types/models';
import IconTile from '../components/ui/IconTile';
import RingGauge from '../components/ui/RingGauge';
import Chip from '../components/ui/Chip';
import CountUp from '../components/CountUp';
import CardStack from '../components/ui/CardStack';
import SignalRuleEditor from '../components/signals/SignalRuleEditor';
import ProfileManager from '../components/signals/ProfileManager';
import ProfileChip from '../components/signals/ProfileChip';
import { getAccountTypeMeta } from '../utils/accountType';

type FilterValue = 'all' | 'SELL' | 'BUY' | 'CONFLICT' | 'HOLD';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'SELL', label: '매도' },
  { value: 'BUY', label: '매수' },
  { value: 'CONFLICT', label: '충돌' },
  { value: 'HOLD', label: '관망' },
];

const ACTION_META: Record<SignalAction, { label: string; badge: string; ring: string; dot: string }> = {
  SELL: { label: '매도 검토', badge: 'border border-rose-400/30 bg-rose-500/10 text-rose-200', ring: 'rgb(var(--c-rose-400))', dot: 'bg-rose-400' },
  BUY: { label: '매수 검토', badge: 'border border-mint-400/30 bg-mint-400/10 text-mint-300', ring: 'rgb(var(--c-mint-400))', dot: 'bg-mint-400' },
  CONFLICT: { label: '신호 충돌', badge: 'border border-amber-400/30 bg-amber-400/10 text-amber-200', ring: 'rgb(var(--c-amber-400))', dot: 'bg-amber-400' },
  HOLD: { label: '관망', badge: 'border border-white/10 bg-white/[0.05] text-zinc-300', ring: 'rgb(var(--c-zinc-400))', dot: 'bg-zinc-400' },
  NO_PRICE: { label: '시세 없음', badge: 'border border-white/10 bg-white/[0.04] text-zinc-500', ring: 'rgb(var(--c-zinc-500))', dot: 'bg-zinc-500' },
};

// 체크 항목별 비교 방향
const CHECK_OPS: Record<string, string> = {
  take_profit: '≥',
  stop_loss: '≤',
  crash: '≤',
  weight_over: '≥',
  weight_under: '≤',
  dividend_payback: '≥',
  low_yield: '≤',
  buy_dip: '≤',
  high_yield: '≥',
  above_ma: '≥',
  dividend_cut: '≤',
  from_high: '≤',
  below_ma: '≤',
  trailing_stop: '≤',
  annualized_return: '≥',
  weight_drift: '≥',
  yield_compression: '≤',
  vol_overheat: '≥',
  vol_oversold: '≤',
  vol_stop: '≤',
  last_buy_dip: '≤',
  yield_expansion: '≥',
  time_stop: '≤',
  short_drop: '≤',
};

// 수익 실현 묶음에 속하는 매도 체크 (나머지 매도 체크는 위험 관리 묶음)
const SELL_PROFIT_CODES = new Set(['take_profit', 'trailing_stop', 'annualized_return', 'weight_drift', 'yield_compression', 'vol_overheat']);

const fmtKrw = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`;
const fmtSignedKrw = (v: number) => `${v < 0 ? '-' : '+'}₩${Math.abs(Math.round(v)).toLocaleString('ko-KR')}`;
const fmtNum = (v: number, d = 1) => v.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtPct = (v: number, d = 1) => `${fmtNum(v, d)}%`;
const fmtSignedPct = (v: number, d = 1) => `${v > 0 ? '+' : ''}${fmtNum(v, d)}%`;
const signTone = (v: number) => (v > 0 ? 'text-mint-300' : v < 0 ? 'text-rose-300' : 'text-zinc-300');

function formatPrice(v: number, currency: string) {
  return currency === 'USD' ? `$${fmtNum(v, 2)}` : `₩${Math.round(v).toLocaleString('ko-KR')}`;
}

function checkText(c: SignalCheck) {
  const op = CHECK_OPS[c.code] ?? '→';
  const unit = c.unit || '%';
  // σ 단위는 소수 2자리까지 표시
  const d = unit === 'σ' ? 2 : 1;
  // 반등 방식은 현재값이 기준과 직접 비교되지 않으므로 현재값과 하락 깊이 기준을 따로 보여 준다
  if ((c.code === 'below_ma' || c.code === 'from_high') && /반등|회복/.test(c.label)) {
    const depth = c.threshold !== 0 ? ` (하락 기준 ${fmtNum(c.threshold, d)}${unit})` : '';
    return `${c.label} · 현재 ${fmtNum(c.value, d)}${unit}${depth}`;
  }
  return `${c.label} ${fmtNum(c.value, d)}${unit} ${op} ${fmtNum(c.threshold, d)}${unit}`;
}

// 분할 익절 비율 표기 (33 -> 1/3)
function fractionText(pct: number) {
  if (pct === 33 || pct === 33.3) return '1/3';
  if (pct === 50) return '1/2';
  if (pct === 25) return '1/4';
  return `${fmtNum(pct, 1)}%`;
}

function ringInfo(item: SignalItem): { value: number; text: string } | null {
  if (item.action === 'NO_PRICE') return null;
  // 규칙이 사용한 수익률 기준과 일치시킨다
  if (item.return_basis === 'fx' && item.total_return_pct_fx !== undefined) {
    const fxPct = item.total_return_pct_fx;
    if (item.action === 'BUY') {
      const dip = item.buy_checks.find((c) => c.code === 'buy_dip');
      if (!dip || !dip.threshold) return null;
      return { value: (item.from_avg_pct / dip.threshold) * 100, text: fmtSignedPct(fxPct) };
    }
    const tp = item.sell_checks.find((c) => c.code === 'take_profit');
    if (!tp || !tp.threshold) return null;
    return { value: (fxPct / tp.threshold) * 100, text: fmtSignedPct(fxPct) };
  }
  if (item.action === 'BUY') {
    const dip = item.buy_checks.find((c) => c.code === 'buy_dip');
    if (!dip || !dip.threshold) return null;
    return { value: (item.from_avg_pct / dip.threshold) * 100, text: fmtSignedPct(item.total_return_pct) };
  }
  const tp = item.sell_checks.find((c) => c.code === 'take_profit');
  if (!tp || !tp.threshold) return null;
  return { value: (item.total_return_pct / tp.threshold) * 100, text: fmtSignedPct(item.total_return_pct) };
}

function Metric({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="surface-inset min-w-0 px-3 py-2.5">
      <div className="label-mono">{label}</div>
      <div className="num mt-1 truncate text-sm font-medium text-white">{children}</div>
      {sub && <div className="num mt-0.5 truncate text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

const TAX_RATE_NOTE = '일반(위탁) 계좌의 해외 상장 종목 기준 · 22% · 참고용';

function TaxPanel({ tax }: { tax: SignalTaxSummary }) {
  const exemption = tax.exemption_krw || 2500000;
  const over = tax.net_krw > exemption;
  const pct = Math.max(0, Math.min(100, (Math.max(tax.net_krw, 0) / exemption) * 100));
  return (
    <section className="surface mb-6 p-4 sm:p-5" aria-label="해외주식 양도세">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-white">해외주식 양도세</h2>
          <span className="label-mono">{tax.year}년 · {tax.count}건</span>
        </div>
        {tax.harvest_window && (
          <span className="badge border border-amber-400/30 bg-amber-400/10 text-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            연말 절세 구간
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Metric label="실현 이익"><span className="text-mint-300">{fmtKrw(tax.realized_gain_krw)}</span></Metric>
        <Metric label="실현 손실"><span className="text-rose-300">{fmtSignedKrw(-Math.abs(tax.realized_loss_krw))}</span></Metric>
        <Metric label="순이익"><span className={`${signTone(tax.net_krw)}`}>{fmtSignedKrw(tax.net_krw)}</span></Metric>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="label-mono">기본공제 {fmtKrw(exemption)} 대비</span>
          <span className={`num text-xs ${over ? 'text-amber-300' : 'text-mint-300'}`}>{fmtNum(exemption > 0 ? (Math.max(tax.net_krw, 0) / exemption) * 100 : 0, 0)}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-label="양도소득 기본공제 사용률"
        >
          <div className={`h-full rounded-full transition-all ${over ? 'bg-amber-400' : 'bg-mint-400'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="num mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
          <span className="text-zinc-400">
            남은 공제 <span className="text-zinc-100">{fmtKrw(Math.max(tax.remaining_krw, 0))}</span>
          </span>
          <span className="text-zinc-400">
            예상 세액 <span className={tax.estimated_tax_krw > 0 ? 'text-rose-300' : 'text-zinc-100'}>{fmtKrw(tax.estimated_tax_krw)}</span>
          </span>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">{TAX_RATE_NOTE}</p>
    </section>
  );
}

function RangeBar({ low, high, price, ma }: { low: number; high: number; price: number; ma?: number }) {
  const span = high - low;
  const pos = (v: number) => (span > 0 ? Math.max(0, Math.min(100, ((v - low) / span) * 100)) : 50);
  return (
    <div className="relative h-5">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/[0.08]" />
      <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-sky-400/40" style={{ left: 0, width: `${pos(price)}%` }} />
      {ma !== undefined && ma > 0 && ma >= low && ma <= high && (
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-amber-300" style={{ left: `${pos(ma)}%` }} title="200일 이동평균" />
      )}
      <div
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-400"
        style={{ left: `${pos(price)}%` }}
        title="현재가"
      />
    </div>
  );
}

function ModeHint({ mode, count, total }: { mode?: SignalMode; count?: number; total: number }) {
  if (!mode) return null;
  const need = mode === 'all' ? total : mode === 'count' ? Math.min(Math.max(count ?? 1, 1), total) : 1;
  const text = need >= total && total > 1 ? '모두 충족' : need <= 1 ? '하나 이상' : `${need}개 이상`;
  return <span className="ml-1.5 text-zinc-600">({text})</span>;
}

// 묶음 방식 매도: 수익 실현 / 위험 관리 묶음별 필요 개수 (묶음에 켜진 조건이 없으면 생략)
function GroupModeHint({ checks, profitCount, riskCount }: { checks: SignalCheck[]; profitCount?: number; riskCount?: number }) {
  const profitTotal = checks.filter((c) => SELL_PROFIT_CODES.has(c.code)).length;
  const riskTotal = checks.length - profitTotal;
  const clamp = (n: number | undefined, total: number) => Math.min(Math.max(n ?? 1, 1), total);
  const parts: string[] = [];
  if (profitTotal > 0) parts.push(`수익 ${clamp(profitCount, profitTotal)}개`);
  if (riskTotal > 0) parts.push(`위험 ${clamp(riskCount, riskTotal)}개`);
  if (parts.length === 0) return null;
  return <span className="ml-1.5 text-zinc-600">({parts.join(' · ')} 이상)</span>;
}

function CheckGroup({ title, checks, tone, mode, count, profitCount, riskCount }: { title: string; checks: SignalCheck[]; tone: 'sell' | 'buy'; mode?: SignalMode; count?: number; profitCount?: number; riskCount?: number }) {
  if (checks.length === 0) return null;
  const metClass =
    tone === 'sell' ? '!border-rose-400/30 !bg-rose-500/10 !text-rose-200' : '!border-mint-400/30 !bg-mint-400/10 !text-mint-300';
  return (
    <div>
      <div className="label-mono mb-1.5">
        {title}
        {mode === 'group' ? <GroupModeHint checks={checks} profitCount={profitCount} riskCount={riskCount} /> : <ModeHint mode={mode} count={count} total={checks.length} />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {checks.map((c) =>
          c.met ? (
            <Chip key={c.code} check className={`${metClass} ${tone === 'sell' ? '[&_svg]:!text-rose-300' : ''}`}>
              {checkText(c)}
            </Chip>
          ) : (
            <Chip key={c.code} className="!text-zinc-500">
              <span className="text-zinc-600">·</span>
              {checkText(c)}
            </Chip>
          ),
        )}
      </div>
    </div>
  );
}

function SignalCard({ item, rule, onEdit, flash }: { item: SignalItem; rule?: SignalRule; onEdit: () => void; flash?: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = ACTION_META[item.action];
  const actionLabel = item.action === 'SELL' && item.restricted_only ? '리밸런싱 검토' : meta.label;
  const noPrice = item.action === 'NO_PRICE';
  const dividendKind = item.profile_kind === 'dividend';
  // 배당형 프로필은 목표 수익률 대신 배당 회수율을 링으로 보여 준다
  const ring = dividendKind && !noPrice ? { value: item.dividend_payback_pct, text: fmtPct(item.dividend_payback_pct, 0) } : ringInfo(item);
  const ringColor = dividendKind ? 'rgb(var(--c-sky-400))' : meta.ring;
  const fx = item.return_basis === 'fx' && item.total_return_pct_fx !== undefined;
  const coverage = item.fx_coverage_pct ?? 100;
  const showTrend = !noPrice && !!item.price_history_ok && !!item.high_52w && !!item.low_52w;
  const showDiv = !noPrice && !!item.dividend_trend_ok;
  const hint = !noPrice ? item.tax_hint : null;
  // 수익 흐름: 값이 있는 항목만 표시
  const flowParts: React.ReactNode[] = [];
  if (!noPrice) {
    if (item.holding_days) flowParts.push(<>보유 <span className="text-zinc-200">{item.holding_days.toLocaleString('ko-KR')}일</span></>);
    if (item.annualized_return_pct) flowParts.push(<>연환산 <span className={signTone(item.annualized_return_pct)}>{fmtSignedPct(item.annualized_return_pct)}</span></>);
    if (item.peak_price) {
      flowParts.push(
        <>
          고점 대비 <span className={signTone(item.from_peak_pct ?? 0)}>{fmtSignedPct(item.from_peak_pct ?? 0)}</span>
          {item.peak_date && <span className="text-zinc-500"> ({item.peak_date})</span>}
        </>,
      );
    }
    if (item.last_buy_date) flowParts.push(<>마지막 매수 <span className="text-zinc-200">{item.last_buy_date}</span>{item.from_last_buy_pct !== undefined && <> · <span className={signTone(item.from_last_buy_pct)}>{fmtSignedPct(item.from_last_buy_pct)}</span></>}</>);
    if (item.short_change_days && item.short_change_pct !== undefined) flowParts.push(<>{item.short_change_days}거래일 <span className={signTone(item.short_change_pct)}>{fmtSignedPct(item.short_change_pct)}</span></>);
    if (item.recent_low_price && item.from_recent_low_pct !== undefined) flowParts.push(<>저점 대비 <span className={signTone(item.from_recent_low_pct)}>{fmtSignedPct(item.from_recent_low_pct)}</span></>);
    if (item.volatility_pct) flowParts.push(<>변동성 연 <span className="text-zinc-200">{fmtPct(item.volatility_pct)}</span></>);
    if (item.ma200_sigma) flowParts.push(<>200일선 <span className={signTone(item.ma200_sigma)}>{item.ma200_sigma > 0 ? '+' : ''}{fmtNum(item.ma200_sigma, 2)}σ</span></>);
    if (item.cost_weight_pct) flowParts.push(<>원금 비중 <span className="text-zinc-200">{fmtPct(item.cost_weight_pct)}</span> → 현재 <span className="text-zinc-200">{fmtPct(item.weight_pct)}</span></>);
  }
  const hasYieldAvg = !noPrice && (item.dividend_yield_avg_pct ?? 0) > 0;
  const divMetrics = (
    <>
      <Metric label="누적 배당" sub={`회수율 ${fmtPct(item.dividend_payback_pct)}`}>
        {fmtKrw(item.dividends_krw)}
      </Metric>
      <Metric
        label="배당수익률"
        sub={
          hasYieldAvg
            ? `24개월 평균 ${fmtPct(item.dividend_yield_avg_pct!, 2)} · 평균 대비 ${fmtSignedPct(item.dividend_yield_vs_avg_pct ?? 0)}${item.dividend_yield_source === 'records' ? ' (내 배당 기록 기준)' : ''}`
            : '현재 / 원금 기준'
        }
      >
        {fmtPct(item.current_yield_pct, 2)} <span className="text-zinc-500">/ {fmtPct(item.yield_on_cost_pct, 2)}</span>
      </Metric>
    </>
  );

  return (
    <article id={'signal-card-' + item.asset_id} className={`surface flex scroll-mt-48 flex-col p-5 sm:p-6 ${flash ? 'focus-flash' : ''}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight text-white">{item.name}</h3>
          <p className="label-mono mt-0.5">{item.ticker}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {item.rule_source === 'asset' && <span className="badge border border-sky-400/25 bg-sky-400/10 text-sky-200">개별 전략</span>}
          <span className={`badge ${meta.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {actionLabel}
          </span>
        </div>
      </header>

      {item.action === 'SELL' && !!item.suggested_sell_qty && item.suggested_sell_qty > 0 && (
        <div className="mt-2.5">
          <span className="badge border border-rose-400/40 bg-rose-500/15 !text-[12px] font-semibold text-rose-100">
            <Scissors className="h-3.5 w-3.5" />
            {item.suggested_sell_kind === 'rebalance' ? '리밸런싱' : `${fractionText(rule?.partial_pct ?? 33)} 익절 검토`} · {fmtNum(item.suggested_sell_qty, 2)}주
            {!!item.suggested_sell_krw && ` · ${fmtKrw(item.suggested_sell_krw)}`}
          </span>
        </div>
      )}

      {item.action === 'BUY' && !!item.suggested_buy_qty && item.suggested_buy_qty > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="badge border border-mint-400/40 bg-mint-400/15 !text-[12px] font-semibold text-mint-300">
            <ShoppingCart className="h-3.5 w-3.5" />
            추가 매수 검토 · {fmtNum(item.suggested_buy_qty, 2)}주
            {!!item.suggested_buy_krw && ` · ${fmtKrw(item.suggested_buy_krw)}`}
          </span>
          {item.suggested_buy_kind && (
            <span className="text-[11px] text-zinc-500">
              {item.suggested_buy_kind === 'target_weight' ? '목표 비중까지' : item.suggested_buy_kind === 'lower_avg' ? `평단 −${fmtNum(rule?.buy_qty_lower_avg_pct ?? 5, 1)}%` : '정액'}
            </span>
          )}
        </div>
      )}

      {(item.profile_name || item.sell_disabled || item.sell_excluded_small_qty || item.buy_excluded_reason) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {item.profile_name && <ProfileChip name={item.profile_name} kind={item.profile_kind} />}
          {item.sell_disabled && (
            <span className="badge border border-sky-400/25 bg-sky-400/10 text-sky-200">
              <ShieldCheck className="h-3 w-3" />
              매도 신호 없음 · 장기보유
            </span>
          )}
          {item.sell_excluded_small_qty && (
            <span
              className="badge border border-white/10 bg-white/[0.04] text-zinc-300"
              title="전략의 '소량 보유 매도 제외' 설정에 따라 매도 조건을 충족해도 매도 검토에서 제외했습니다"
            >
              <MinusCircle className="h-3 w-3" />
              {fmtNum(item.min_sell_qty ?? 1, 2)}주 이하 · 매도 검토 제외
            </span>
          )}
          {item.buy_excluded_reason && (
            <span
              className="badge border border-white/10 bg-white/[0.04] text-zinc-300"
              title="전략의 '매수 제외' 설정에 따라 매수 조건을 충족해도 매수 검토에서 제외했습니다"
            >
              <MinusCircle className="h-3 w-3" />
              {item.buy_excluded_reason === 'cooldown'
                ? // days_since_last_buy 는 0(오늘)이면 응답에서 빠진다
                  `${item.days_since_last_buy ? `최근 ${item.days_since_last_buy}일 전 매수` : '오늘 매수'} · ${item.buy_cooldown_days ?? 14}일 쿨다운 · 매수 검토 제외`
                : item.buy_excluded_reason === 'no_rebound'
                ? `반등 미확인 · ${item.rebound_lookback_days ?? 20}일 저점 대비 ${fmtNum(item.from_recent_low_pct ?? 0, 1)}% · 매수 보류`
                : `비중 ${fmtNum(item.weight_pct, 1)}% ≥ ${fmtNum(item.buy_max_weight_pct ?? 0, 1)}% · 매수 검토 제외`}
            </span>
          )}
        </div>
      )}

      {item.restricted_only && (
        <div className="mt-2.5">
          <span className="badge border border-amber-400/25 bg-amber-400/10 text-amber-200">
            <Lock className="h-3 w-3" />
            연금·IRP 내 리밸런싱
          </span>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        {ring && (
          <div className="flex justify-center sm:block">
            <RingGauge value={ring.value} size={96} stroke={4} color={ringColor} label={dividendKind ? '배당 회수' : '목표 대비'}>
              <span className="text-[15px]">{ring.text}</span>
            </RingGauge>
          </div>
        )}
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          {noPrice ? (
            <div className="surface-inset col-span-2 px-3 py-4 text-center text-sm text-zinc-500">
              현재 시세를 불러오지 못해 신호를 계산하지 못했습니다.
            </div>
          ) : (
            <>
              {dividendKind && divMetrics}
              <Metric label="평가금액">{fmtKrw(item.market_value_krw)}</Metric>
              {fx ? (
                <div className="surface-inset min-w-0 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="label-mono">실질 수익률</span>
                    {coverage < 100 && (
                      <span className="num rounded-full border border-amber-400/25 bg-amber-400/10 px-1.5 text-[10px] leading-4 text-amber-200" title="거래 기록이 없는 수량은 현재 환율로 계산합니다">
                        환율 반영 {fmtNum(coverage, 0)}%
                      </span>
                    )}
                  </div>
                  <div className="num mt-1 truncate text-sm font-medium">
                    <span className={signTone(item.total_return_pct_fx ?? 0)}>{fmtSignedPct(item.total_return_pct_fx ?? 0)}</span>
                  </div>
                  <div className="num mt-0.5 truncate text-[11px]">
                    <span className={signTone(item.total_return_krw)}>{fmtSignedKrw(item.total_return_krw)}</span>
                  </div>
                  <div className="num truncate text-[11px] text-zinc-500">
                    환율 효과 <span className={signTone(item.fx_effect_krw ?? 0)}>{fmtSignedKrw(item.fx_effect_krw ?? 0)}</span>
                  </div>
                  <div className="num truncate text-[11px] text-zinc-500">현재환율 기준 {fmtSignedPct(item.total_return_pct)}</div>
                </div>
              ) : (
                <Metric
                  label="실질 수익률"
                  sub={<span className={signTone(item.total_return_krw)}>{fmtSignedKrw(item.total_return_krw)}</span>}
                >
                  <span className={signTone(item.total_return_pct)}>{fmtSignedPct(item.total_return_pct)}</span>
                </Metric>
              )}
              {!dividendKind && divMetrics}
              <Metric label="비중">{fmtPct(item.weight_pct)}</Metric>
              <Metric label="평단 대비" sub={`${formatPrice(item.avg_price, item.currency)} → ${formatPrice(item.current_price, item.currency)}`}>
                <span className={signTone(item.from_avg_pct)}>{fmtSignedPct(item.from_avg_pct)}</span>
              </Metric>
            </>
          )}
        </div>
      </div>

      {flowParts.length > 0 && (
        <div className="surface-inset mt-4 min-w-0 px-3 py-2.5">
          <div className="label-mono">수익 흐름</div>
          <div className="num mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-zinc-400">
            {flowParts.map((part, i) => (
              <span key={i}>{part}</span>
            ))}
          </div>
        </div>
      )}

      {(showTrend || showDiv) && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {showTrend && (
            <div className="surface-inset min-w-0 px-3 py-2.5 sm:col-span-2">
              <div className="label-mono">추세</div>
              <div className="num mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-zinc-400">
                <span>
                  52주 고점 대비 <span className={signTone(item.from_high_pct ?? 0)}>{fmtSignedPct(item.from_high_pct ?? 0)}</span>
                </span>
                {!!item.ma200 && (
                  <span>
                    200일선 대비 <span className={signTone(item.vs_ma200_pct ?? 0)}>{fmtSignedPct(item.vs_ma200_pct ?? 0)}</span>
                    {item.ma200_min_dev_pct !== undefined && <> (최저 {fmtSignedPct(item.ma200_min_dev_pct)})</>}
                  </span>
                )}
                {item.ma20_rising !== undefined && <span>20일선 {item.ma20_rising ? '상승' : '하락'}</span>}
                {(item.ma200_reclaim_days_ago ?? 0) > 0 && <span>200일선 회복 {item.ma200_reclaim_days_ago}일 전</span>}
                {item.from_high_deepest_pct !== undefined && (
                  <span>
                    고점 대비 최저 {fmtSignedPct(item.from_high_deepest_pct)}
                    {item.from_low_rebound_pct !== undefined && <> · 저점 대비 {fmtSignedPct(item.from_low_rebound_pct)}</>}
                  </span>
                )}
              </div>
              <div className="mt-1.5">
                <RangeBar low={item.low_52w!} high={item.high_52w!} price={item.current_price} ma={item.ma200} />
                <div className="num flex items-center justify-between text-[10px] text-zinc-500">
                  <span>저 {formatPrice(item.low_52w!, item.currency)}</span>
                  <span className="text-zinc-300">{formatPrice(item.current_price, item.currency)}</span>
                  <span>고 {formatPrice(item.high_52w!, item.currency)}</span>
                </div>
              </div>
            </div>
          )}
          {showDiv && (
            <div className="surface-inset min-w-0 px-3 py-2.5 sm:col-span-2">
              <div className="label-mono">배당 추세</div>
              <div className="num mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-400">
                <span>
                  DPS 12개월 <span className="text-zinc-100">{formatPrice(item.dps_12m ?? 0, item.currency)}</span>
                </span>
                <span className="text-zinc-600">vs</span>
                <span>
                  직전 12개월 <span className="text-zinc-100">{formatPrice(item.dps_prev_12m ?? 0, item.currency)}</span>
                </span>
                <span className={`font-medium ${signTone(item.dividend_change_pct ?? 0)}`}>{fmtSignedPct(item.dividend_change_pct ?? 0)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {hint && (
        <div
          className={`mt-4 rounded-2xl border px-3.5 py-2.5 ${
            hint.kind === 'harvest_gain' ? 'border-mint-400/30 bg-mint-400/10' : 'border-amber-400/30 bg-amber-400/10'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
            <span className={`text-xs font-medium ${hint.kind === 'harvest_gain' ? 'text-mint-300' : 'text-amber-200'}`}>
              {hint.kind === 'harvest_gain' ? '절세 이익 실현' : '손실 상계'}
            </span>
            <span className={`num text-xs ${hint.kind === 'harvest_gain' ? 'text-mint-300' : 'text-amber-200'}`}>{fmtKrw(hint.amount_krw)}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-300">{hint.message}</p>
        </div>
      )}

      {(item.sell_checks.length > 0 || item.buy_checks.length > 0) && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <CheckGroup title="매도 조건" checks={item.sell_checks} tone="sell" mode={rule?.sell_mode} count={rule?.sell_min_count} profitCount={rule?.sell_profit_min_count} riskCount={rule?.sell_risk_min_count} />
          <CheckGroup title="매수 조건" checks={item.buy_checks} tone="buy" mode={rule?.buy_mode} count={rule?.buy_min_count} />
        </div>
      )}

      <footer className="mt-4 border-t border-white/[0.06] pt-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            계좌별 보기 <span className="num text-zinc-600">{item.accounts.length}</span>
          </button>
          <button type="button" onClick={onEdit} className="btn-ghost !px-3 !py-1.5 !text-xs">
            <Settings2 className="h-3.5 w-3.5" />
            전략 설정
          </button>
        </div>
        {open && (
          <ul className="mt-3 space-y-2">
            {item.accounts.map((a) => {
              const t = getAccountTypeMeta({ account_type: a.account_type });
              return (
                <li key={a.account_id} className="surface-inset flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-zinc-100">{a.account_name}</span>
                    <span className="label-mono">{a.broker}</span>
                    <span className={`badge ${t.badgeClass}`}>{t.short}</span>
                  </div>
                  <div className="num flex items-center gap-3 text-xs text-zinc-400">
                    <span>{fmtNum(a.quantity, 4)}주</span>
                    <span>평단 {formatPrice(a.avg_price, item.currency)}</span>
                    <span className="text-zinc-200">{fmtKrw(a.market_value_krw)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </footer>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="surface h-24" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="surface h-72" />
        ))}
      </div>
    </div>
  );
}

type EditorState = { item: SignalItem } | null;

// 이미 처리한 포커스 요청 (탭 전환으로 다시 마운트돼도 재실행하지 않도록)
let handledFocusNonce = 0;

interface SignalsDashboardProps {
  focusAssetId?: number;
  focusNonce?: number;
}

type SignalView = 'stack' | 'grid';
const VIEW_KEY = 'sm-signal-view';
const VIEWS = [
  { value: 'stack', label: '스택', icon: Layers },
  { value: 'grid', label: '그리드', icon: LayoutGrid },
] as const;
const loadView = (): SignalView => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'stack';
  } catch {
    return 'stack';
  }
};

export default function SignalsDashboard({ focusAssetId, focusNonce }: SignalsDashboardProps = {}) {
  const { openSettings, openCandidates, profilesVersion } = useAlerts();
  const [flashId, setFlashId] = useState<number | null>(null);
  const [report, setReport] = useState<SignalReport | null>(null);
  const [rules, setRules] = useState<SignalRulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const [profiles, setProfiles] = useState<SignalProfile[] | null>(null);
  const [profileFilter, setProfileFilter] = useState<number | 'all'>('all');
  const [managerOpen, setManagerOpen] = useState(false);
  const [view, setView] = useState<SignalView>(loadView);
  const changeView = (v: SignalView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // 저장하지 못해도 이번 화면에는 적용된다
    }
  };

  const load = useCallback(async (initial = false) => {
    try {
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      const [r, ru, pr] = await Promise.all([
        apiClient.GetSignals(),
        apiClient.GetSignalRules().catch(() => null),
        apiClient.GetSignalProfiles().catch(() => null),
      ]);
      setReport(r);
      setRules(ru);
      setProfiles(pr ? [...(pr.profiles ?? [])].sort((a, b) => Number(b.built_in) - Number(a.built_in) || a.sort_order - b.sort_order || a.id - b.id) : null);
      setProfileFilter((cur) => (cur !== 'all' && pr && !(pr.profiles ?? []).some((p) => p.id === cur) ? 'all' : cur));
    } catch (err) {
      console.error('Failed to load signals:', err);
      // Wails 는 Go 오류를 문자열로 reject 한다
      const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      setError(detail ? `매매 신호를 불러오지 못했습니다: ${detail}` : '매매 신호를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  // 알림 등 다른 곳에서 프로필 지정이 바뀌면 다시 불러온다
  const seenVersionRef = useRef(profilesVersion);
  useEffect(() => {
    if (seenVersionRef.current === profilesVersion) return;
    seenVersionRef.current = profilesVersion;
    load(false);
  }, [profilesVersion, load]);

  // 알림에서 넘어온 종목 카드로 스크롤하고 잠깐 강조
  useEffect(() => {
    if (!report || !focusAssetId || !focusNonce || focusNonce === handledFocusNonce) return;
    const target = report.items.find((i) => i.asset_id === focusAssetId);
    if (!target) return;
    if ((filter !== 'all' && target.action !== filter) || (profileFilter !== 'all' && target.profile_id !== profileFilter)) {
      setFilter('all'); // 필터를 풀고 난 뒤 다시 실행된다
      setProfileFilter('all');
      return;
    }
    const t1 = window.setTimeout(() => {
      handledFocusNonce = focusNonce;
      document.getElementById('signal-card-' + focusAssetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setFlashId(focusAssetId);
    }, 150);
    const t2 = window.setTimeout(() => setFlashId(null), 2800);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [report, focusAssetId, focusNonce, filter, profileFilter]);

  const ruleFor = (item: SignalItem): SignalRule | undefined =>
    rules?.overrides?.find((o) => o.asset_id === item.asset_id) ?? profiles?.find((p) => p.id === item.profile_id)?.rule ?? rules?.default;

  const items = report?.items ?? [];
  const visible = useMemo(
    () => items.filter((i) => (filter === 'all' || i.action === filter) && (profileFilter === 'all' || i.profile_id === profileFilter)),
    [items, filter, profileFilter],
  );
  const summary = report?.summary;

  const stats: { label: string; value: number; tone: string }[] = [
    { label: '매도 신호', value: summary?.sell ?? 0, tone: 'text-rose-300' },
    { label: '매수 신호', value: summary?.buy ?? 0, tone: 'text-mint-300' },
    { label: '충돌', value: summary?.conflict ?? 0, tone: 'text-amber-300' },
    { label: '관망', value: summary?.hold ?? 0, tone: 'text-zinc-300' },
  ];

  const filterTone: Record<FilterValue, string> = {
    all: '',
    SELL: '!text-rose-300',
    BUY: '!text-mint-300',
    CONFLICT: '!text-amber-300',
    HOLD: '',
  };

  const handleSaved = () => {
    setEditor(null);
    load(false);
  };

  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <IconTile icon={Radar} tone="mint" />
          <div>
            <h1 className="text-2xl font-light tracking-tight text-white sm:text-3xl">매매 신호</h1>
            <p className="label-mono mt-0.5">규칙 기반 · 매도 / 매수 검토 알림</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost" onClick={openSettings}>
            <Bell className="h-4 w-4" />
            알림 설정
          </button>
          <button type="button" className="btn-ghost" onClick={() => openCandidates()}>
            <Coins className="h-4 w-4 text-sky-300" />
            배당 종목 정리
          </button>
          <button type="button" className="btn-ghost" disabled={!profiles} onClick={() => setManagerOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            전략 프로필
          </button>
          <button type="button" className="btn-icon !h-9 !w-9" onClick={() => load(false)} disabled={refreshing} aria-label="새로고침" title="새로고침">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <p className="mb-6 text-xs leading-relaxed text-zinc-500">
        설정한 규칙에 따른 알림이며 투자 권유가 아닙니다.{' '}
        {report?.items.some((i) => i.return_basis === 'fx')
          ? '수익률은 배당·실현손익 포함, 매수 시점 환율 원화 기준(거래 기록이 없는 수량은 현재 환율).'
          : '수익률은 배당·실현손익 포함, 현재 환율 원화 기준.'}
      </p>

      {error && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-rose-200">
          <span className="text-sm">{error}</span>
          <button type="button" className="btn-ghost !py-1 !text-xs" onClick={() => load(true)}>다시 시도</button>
        </div>
      )}

      {loading ? (
        <Skeleton />
      ) : report ? (
        <>
          <div className="surface mb-6 flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-stretch gap-4 sm:gap-6">
              {stats.map((s, i) => (
                <div key={s.label} className="flex items-stretch gap-4 sm:gap-6">
                  {i > 0 && <span className="divider-v" />}
                  <div className="min-w-0">
                    <div className="label-mono whitespace-nowrap">{s.label}</div>
                    <CountUp value={s.value} format={(v) => String(Math.round(v))} className={`num mt-1 block text-3xl font-light ${s.tone}`} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              {profiles && profiles.length > 0 && (
                <select
                  aria-label="전략 프로필 필터"
                  className="input-field !w-auto !py-1.5 !text-xs sm:max-w-[200px]"
                  value={profileFilter}
                  onChange={(e) => setProfileFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                >
                  <option value="all">프로필: 전체</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="glass-pill flex self-start overflow-x-auto p-1 lg:self-auto" role="group" aria-label="신호 필터">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFilter(f.value)}
                    className={`pill-item ${filter === f.value ? `pill-item-active ${filterTone[f.value]}` : ''}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="glass-pill flex self-start p-1 lg:self-auto" role="group" aria-label="카드 보기 방식">
                {VIEWS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => changeView(v.value)}
                    className={`pill-item inline-flex items-center gap-1.5 ${view === v.value ? 'pill-item-active' : ''}`}
                    aria-pressed={view === v.value}
                    title={`${v.label} 보기`}
                  >
                    <v.icon className="h-3.5 w-3.5" />
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {report.tax && <TaxPanel tax={report.tax} />}

          {items.length === 0 ? (
            <div className="surface py-16 text-center">
              <p className="text-sm text-zinc-400">보유 중인 종목이 없어 계산할 신호가 없습니다.</p>
              <p className="label-mono mt-1">주식/ETF 탭에서 종목과 매수 내역을 등록해 보세요</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="surface py-16 text-center text-sm text-zinc-400">해당하는 신호가 없습니다.</div>
          ) : (
            (() => {
              const cards = visible.map((item) => (
                <SignalCard key={item.asset_id} item={item} rule={ruleFor(item)} onEdit={() => profiles && setEditor({ item })} flash={flashId === item.asset_id} />
              ));
              return view === 'stack' ? <CardStack>{cards}</CardStack> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{cards}</div>;
            })()
          )}

          {summary && summary.no_price > 0 && (
            <p className="label-mono mt-4">시세를 가져오지 못한 종목 {summary.no_price}개는 전체 보기에서만 표시됩니다.</p>
          )}
        </>
      ) : null}

      <SignalHistory />

      {editor && profiles && (
        <SignalRuleEditor
          assetId={editor.item.asset_id}
          assetName={`${editor.item.name} (${editor.item.ticker})`}
          profiles={profiles}
          currentProfileId={editor.item.profile_id}
          assetRule={rules?.overrides?.find((o) => o.asset_id === editor.item.asset_id) ?? null}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}

      {managerOpen && (
        <ProfileManager
          items={items}
          onClose={(changed) => {
            setManagerOpen(false);
            if (changed) load(false);
          }}
        />
      )}
    </div>
  );
}
