import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import type { AccumulationPlanView, PlanCurrency, PlanStatus } from '../../types/models';
import { belowMinimum, fmtAmount, fmtSignedPct, ruleText, signTone } from './planText';

interface PlanListProps {
  plans: AccumulationPlanView[];
  status: PlanStatus;
  onStatus: (s: PlanStatus) => void;
  counts: Record<PlanStatus, number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

/** 계좌별 한 달 최대 금액 (조건을 늘 만족할 때) — 예수금 준비용 */
function MonthlyNeed({ plans }: { plans: AccumulationPlanView[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { name: string; krw: number; usd: number }>();
    for (const p of plans) {
      if (p.status !== 'active') continue;
      const key = String(p.account_id);
      const r = m.get(key) ?? { name: p.account?.name ?? `계좌 ${p.account_id}`, krw: 0, usd: 0 };
      if (p.amount_currency === 'KRW') r.krw += p.monthly_max;
      else r.usd += p.monthly_max;
      m.set(key, r);
    }
    return [...m.values()];
  }, [plans]);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1" title="조건을 늘 만족한다고 볼 때 한 달(거래일 21일)에 필요한 금액입니다.">
      <p className="label-mono">한 달 최대 필요 금액</p>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-zinc-400">{r.name}</span>
          <span className="num shrink-0 text-zinc-200">{[r.krw > 0 && fmtAmount(r.krw, 'KRW'), r.usd > 0 && fmtAmount(r.usd, 'USD')].filter(Boolean).join(' + ')}</span>
        </div>
      ))}
    </div>
  );
}

export default function PlanList({ plans, status, onStatus, counts, selectedId, onSelect }: PlanListProps) {
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
        {status === 'active' && <MonthlyNeed plans={plans} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onKeyDown} role="listbox" aria-label="주식 모으기 목록">
        {visible.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-400">{status === 'active' ? '진행 중인 모으기가 없습니다.' : '중지한 모으기가 없습니다.'}</p>
        ) : (
          visible.map((p) => {
            const active = p.id === selectedId;
            const ccy = p.asset_currency as PlanCurrency;
            const ret = p.holding_return_pct;
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
                  <span className={`flex items-center gap-1.5 text-[14px] ${active ? 'font-medium text-white' : 'text-zinc-100'}`}>
                    <span className="truncate">{p.asset?.name ?? p.asset?.ticker}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">{p.asset?.ticker}</span>
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
