import type { AccumulationPlanView, CashBalance, PlanCurrency } from '../../types/models';
import { fmtAmount } from './planText';

/** 거래일 기준 한 달 (monthly_max 와 같은 기준) */
const TRADING_DAYS = 21;
/** 이보다 적게 남으면 경고 */
export const LOW_DAYS = 5;

export interface AccountCashNeed {
  accountId: number;
  name: string;
  /** 한 달 최대 필요 금액 (예수금에서 빠지는 통화 기준) */
  needKRW: number;
  needUSD: number;
  cashKRW: number;
  cashUSD: number;
  /** 잔액 맞추기를 한 계좌만 예수금을 믿을 수 있다 */
  reconciled: boolean;
  /** 자동 환전 계좌: 달러가 모자라면 원화로 사므로 원화·달러를 합쳐 본다 */
  autoFx: boolean;
  /** 지금 예수금으로 버티는 거래일 수 (잔액을 맞추지 않았으면 null) */
  days: number | null;
}

/** 모으기 금액이 빠지는 통화: 국내 주식은 원화, 미국 주식은 계좌 결제 통화 (원화 결제면 원화) */
export const deductCurrency = (p: AccumulationPlanView): PlanCurrency =>
  p.asset_currency === 'KRW' || p.account?.foreign_settle === 'KRW' ? 'KRW' : 'USD';

/** 진행 중인 모으기를 계좌별로 묶어 한 달 필요 금액과 예수금으로 버티는 거래일 수를 계산한다 */
export function cashNeeds(plans: AccumulationPlanView[], balances: CashBalance[] | null, usdKrw: number): Map<number, AccountCashNeed> {
  const byAcc = new Map<number, AccountCashNeed>();
  const bal = new Map((balances ?? []).map((b) => [b.account_id, b]));
  for (const p of plans) {
    if (p.status !== 'active') continue;
    let r = byAcc.get(p.account_id);
    if (!r) {
      const b = bal.get(p.account_id);
      r = {
        accountId: p.account_id,
        name: p.account?.name ?? `계좌 ${p.account_id}`,
        needKRW: 0,
        needUSD: 0,
        cashKRW: b?.krw ?? 0,
        cashUSD: b?.usd ?? 0,
        reconciled: !!b?.last_adjusted,
        autoFx: p.account?.foreign_settle === 'AFX',
        days: null,
      };
      byAcc.set(p.account_id, r);
    }
    // 환율을 모르면 금액 통화 그대로 둔다
    const to = usdKrw > 0 ? deductCurrency(p) : p.amount_currency;
    let need = p.monthly_max;
    if (p.amount_currency !== to) need = to === 'KRW' ? need * usdKrw : need / usdKrw;
    if (to === 'KRW') r.needKRW += need;
    else r.needUSD += need;
  }
  for (const r of byAcc.values()) {
    if (!r.reconciled || !balances) continue;
    const ds: number[] = [];
    if (r.autoFx && usdKrw > 0) {
      // 달러 먼저, 모자라면 원화에서 바꾸므로 둘을 원화로 합쳐서 본다
      const need = r.needKRW + r.needUSD * usdKrw;
      if (need > 0) ds.push(Math.max(0, r.cashKRW + r.cashUSD * usdKrw) / (need / TRADING_DAYS));
    } else {
      if (r.needKRW > 0) ds.push(Math.max(0, r.cashKRW) / (r.needKRW / TRADING_DAYS));
      if (r.needUSD > 0) ds.push(Math.max(0, r.cashUSD) / (r.needUSD / TRADING_DAYS));
    }
    if (ds.length > 0) r.days = Math.floor(Math.min(...ds));
  }
  return byAcc;
}

export const daysTone = (days: number | null) => (days == null ? 'text-zinc-500' : days <= 0 ? 'text-rose-300' : days < LOW_DAYS ? 'text-amber-300' : 'text-zinc-400');

export const daysText = (days: number | null) => (days == null ? '' : days <= 0 ? '예수금 부족' : days >= 99 ? '99거래일분 이상' : `약 ${days}거래일분`);

/** 예수금 금액 (마이너스는 −1,000원 꼴) */
export const cashAmount = (v: number, ccy: PlanCurrency) => (v < 0 ? `−${fmtAmount(-v, ccy)}` : fmtAmount(v, ccy));

/** 계좌의 예수금 표시 (모으기에 쓰는 통화만, 자동 환전 계좌는 원화·달러 둘 다) */
export const cashText = (r: AccountCashNeed) =>
  [(r.needKRW > 0 || r.autoFx) && cashAmount(r.cashKRW, 'KRW'), (r.needUSD > 0 || (r.autoFx && r.cashUSD !== 0)) && cashAmount(r.cashUSD, 'USD')].filter(Boolean).join(' + ');
