import type { Account, AccumulationPlanRequest, AccumulationPlanView, PlanCurrency } from '../../types/models';

// 주식 모으기 화면의 문구·숫자 표기와 기본값

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export const currencyOfTicker = (ticker: string): PlanCurrency => (/\.(KS|KQ)$/i.test(ticker) ? 'KRW' : 'USD');
export const isKRTicker = (ticker: string) => /\.(KS|KQ)$/i.test(ticker);

/** 1,000원 / $1 / $1.25 */
export function fmtAmount(v: number, ccy: PlanCurrency): string {
  if (ccy === 'KRW') return `${Math.round(v).toLocaleString('ko-KR')}원`;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** 손익처럼 부호가 필요한 금액 */
export const fmtSignedAmount = (v: number, ccy: PlanCurrency) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${fmtAmount(Math.abs(v), ccy)}`;

/** 종목 통화 단가 */
export function fmtPrice(v: number, ccy: PlanCurrency): string {
  if (ccy === 'KRW') return `₩${Math.round(v).toLocaleString('ko-KR')}`;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 0.004주 · 0.087123주 (소수 여섯째 자리까지, 끝의 0은 지움) */
export const fmtQty = (q: number) => `${q.toLocaleString('ko-KR', { maximumFractionDigits: 6 })}주`;

export const fmtSignedPct = (v: number, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`;
export const signTone = (v: number) => (v > 0 ? 'text-mint-300' : v < 0 ? 'text-rose-300' : 'text-zinc-300');

type PlanRule = Pick<AccumulationPlanRequest, 'schedule' | 'weekdays' | 'month_day' | 'condition' | 'condition_value' | 'amount' | 'amount_currency'>;

export function scheduleText(p: Pick<PlanRule, 'schedule' | 'weekdays' | 'month_day'>): string {
  if (p.schedule === 'weekly') {
    const days = WEEKDAY_LABELS.map((d, i) => ((p.weekdays >> i) & 1 ? d : null)).filter(Boolean);
    return days.length === 1 ? `매주 ${days[0]}요일` : `매주 ${days.join('·')}`;
  }
  if (p.schedule === 'monthly') return `매월 ${p.month_day}일`;
  return '매일';
}

export function conditionText(p: Pick<PlanRule, 'condition' | 'condition_value'>, assetCcy: PlanCurrency): string {
  if (p.condition === 'return_below') return `수익률 ${p.condition_value > 0 ? '+' : ''}${p.condition_value}% 이하일 때`;
  if (p.condition === 'price_below') return `주가 ${fmtPrice(p.condition_value, assetCcy)} 이하일 때`;
  return '';
}

/** "매일 수익률 -1% 이하일 때 1,000원씩" / "매주 목요일 $1씩" */
export function ruleText(p: PlanRule, assetCcy: PlanCurrency): string {
  const cond = conditionText(p, assetCcy);
  return [scheduleText(p), cond, `${fmtAmount(p.amount, p.amount_currency)}씩`].filter(Boolean).join(' ');
}

export const QTY_STEPS: { value: number; label: string; hint: string }[] = [
  { value: 0.001, label: '0.001주 단위', hint: '카카오페이처럼 금액을 넘지 않게 0.001주 단위로 삽니다 (1,000원 → 917원·784원)' },
  { value: 0.0001, label: '0.0001주 단위', hint: '카카오페이 국내 주식처럼 금액을 넘지 않게 0.0001주 단위로 삽니다 (SK하이닉스 0.0007주·0.0006주)' },
  { value: 0.000001, label: '금액에 맞춰', hint: '0.000001주 단위로 금액에 거의 딱 맞게 삽니다 (1,000원 → 999원)' },
];

export const stepLabel = (step: number) => QTY_STEPS.find((s) => Math.abs(s.value - step) < 1e-12)?.label ?? `${step}주 단위`;

/**
 * 수량 단위 기본값. 카카오페이는 미국 주식 0.001주(엔비디아 0.004주·917원), 국내 주식 0.0001주(SK하이닉스 0.0007주) 단위로
 * 금액을 넘지 않게 산다. 그 밖의 증권사는 금액에 맞춰 사는 것으로 본다.
 */
export function defaultQtyStep(account?: Pick<Account, 'broker' | 'name'> | null, ticker = ''): number {
  const text = `${account?.broker ?? ''} ${account?.name ?? ''}`;
  if (!/카카오|kakao/i.test(text)) return 0.000001;
  return isKRTicker(ticker) ? 0.0001 : 0.001;
}

/** 한 회차 금액이 수량 단위 하나 값보다 작아 사지 못하는지 */
export const belowMinimum = (p: Pick<AccumulationPlanView, 'amount' | 'min_amount'>) => !!p.min_amount && p.amount < p.min_amount;

/** 금액을 넘지 않는 최대 수량 (서버와 같은 계산) */
export function floorQty(amountInAssetCcy: number, price: number, step: number): number {
  if (amountInAssetCcy <= 0 || price <= 0 || step <= 0) return 0;
  const n = Math.floor(amountInAssetCcy / price / step + 1e-9);
  return Math.round(n * step * 1e9) / 1e9;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 한국 시각 기준 날짜 YYYY-MM-DD */
export function kstDate(d = new Date(), addDays = 0): string {
  const t = new Date(d.getTime() + 9 * 3600_000 + addDays * 86400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 다음 평일 (YYYY-MM-DD 기준) */
function nextWeekday(day: string): string {
  const t = new Date(`${day}T00:00:00Z`);
  do t.setUTCDate(t.getUTCDate() + 1);
  while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * 자동 기록 시작일 기본값. 지금까지 모은 값에는 오늘 회차까지 들어 있다고 본다.
 * - 미국 종목: 오늘 날짜의 미국 장(한국 시각 오늘 밤)부터
 * - 한국 종목: 오늘 장은 이미 샀다고 보고 다음 거래일부터
 */
export function defaultAutoFrom(ticker: string, now = new Date()): string {
  const today = kstDate(now);
  return isKRTicker(ticker) ? nextWeekday(today) : today;
}

/** 11월 12일 (목) */
export function fmtDay(day: string): string {
  const t = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(t.getTime())) return day;
  return `${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일 (${WEEKDAY_LABELS[t.getUTCDay()]})`;
}

/** 다음 회차 안내: 미국 장은 한국 시각으로 그날 밤에 열린다 */
export function nextText(plan: Pick<AccumulationPlanView, 'next_date' | 'asset'>, now = new Date()): string {
  if (!plan.next_date) return '';
  const us = !isKRTicker(plan.asset?.ticker ?? '');
  const today = kstDate(now);
  const tomorrow = kstDate(now, 1);
  // 장은 끝났지만 아직 기록 전 (미국 장은 한국 시각 다음 날 아침 7시쯤 확정)
  if (plan.next_date < today) return `${plan.next_date.slice(5).replace('-', '/').replace(/^0/, '')} 장 · 기록 대기`;
  const when = plan.next_date === today ? '오늘' : plan.next_date === tomorrow ? '내일' : fmtDay(plan.next_date);
  return us ? `${when} 밤 미국 장` : `${when} 장 마감 후`;
}

/** 한 달 거래일 기준 예상 횟수 (요약용) */
export function monthlyTimes(p: Pick<AccumulationPlanRequest, 'schedule' | 'weekdays'>): number {
  if (p.schedule === 'daily') return 21;
  if (p.schedule === 'monthly') return 1;
  let n = 0;
  for (let d = 1; d <= 5; d++) if ((p.weekdays >> d) & 1) n++;
  return (n * 52) / 12;
}
