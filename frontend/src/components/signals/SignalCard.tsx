// 매매 신호 카드와 표시용 도우미. 매매 신호 페이지의 목록·상세 패널이 함께 쓴다.
import { Fragment, useState } from 'react';
import { Lock, ChevronDown, Settings2, ShieldCheck, MinusCircle, Scissors, ShoppingCart } from 'lucide-react';
import { SignalAction, SignalCheck, SignalItem, SignalMode, SignalRule, SignalTaxSummary } from '../../types/models';
import RingGauge from '../ui/RingGauge';
import Chip from '../ui/Chip';
import ProfileChip from './ProfileChip';
import { getAccountTypeMeta } from '../../utils/accountType';

export type FilterValue = 'all' | 'SELL' | 'BUY' | 'CONFLICT' | 'HOLD';

export const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'SELL', label: '매도' },
  { value: 'BUY', label: '매수' },
  { value: 'CONFLICT', label: '충돌' },
  { value: 'HOLD', label: '관망' },
];

export const ACTION_META: Record<SignalAction, { label: string; badge: string; ring: string; dot: string }> = {
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
  rsi_rebound: '→',
  mfi_rebound: '→',
  rsi_overbought: '≥',
  mfi_overbought: '≥',
  per_low: '≤',
  pbr_low: '≤',
  per_high: '≥',
  pbr_high: '≥',
  per_avg_low: '≤',
  pbr_avg_low: '≤',
  per_avg_high: '≥',
  pbr_avg_high: '≥',
};

// 단위가 "배"인 펀더멘털 체크
const MULTIPLE_CODES = new Set(['per_low', 'pbr_low', 'per_high', 'pbr_high']);

// 수익 실현 묶음에 속하는 매도 체크 (나머지 매도 체크는 위험 관리 묶음)
const SELL_PROFIT_CODES = new Set(['take_profit', 'trailing_stop', 'annualized_return', 'weight_drift', 'yield_compression', 'vol_overheat', 'rsi_overbought', 'mfi_overbought', 'per_high', 'pbr_high', 'per_avg_high', 'pbr_avg_high']);

export const fmtKrw = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`;
export const fmtSignedKrw = (v: number) => `${v < 0 ? '-' : '+'}₩${Math.abs(Math.round(v)).toLocaleString('ko-KR')}`;
export const fmtNum = (v: number, d = 1) => v.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const fmtPct = (v: number, d = 1) => `${fmtNum(v, d)}%`;
export const fmtSignedPct = (v: number, d = 1) => `${v > 0 ? '+' : ''}${fmtNum(v, d)}%`;
export const signTone = (v: number) => (v > 0 ? 'text-mint-300' : v < 0 ? 'text-rose-300' : 'text-zinc-300');

export function formatPrice(v: number, currency: string) {
  return currency === 'USD' ? `$${fmtNum(v, 2)}` : `₩${Math.round(v).toLocaleString('ko-KR')}`;
}

function checkText(c: SignalCheck, oscMins?: { rsi?: number; mfi?: number }) {
  const op = CHECK_OPS[c.code] ?? '→';
  // RSI/MFI 과매도 반등: 최근 최저값은 카드 지표 행에 있으므로 여기서는 현재값과 기준만 보여 준다
  if (c.code === 'rsi_rebound' || c.code === 'mfi_rebound') {
    const name = c.code === 'rsi_rebound' ? 'RSI' : 'MFI';
    const lo = c.code === 'rsi_rebound' ? oscMins?.rsi : oscMins?.mfi;
    return `${name} ${fmtNum(c.value, 0)} (${lo ? `최근 ${fmtNum(lo, 0)} → ` : ""}반등, 기준 ${fmtNum(c.threshold, 0)})`;
  }
  if (c.code.startsWith('rsi_') || c.code.startsWith('mfi_')) {
    return `${c.label} ${fmtNum(c.value, 1)} ${op} ${fmtNum(c.threshold, 0)}`;
  }
  // PER/PBR 평균 대비: 부호 있는 % (현재 값이 평균보다 몇 % 높은지/낮은지)
  if (c.code === 'per_avg_low' || c.code === 'pbr_avg_low' || c.code === 'per_avg_high' || c.code === 'pbr_avg_high') {
    return `${c.label} ${fmtSignedPct(c.value)} ${op} ${fmtSignedPct(c.threshold)}`;
  }
  if (MULTIPLE_CODES.has(c.code)) {
    return `${c.label} ${fmtNum(c.value, 2)}배 ${op} ${fmtNum(c.threshold, 2)}배`;
  }
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

export function Metric({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="surface-inset min-w-0 px-3 py-2.5">
      <div className="label-mono">{label}</div>
      <div className="num mt-1 truncate text-sm font-medium text-white">{children}</div>
      {sub && <div className="num mt-0.5 truncate text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

const TAX_RATE_NOTE = '일반(위탁) 계좌의 해외 상장 종목 기준 · 22% · 참고용';

export function TaxPanel({ tax, className = 'surface mb-6 p-4 sm:p-5' }: { tax: SignalTaxSummary; className?: string }) {
  const exemption = tax.exemption_krw || 2500000;
  const over = tax.net_krw > exemption;
  const pct = Math.max(0, Math.min(100, (Math.max(tax.net_krw, 0) / exemption) * 100));
  return (
    <section className={className} aria-label="해외주식 양도세">
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

export function RangeBar({ low, high, price, ma }: { low: number; high: number; price: number; ma?: number }) {
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

function CheckGroup({ title, checks, tone, mode, count, profitCount, riskCount, oscMins }: { oscMins?: { rsi?: number; mfi?: number }; title: string; checks: SignalCheck[]; tone: 'sell' | 'buy'; mode?: SignalMode; count?: number; profitCount?: number; riskCount?: number }) {
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
              {checkText(c, oscMins)}
            </Chip>
          ) : (
            <Chip key={c.code} className="!text-zinc-500">
              <span className="text-zinc-600">·</span>
              {checkText(c, oscMins)}
            </Chip>
          ),
        )}
      </div>
    </div>
  );
}

/** 종목 신호의 행동 이름 (연금·IRP 안에서만 파는 경우는 리밸런싱) */
export function actionLabelOf(item: SignalItem): string {
  return item.action === 'SELL' && item.restricted_only ? '리밸런싱 검토' : ACTION_META[item.action].label;
}

/**
 * variant
 * - card: 테두리 있는 카드 (이름·신호 배지 머리글 포함)
 * - detail: 상세 패널 안에 들어가는 본문만 (머리글은 패널이 그리고, 계좌별 보기는 펼친 상태로 시작)
 */
export function SignalCard({
  item,
  rule,
  onEdit,
  flash,
  variant = 'card',
}: {
  item: SignalItem;
  rule?: SignalRule;
  onEdit: () => void;
  flash?: boolean;
  variant?: 'card' | 'detail';
}) {
  const detail = variant === 'detail';
  const [open, setOpen] = useState(detail);
  const meta = ACTION_META[item.action];
  const actionLabel = actionLabelOf(item);
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
  // 지표: RSI/MFI/PER/PBR (값이 있는 항목만)
  const oscTone = (v: number, hot: number, cold: number) => (v >= hot ? 'text-rose-300' : v <= cold ? 'text-mint-300' : 'text-zinc-200');
  const indParts: React.ReactNode[] = [];
  if (!noPrice) {
    if (item.rsi) indParts.push(<>RSI <span className={oscTone(item.rsi, 70, 30)}>{fmtNum(item.rsi, 1)}</span>{item.rsi_min ? <span className="text-zinc-500"> (최근 최저 {fmtNum(item.rsi_min, 1)})</span> : null}</>);
    if (item.mfi) indParts.push(<>MFI <span className={oscTone(item.mfi, 80, 20)}>{fmtNum(item.mfi, 1)}</span>{item.mfi_min ? <span className="text-zinc-500"> (최근 최저 {fmtNum(item.mfi_min, 1)})</span> : null}</>);
    const winMonths = item.valuation_window_months ?? rule?.valuation_window_months ?? 36;
    // 평균 대비 %: 매도 기준 이상이면 rose, 매수 기준 이하이면 mint, 그 외 중립 (규칙을 모르면 ±20%)
    const vsTone = (v: number, buyPct?: number, sellPct?: number) => (v >= (sellPct ?? 20) ? 'text-rose-300' : v <= -(buyPct ?? 20) ? 'text-mint-300' : 'text-zinc-300');
    const avgText = (avg: number | undefined, vs: number | undefined, digits: number, buyPct?: number, sellPct?: number) =>
      avg && vs !== undefined ? (
        <>{winMonths}개월 평균 {fmtNum(avg, digits)}배, <span className={vsTone(vs, buyPct, sellPct)}>{fmtSignedPct(vs, 0)}</span></>
      ) : null;
    const perAvg = avgText(item.per_avg, item.per_vs_avg_pct, 1, rule?.per_avg_buy_pct, rule?.per_avg_sell_pct);
    const pbrAvg = avgText(item.pbr_avg, item.pbr_vs_avg_pct, 2, rule?.pbr_avg_buy_pct, rule?.pbr_avg_sell_pct);
    const perExtra = [item.forward_per ? <>예상 {fmtNum(item.forward_per, 1)}배</> : null, perAvg].filter(Boolean);
    if (item.per) indParts.push(<>PER <span className="text-zinc-200">{fmtNum(item.per, 1)}배</span>{perExtra.length > 0 && <span className="text-zinc-500"> ({perExtra.map((e, i) => <Fragment key={i}>{i > 0 && ' · '}{e}</Fragment>)})</span>}</>);
    if (item.pbr) indParts.push(<>PBR <span className="text-zinc-200">{fmtNum(item.pbr, 2)}배</span>{pbrAvg && <span className="text-zinc-500"> ({pbrAvg})</span>}</>);
  }
  const hasFundamentals = !!item.per || !!item.pbr;
  const fundSource = item.fundamentals_source === 'naver' ? '네이버' : item.fundamentals_source === 'yahoo' ? 'Yahoo' : '';
  const avgSourceHint = (item.per_avg || item.pbr_avg) && item.valuation_source ? (item.valuation_source === 'computed' ? '평균: 실적 기반 계산' : '평균: 저장값') : '';
  const fundHint = hasFundamentals ? [fundSource, item.fundamentals_as_of, avgSourceHint].filter(Boolean).join(' · ') : '';
  const hasYieldAvg =!noPrice && (item.dividend_yield_avg_pct ?? 0) > 0;
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
    <article
      id={'signal-card-' + item.asset_id}
      className={`flex flex-col ${detail ? '' : 'surface scroll-mt-48 p-5 sm:p-6'} ${flash ? 'focus-flash' : ''}`}
    >
      {!detail && (
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
      )}

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

      {/* 상세 패널은 머리글에 프로필 칩이 있으므로 여기서는 뺀다 */}
      {((item.profile_name && !detail) || item.sell_disabled || item.sell_excluded_small_qty || item.buy_excluded_reason) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {item.profile_name && !detail && <ProfileChip name={item.profile_name} kind={item.profile_kind} />}
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

      {indParts.length > 0 && (
        <div className="surface-inset mt-4 min-w-0 px-3 py-2.5">
          <div className="label-mono">지표</div>
          <div className="num mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-zinc-400">
            {indParts.map((part, i) => (
              <span key={i}>{part}</span>
            ))}
            {fundHint && <span className="text-[10px] text-zinc-500">{fundHint}</span>}
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
          <CheckGroup title="매수 조건" oscMins={{ rsi: item.rsi_min, mfi: item.mfi_min }} checks={item.buy_checks} tone="buy" mode={rule?.buy_mode} count={rule?.buy_min_count} />
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
