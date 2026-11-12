import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { AccumulationPlanView, PlanCurrency, PlanStatus } from '../../types/models';
import { assetTitle, belowMinimum, fmtAmount, fmtSignedPct, ruleText, signTone } from './planText';
import { cashAmount, daysText, daysTone, LOW_DAYS, type AccountCashNeed } from './cashNeed';

interface PlanListProps {
  plans: AccumulationPlanView[];
  status: PlanStatus;
  onStatus: (s: PlanStatus) => void;
  counts: Record<PlanStatus, number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** 계좌별 한 달 필요 금액 · 예수금 */
  needs: Map<number, AccountCashNeed>;
}

/** 계좌별 한 달 최대 금액 (조건을 늘 만족할 때)과 지금 예수금으로 버티는 거래일 수 */
function MonthlyNeed({ needs }: { needs: Map<number, AccountCashNeed> }) {
  const rows = [...needs.values()];
  if (rows.length === 0) return null;
  const unknown = rows.filter((r) => !r.reconciled).length;
  return (
    <div className="space-y-1.5" title={'조건을 늘 만족한다고 볼 때 한 달(거래일 21일)에 필요한 금액입니다.\n미국 주식은 원화 결제 계좌면 원화로 바꿔 셉니다.'}>
      <p className="label-mono">한 달 최대 필요 금액 · 예수금</p>
      {rows.map((r) => {
        const cash = [r.needKRW > 0 && cashAmount(r.cashKRW, 'KRW'), r.needUSD > 0 && cashAmount(r.cashUSD, 'USD')].filter(Boolean).join(' + ');
        const low = r.days != null && r.days < LOW_DAYS;
        return (
          <div key={r.accountId} className={`text-xs ${low ? '-mx-2 rounded-lg bg-amber-500/[0.07] px-2 py-1' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-zinc-400">{r.name}</span>
              <span className="num shrink-0 text-zinc-200">
                {[r.needKRW > 0 && fmtAmount(r.needKRW, 'KRW'), r.needUSD > 0 && fmtAmount(r.needUSD, 'USD')].filter(Boolean).join(' + ')}
                <span className="text-zinc-500"> / 월</span>
              </span>
            </div>
            {r.reconciled && (
              <div className="num mt-0.5 flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-zinc-500">예수금 {cash}</span>
                <span className={`shrink-0 ${daysTone(r.days)}`}>{daysText(r.days)}</span>
              </div>
            )}
          </div>
        );
      })}
      {unknown > 0 && <p className="text-[11px] leading-relaxed text-zinc-500">계좌 화면에서 '잔액 맞추기'를 하면 예수금으로 며칠 버틸 수 있는지 보여 줍니다.</p>}
    </div>
  );
}

export default function PlanList({ plans, status, onStatus, counts, selectedId, onSelect, needs }: PlanListProps) {
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const visible = plans.filter((p) => p.status === status);

  useEffect(() => {
    if (selectedId != null) rowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || visible.length === 0) return;
    e.preventDefault();
    const idx = visible.findIndex((p) => p.id === selectedId);
    const next = e.key === 'ArrowDown' ? Math.min(visible.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
    onSelect(visible[next].id);
    rowRefs.current.get(visible[next].id)?.focus();
  };

  return (
    <>
      <div className="shrink-0 space-y-3 border-b border-white/[0.07] p-3 sm:p-4">
        <div className="glass-pill flex w-full p-1" role="group" aria-label="진행 상태">
          {(['active', 'paused'] as PlanStatus[]).map((s) => (
            <button key={s} type="button" onClick={() => onStatus(s)} aria-pressed={status === s} className={`pill-item flex-1 ${status === s ? 'pill-item-active' : ''}`}>
              {s === 'active' ? '진행 중' : '중지'} <span className={`num font-semibold ${s === 'active' ? 'text-mint-300' : ''}`}>{counts[s]}</span>
            </button>
          ))}
        </div>
        {status === 'active' && <MonthlyNeed needs={needs} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onKeyDown} role="listbox" aria-label="주식 모으기 목록">
        {visible.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-400">{status === 'active' ? '진행 중인 모으기가 없습니다.' : '중지한 모으기가 없습니다.'}</p>
        ) : (
          visible.map((p) => {
            const active = p.id === selectedId;
            const ccy = p.asset_currency as PlanCurrency;
            const ret = p.holding_return_pct;
            const title = assetTitle(p.asset);
            return (
              <button
                key={p.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(p.id, el);
                  else rowRefs.current.delete(p.id);
                }}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={active || (selectedId == null && p === visible[0]) ? 0 : -1}
                onClick={() => onSelect(p.id)}
                className={`flex w-full items-center gap-3 border-b border-white/[0.04] px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-mint-400/60 ${
                  active ? 'bg-mint-400/[0.08] shadow-[inset_3px_0_0_rgb(var(--c-mint-400))]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`flex items-baseline gap-1.5 ${active ? 'text-white' : 'text-zinc-100'}`}>
                    {title.tickerFirst ? (
                      <>
                        <span className="shrink-0 text-[15px] font-semibold tracking-tight">{title.primary}</span>
                        <span className="truncate text-[11px] text-zinc-500">{title.secondary}</span>
                      </>
                    ) : (
                      <>
                        <span className={`truncate text-[14px] ${active ? 'font-medium' : ''}`}>{title.primary}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">{title.secondary}</span>
                      </>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-400">
                    {ruleText(p, ccy)}
                    {belowMinimum(p) && <span className="ml-1.5 text-amber-300">· 금액 부족</span>}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10.5px] text-zinc-600">
                    {p.account?.name} · {p.rounds}회
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`num block text-[14px] ${ret == null ? 'text-zinc-600' : signTone(ret)}`}>{ret == null ? '—' : fmtSignedPct(ret)}</span>
                  {p.pnl != null && <span className={`num block text-[11px] ${signTone(p.pnl)}`}>{`${p.pnl >= 0 ? '+' : '-'}${fmtAmount(Math.abs(p.pnl), p.amount_currency)}`}</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
