import { useMemo } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import type { Account, Asset, CashBalance, HoldingWithDetails } from '../../types/models';
import BrokerLogo from '../ui/BrokerLogo';
import { accountDisplayName } from '../../utils/accountLabel';
import { getAccountType, isRestrictedAccount } from '../../utils/accountType';
import { money } from '../cash/CashPanel';

/**
 * 이 종목을 살 수 있는 예수금 — 계좌마다 지금 쓸 수 있는 금액(종목 통화)과 현재가로 살 수 있는 수량.
 * 국내 종목은 원화예수금, 미국 종목은 계좌의 예수금 구성을 따른다:
 *   원화·외화 따로(USD) = 달러만 (원화는 환전하면 쓸 수 있음으로 따로 보여 줌)
 *   자동 환전(AFX) = 달러 + 원화(수수료 얹은 환율로 바꿔 계산)
 *   원화 하나(KRW) = 원화를 수수료 얹은 환율로 바꿔 계산
 * 매수에는 결제 전 매도 대금도 쓸 수 있으므로 '출금 가능'이 아니라 예수금 잔액을 쓴다.
 */

export interface CashContext {
  accounts: Account[];
  balances: CashBalance[];
  usdKrw: number;
  holdings: HoldingWithDetails[];
}

interface Row {
  account: Account;
  /** 지금 바로 쓸 수 있는 금액 (종목 통화) */
  now: number;
  /** 어떻게 모은 금액인지 */
  parts: string;
  /** 원화·외화 따로 계좌의 원화 — 환전하면 쓸 수 있는 금액 (달러) */
  exchangeable: number;
  held: number;
  reconciled: boolean;
  /** 소수점 매수가 되는 계좌 (소수 수량을 들고 있음) */
  frac: boolean;
  /** 현재가로 살 수 있는 수량 (바로 / 환전까지 하면) */
  shares: number | null;
  sharesX: number | null;
}

const isKR = (ticker: string) => /\.(KS|KQ)$/i.test(ticker);
const PENSION = new Set(['Pension', 'IRP', 'DC']);
const shareText = (n: number | null, frac: boolean) =>
  n == null ? '' : n >= 1 || (frac && n > 0) ? `약 ${n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}주` : '1주 미만';

/** 이 계좌에서 이 종목을 살 수 없는 이유 (살 수 있으면 null) */
function blockReason(account: Account, asset: Asset, krAccounts: Set<number>, held: boolean): string | null {
  if (held) return null;
  const type = getAccountType(account);
  // 미국 종목: 국내 계좌(종합계좌)도 해외 주식을 거래하므로 계좌 종류만 본다
  if (!isKR(asset.ticker)) return type === 'General' ? null : '해외 상장 종목을 살 수 없는 ISA·연금 계좌';
  if (PENSION.has(type) && asset.type !== 'ETF') return '개별 주식을 살 수 없는 연금 계좌';
  // 해외 주식 계좌는 국내 종목을 들고 있을 때만 국내 주식도 거래하는 계좌로 본다 (미니스탁처럼 해외 전용 앱 제외)
  if (account.market_type === 'International' && !krAccounts.has(account.id)) return '국내 주식을 거래한 적 없는 해외 주식 계좌';
  return null;
}

export default function InvestCash({ asset, ccy, price, ctx }: { asset: Asset; ccy: string; price: number | null; ctx: CashContext | null | 'error' }) {
  const data = useMemo(() => {
    if (!ctx || ctx === 'error') return null;
    const fx = ctx.usdKrw;
    const usd = ccy === 'USD';
    const bal = new Map(ctx.balances.map((b) => [b.account_id, b]));
    const heldBy = new Map<number, number>();
    const krAccounts = new Set<number>();
    const fracAccounts = new Set<number>();
    for (const h of ctx.holdings) {
      if (h.quantity <= 0) continue;
      if (Math.abs(h.quantity - Math.round(h.quantity)) > 1e-6) fracAccounts.add(h.account_id);
      if (h.asset_id === asset.id) heldBy.set(h.account_id, (heldBy.get(h.account_id) ?? 0) + h.quantity);
      if (isKR(h.ticker || h.asset?.ticker || '')) krAccounts.add(h.account_id);
    }

    const rows: Row[] = [];
    // 살 수 없는 계좌에 있는 예수금 (이유별, 원화 환산)
    const blocked = new Map<string, number>();
    let recorded = 0;
    let converted = false;
    for (const account of ctx.accounts) {
      const b = bal.get(account.id);
      const held = heldBy.get(account.id) ?? 0;
      const krw = Math.max(0, b?.krw ?? 0);
      const cashUSD = Math.max(0, b?.usd ?? 0);
      if (b && (b.flow_count > 0 || b.last_adjusted)) recorded++;
      const why = blockReason(account, asset, krAccounts, held > 0);
      if (why) {
        const relevant = usd ? krw + cashUSD * fx : krw;
        if (relevant >= 1) blocked.set(why, (blocked.get(why) ?? 0) + relevant);
        continue;
      }
      let now = 0;
      let parts = '';
      let exchangeable = 0;
      if (!usd) {
        now = krw;
        parts = '원화예수금';
      } else {
        const settle = account.foreign_settle ?? 'USD';
        const fee = account.fx_fee_pct ?? 0;
        const fxPay = fx > 0 ? fx * (1 + fee / 100) : 0;
        const feeText = fee > 0 ? ` · 수수료 ${fee}%` : '';
        if (settle === 'KRW') {
          now = fxPay > 0 ? krw / fxPay : 0;
          converted ||= krw > 0;
          parts = krw > 0 ? `원화 ${money(krw, 'KRW')} · 원화로 바로 결제${feeText}` : '원화예수금 없음';
        } else if (settle === 'AFX') {
          now = cashUSD + (fxPay > 0 ? krw / fxPay : 0);
          converted ||= krw > 0;
          parts = [cashUSD > 0 && `달러 ${money(cashUSD, 'USD')}`, krw > 0 && `원화 ${money(krw, 'KRW')} 자동 환전${feeText}`].filter(Boolean).join(' + ') || '예수금 없음';
        } else {
          now = cashUSD;
          if (krw > 0 && fx > 0) {
            exchangeable = krw / fx;
          }
          parts = cashUSD > 0 ? `외화예수금${exchangeable > 0 ? ` · 원화 ${money(krw, 'KRW')} 환전하면 +${money(exchangeable, 'USD')}` : ''}` : `외화예수금 없음${exchangeable > 0 ? ` · 원화 ${money(krw, 'KRW')}` : ''}`;
        }
      }
      if (now < (usd ? 0.01 : 1) && exchangeable <= 0 && held <= 0) continue;
      const frac = fracAccounts.has(account.id);
      const sharesOf = (amt: number) => (price && price > 0 ? (frac ? Math.floor((amt / price) * 100) / 100 : Math.floor(amt / price)) : null);
      rows.push({ account, now, parts, exchangeable, held, reconciled: !!b?.last_adjusted, frac, shares: sharesOf(now), sharesX: exchangeable > 0 ? sharesOf(now + exchangeable) : null });
    }
    rows.sort((x, y) => (y.now > 0 ? 1 : 0) - (x.now > 0 ? 1 : 0) || (y.held > 0 ? 1 : 0) - (x.held > 0 ? 1 : 0) || y.now - x.now || y.exchangeable - x.exchangeable);
    const total = rows.reduce((s, r) => s + r.now, 0);
    const totalExchange = rows.reduce((s, r) => s + r.exchangeable, 0);
    const shares = price && price > 0 ? rows.reduce((s, r) => s + (r.shares ?? 0), 0) : null;
    const frac = rows.some((r) => r.now > 0 && r.frac);
    return { rows, total, totalExchange, shares, frac, blocked: [...blocked.entries()], converted, recorded, unreconciled: rows.filter((r) => r.now > 0 && !r.reconciled).length };
  }, [ctx, asset, ccy, price]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-mono">이 종목을 살 수 있는 예수금</p>
        {data && (data.total > 0 || data.totalExchange > 0) && (
          <p className="num text-[12px] text-zinc-400">
            {data.total > 0 && (
              <>
                바로 쓸 수 있는 <span className="font-medium text-white">{money(data.total, ccy)}</span>
                {data.shares != null && ` · 현재가로 ${shareText(Math.round(data.shares * 100) / 100, data.frac)}`}
              </>
            )}
            {data.totalExchange > 0 && `${data.total > 0 ? ' · ' : ''}환전하면 +${money(data.totalExchange, 'USD')}`}
          </p>
        )}
      </div>

      {ctx === 'error' ? (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">예수금을 불러오지 못했습니다.</p>
      ) : !data ? (
        <div className="h-20 animate-pulse rounded-xl bg-white/[0.03]" />
      ) : data.recorded === 0 ? (
        <p className="rounded-xl border border-white/[0.06] px-3 py-4 text-center text-xs text-zinc-500">아직 예수금 기록이 없습니다. 예수금 화면에서 계좌마다 '맞추기'로 증권사 앱의 예수금을 넣어 주세요.</p>
      ) : data.rows.length === 0 ? (
        <p className="rounded-xl border border-white/[0.06] px-3 py-4 text-center text-xs text-zinc-500">이 종목을 살 수 있는 계좌에 예수금이 없습니다.</p>
      ) : (
        <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
          {data.rows.map((r) => {
            const onlyFx = r.now <= 0 && r.exchangeable > 0;
            return (
              <div key={r.account.id} className={`flex items-center gap-3 px-3 py-2 ${r.now > 0 ? '' : 'opacity-70'}`}>
                <BrokerLogo broker={r.account.broker} className="h-7 w-16 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] text-zinc-100">
                    {isRestrictedAccount(r.account) && <Lock className="h-3 w-3 shrink-0 text-amber-300" />}
                    <span className="truncate">{accountDisplayName(r.account)}</span>
                    {r.held > 0 && <span className="chip shrink-0 !px-1.5 !py-0 !text-[10px]">보유 {r.held.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}주</span>}
                  </span>
                  <span className="num block truncate text-[11px] text-zinc-500">{r.parts}</span>
                </span>
                <span className="shrink-0 text-right">
                  {r.now > 0 ? (
                    <>
                      <span className="num block text-[13px] text-zinc-100">{money(r.now, ccy)}</span>
                      <span className={`block text-[11px] ${r.reconciled ? 'text-zinc-500' : 'text-amber-300'}`}>{[!r.reconciled && '잔액 미확인', shareText(r.shares, r.frac)].filter(Boolean).join(' · ')}</span>
                    </>
                  ) : onlyFx ? (
                    <>
                      <span className="num block text-[13px] text-zinc-400">+{money(r.exchangeable, 'USD')}</span>
                      <span className="block text-[11px] text-zinc-500">{['환전하면', shareText(r.sharesX, r.frac)].filter(Boolean).join(' · ')}</span>
                    </>
                  ) : (
                    <>
                      <span className="num block text-[13px] text-zinc-500">—</span>
                      <span className="block text-[11px] text-zinc-500">예수금 없음</span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {data && (data.unreconciled > 0 || data.blocked.length > 0 || data.converted) && (
        <div className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-zinc-500">
          {data.unreconciled > 0 && (
            <p className="flex items-start gap-1 text-amber-200/90">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              잔액을 맞추지 않은 계좌는 실제 예수금과 다를 수 있습니다.
            </p>
          )}
          {data.converted && <p>자동 환전 · 원화 결제 계좌는 원화를 현재 환율에 환전 수수료를 얹어 달러로 바꿔 계산했습니다.</p>}
          {data.blocked.length > 0 && <p>넣지 않은 예수금: {data.blocked.map(([why, v]) => `${why} ${money(v, 'KRW')}`).join(' · ')}</p>}
        </div>
      )}
    </div>
  );
}
