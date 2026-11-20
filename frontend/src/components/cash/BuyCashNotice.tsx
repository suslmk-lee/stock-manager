import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import type { BuyCashCheck } from '../../types/models';
import { fmtCcy } from '../../utils/fx';

/**
 * 매수 기록 창에서 그날 예수금이 모자라면 알려 주고, 모자란 만큼 입금(또는 원화에서 환전)도 같이 기록할지 고르게 한다.
 * 매수만 기록하고 입금·환전을 빠뜨리면 예수금이 마이너스가 되어 오늘 화면의 살 계좌·모으기 예수금 확인이 틀어진다.
 * 잔액을 맞춘 계좌만 확인한다 (서버 CashService.CheckBuy).
 */

/** 매수와 같이 남길 현금 기록 — 입금, 또는 원화 → 달러 환전 */
export type PendingCash = { kind: 'deposit'; currency: 'KRW' | 'USD'; amount: number } | { kind: 'exchange'; krw: number; usd: number };

export interface BuyCashInput {
  accountId: number;
  assetId: number;
  date: string;
  price: number;
  quantity: number;
  fee: number;
}

/** 확인할 수 있는 입력인지 */
const ready = (x: BuyCashInput) => x.accountId > 0 && x.assetId > 0 && x.price > 0 && x.quantity > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.date);

/** 화면에 보이는 문구 */
export const pendingText = (c: PendingCash) => (c.kind === 'deposit' ? `입금 ${fmtCcy(c.amount, c.currency)}` : `환전 ${fmtCcy(c.krw, 'KRW')} → ${fmtCcy(c.usd, 'USD')}`);

/** 매수를 기록한 뒤 같이 남길 입금·환전 기록 */
export async function recordPendingCash(accountId: number, date: string, items: PendingCash[]) {
  for (const c of items) {
    if (c.kind === 'deposit') {
      await apiClient.CreateCashEntry(accountId, { currency: c.currency, date, kind: 'deposit', amount: c.amount, notes: '매수 대금 입금 (매수 기록할 때 같이)' });
    } else {
      await apiClient.CreateCashExchange(accountId, { date, from_currency: 'KRW', from_amount: c.krw, to_amount: c.usd, notes: '매수 대금 환전 (매수 기록할 때 같이 · 그날 환율로 추정)' });
    }
  }
}

export default function BuyCashNotice({ input, onChange }: { input: BuyCashInput; onChange: (items: PendingCash[]) => void }) {
  const [check, setCheck] = useState<BuyCashCheck | null>(null);
  const [add, setAdd] = useState(true);
  const key = JSON.stringify(input);

  // 입력이 멈추면 확인 (0.4초)
  useEffect(() => {
    if (!ready(input)) {
      setCheck(null);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      apiClient
        .CheckBuyCash(input.accountId, { asset_id: input.assetId, date: input.date, price: input.price, quantity: input.quantity, fee: input.fee })
        .then((c) => live && setCheck(c))
        .catch(() => live && setCheck(null)); // 확인하지 못하면 안내 없이 그대로 기록
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const shorts = check?.tracked ? (check.shorts ?? []) : [];
  const items: PendingCash[] = shorts.map((s) =>
    s.exchange_krw ? { kind: 'exchange', krw: s.exchange_krw, usd: s.short } : { kind: 'deposit', currency: s.currency as 'KRW' | 'USD', amount: s.short },
  );
  const itemsKey = add ? JSON.stringify(items) : '[]';
  useEffect(() => {
    onChange(add ? items : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  if (shorts.length === 0) return null;
  const need = shorts.map((s) => fmtCcy(s.short, s.currency)).join(' + ');
  const had = shorts.map((s) => fmtCcy(s.balance, s.currency)).join(' · ');
  const exchange = items.some((c) => c.kind === 'exchange');
  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-100">
      <p>
        이 계좌 그날 예수금({had})으로는 <b className="num">{need}</b> 모자라요. {exchange ? '환전' : '입금'} 기록이 빠졌다면 같이 남겨 두세요 — 빠지면 예수금이 마이너스가 되고
        모으기 회차가 기록되지 않을 수 있어요.
      </p>
      <label className="mt-2 flex cursor-pointer items-start gap-2 text-amber-50">
        <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-400" checked={add} onChange={(e) => setAdd(e.target.checked)} />
        <span>
          {exchange ? '원화에서 환전한 기록도 남기기' : '모자란 만큼 입금도 기록'}{' '}
          <span className="num">
            ({items.map(pendingText).join(' · ')} · {input.date})
          </span>
          {exchange && <span className="block text-[11px] text-amber-200/80">그날 환율과 계좌의 환전 수수료로 추정한 원화예요. 실제와 다르면 예수금 화면에서 고치세요.</span>}
        </span>
      </label>
    </div>
  );
}
