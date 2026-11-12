import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, Pause, Pencil, Play, Trash2, X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { AccumulationFill, AccumulationPlanRequest, AccumulationPlanView, PlanCurrency, PlanStatus } from '../../types/models';
import { accountLabel, assetTitle, belowMinimum, fmtAmount, fmtDay, fmtPrice, fmtQty, fmtSignedAmount, fmtSignedPct, nextText, ruleText, signTone, stepLabel } from './planText';
import { cashAmount, LOW_DAYS, type AccountCashNeed } from './cashNeed';

interface PlanDetailProps {
  plan: AccumulationPlanView;
  /** 이 계좌의 모으기 전체 필요 금액 · 예수금 */
  need?: AccountCashNeed;
  onEdit: () => void;
  /** 계획·회차가 바뀌었을 때 (목록 다시 불러오기). 중지·다시 시작이면 바뀐 상태를 넘긴다 */
  onChanged: (nextStatus?: PlanStatus) => void;
  onDeleted: () => void;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : typeof err === 'string' ? err : '처리하지 못했습니다.');

function Stat({ label, value, sub, tone = 'text-white' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="label-mono">{label}</p>
      <p className={`num mt-0.5 truncate text-[15px] font-semibold ${tone}`}>{value}</p>
      {sub && <p className="num mt-0.5 truncate text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export const toRequest = (p: AccumulationPlanView): AccumulationPlanRequest => ({
  account_id: p.account_id,
  asset_id: p.asset_id,
  amount: p.amount,
  amount_currency: p.amount_currency,
  qty_step: p.qty_step,
  schedule: p.schedule,
  weekdays: p.weekdays,
  month_day: p.month_day,
  condition: p.condition,
  condition_value: p.condition_value,
  status: p.status,
  started_on: p.started_on,
  auto_from: p.auto_from,
  opening_rounds: p.opening_rounds,
  opening_amount: p.opening_amount,
  opening_quantity: p.opening_quantity,
  notes: p.notes,
});

export default function PlanDetail({ plan, need, onEdit, onChanged, onDeleted }: PlanDetailProps) {
  const ccy = plan.amount_currency;
  const assetCcy = plan.asset_currency as PlanCurrency;
  const title = assetTitle(plan.asset);
  const [fills, setFills] = useState<AccumulationFill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editQty, setEditQty] = useState('');

  const loadFills = useCallback(async () => {
    try {
      const r = await apiClient.GetAccumulationFills(plan.id);
      setFills(r.fills ?? []);
    } catch (e) {
      setError(`회차를 불러오지 못했습니다: ${errText(e)}`);
      setFills([]);
    }
  }, [plan.id]);

  useEffect(() => {
    setFills(null);
    setEditId(null);
    setError(null);
    loadFills();
  }, [loadFills, plan.auto_rounds, plan.updated_at]);

  const act = async (fn: () => Promise<unknown>, nextStatus?: PlanStatus) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged(nextStatus);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = () => {
    const nextStatus: PlanStatus = plan.status === 'active' ? 'paused' : 'active';
    act(() => apiClient.UpdateAccumulationPlan(plan.id, { ...toRequest(plan), status: nextStatus }), nextStatus);
  };

  const remove = () => {
    if (!window.confirm(`${title.primary || '이'} 모으기를 지울까요?\n이미 기록한 매수는 실제로 산 것이라 매매 기록에 그대로 남습니다.`)) return;
    setBusy(true);
    apiClient
      .DeleteAccumulationPlan(plan.id)
      .then(onDeleted)
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(false));
  };

  const startEdit = (f: AccumulationFill) => {
    setEditId(f.transaction_id);
    setEditAmount(String(ccy === 'KRW' ? Math.round(f.amount) : Math.round(f.amount * 100) / 100));
    setEditQty(String(f.quantity));
  };

  const saveFill = () => {
    if (editId == null) return;
    const amount = Number(editAmount.replace(/,/g, ''));
    const qty = Number(editQty);
    if (!(amount > 0) || !(qty > 0)) return setError('금액과 수량은 0보다 커야 합니다.');
    act(async () => {
      await apiClient.UpdateAccumulationFill(editId, qty, amount);
      setEditId(null);
      await loadFills();
    });
  };

  const skipFill = (f: AccumulationFill) => {
    if (!window.confirm(`${fmtDay(f.date)} 회차를 지울까요?\n증권사에서 실제로 사지 않은 날만 지우세요. 지운 날은 다시 채우지 않습니다.`)) return;
    act(async () => {
      await apiClient.DeleteAccumulationFill(f.transaction_id);
      await loadFills();
    });
  };

  const next = plan.status === 'active' ? nextText(plan) : '';
  const ret = plan.holding_return_pct;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* 머리말 */}
      <div className="border-b border-white/[0.07] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className={`truncate font-semibold text-white ${title.tickerFirst ? 'text-2xl tracking-tight' : 'text-lg'}`}>{title.primary}</h2>
              {plan.status === 'paused' && <span className="badge border border-white/10 bg-white/[0.05] text-zinc-400">중지</span>}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-zinc-400">
              {title.secondary && <span className={title.tickerFirst ? '' : 'font-mono text-[11px] text-zinc-500'}>{title.secondary}</span>}
              <span className="font-mono text-[11px] text-zinc-500">
                {title.secondary ? ' · ' : ''}
                {accountLabel(plan.account)}
              </span>
            </p>
            <p className="mt-2 text-sm text-zinc-200">{ruleText(plan, assetCcy)}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {stepLabel(plan.qty_step)}
              {plan.started_on ? ` · ${fmtDay(plan.started_on)} 시작` : ''}
              {plan.notes ? ` · ${plan.notes}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button type="button" className="btn-icon" onClick={onEdit} disabled={busy} aria-label="수정" title="수정">
              <Pencil className="h-4 w-4" />
            </button>
            <button type="button" className="btn-icon" onClick={toggleStatus} disabled={busy} aria-label={plan.status === 'active' ? '중지' : '다시 시작'} title={plan.status === 'active' ? '중지 (기록 멈춤)' : '다시 시작 (오늘부터 기록)'}>
              {plan.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button type="button" className="btn-icon hover:!text-rose-300" onClick={remove} disabled={busy} aria-label="삭제" title="삭제">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {belowMinimum(plan) && (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
            지금 가격에서는 {stepLabel(plan.qty_step).replace(' 단위', '')}가 {fmtAmount(plan.min_amount!, ccy)}이라 {fmtAmount(plan.amount, ccy)}으로는 살 수 없어 회차가 건너뛰어집니다. 증권사 앱의 수량을 보고 수량 단위를 바꿔 주세요.
          </p>
        )}
        {plan.status === 'active' && need?.days != null && need.days < LOW_DAYS && (
          <p
            className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
              need.days <= 0 ? 'border-rose-400/30 bg-rose-500/10 text-rose-100' : 'border-amber-400/30 bg-amber-500/10 text-amber-100'
            }`}
          >
            {need.name} 예수금 {[need.needKRW > 0 && cashAmount(need.cashKRW, 'KRW'), need.needUSD > 0 && cashAmount(need.cashUSD, 'USD')].filter(Boolean).join(' + ')} —{' '}
            {need.days <= 0 ? '다음 회차를 살 돈이 부족합니다.' : `이 계좌 모으기 전체로 약 ${need.days}거래일분 남았습니다.`} 입금하지 않으면 증권사에서 회차가 빠질 수 있어요.
          </p>
        )}
        {error && <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
      </div>

      {/* 현황 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-white/[0.07] p-4 sm:grid-cols-4 sm:p-5">
        <Stat label="모은 회차" value={`${plan.rounds}회`} sub={plan.opening_rounds > 0 ? `등록 전 ${plan.opening_rounds} · 앱 기록 ${plan.auto_rounds}` : `앱 기록 ${plan.auto_rounds}`} />
        <Stat label="투자금" value={fmtAmount(plan.invested, ccy)} sub={fmtQty(plan.quantity)} />
        <Stat label="평가금" value={plan.value != null ? fmtAmount(plan.value, ccy) : '—'} sub={plan.current_price > 0 ? `${fmtPrice(plan.current_price, assetCcy)}${plan.price_date ? ` · ${plan.price_date.slice(5).replace('-', '/')}` : ''}` : '시세 없음'} />
        <Stat
          label="모으기 손익"
          value={plan.pnl != null ? fmtSignedAmount(plan.pnl, ccy) : '—'}
          sub={plan.pnl_pct != null ? fmtSignedPct(plan.pnl_pct) : undefined}
          tone={plan.pnl != null ? signTone(plan.pnl) : 'text-zinc-500'}
        />
        <Stat
          label="보유 수익률"
          value={ret != null ? fmtSignedPct(ret) : '—'}
          sub={plan.holding_quantity > 0 ? `계좌 전체 ${fmtQty(plan.holding_quantity)} · 평단 ${fmtPrice(plan.holding_avg_price, assetCcy)}` : '이 계좌 보유 없음'}
          tone={ret != null ? signTone(ret) : 'text-zinc-500'}
        />
        <Stat
          label="다음 회차"
          value={next || (plan.status === 'active' ? '—' : '중지됨')}
          sub={
            plan.condition === 'always' || plan.condition_met == null
              ? undefined
              : plan.condition_met
                ? '지금 가격이면 삽니다'
                : '지금 가격이면 건너뜁니다'
          }
          tone={plan.status === 'active' ? 'text-white' : 'text-zinc-500'}
        />
        <Stat label="한 달 최대" value={fmtAmount(plan.monthly_max, ccy)} sub={plan.condition === 'always' ? '거래일 21일 기준' : '조건을 늘 만족할 때'} />
        <Stat label="마지막 기록" value={plan.last_fill_date ? fmtDay(plan.last_fill_date) : '—'} sub={plan.processed_through ? `${plan.processed_through.slice(5).replace('-', '/')}까지 확인` : '아직 확인 전'} />
      </div>

      {/* 회차 내역 */}
      <div className="p-4 sm:p-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="section-title">모으기 내역</h3>
          <span className="label-mono">그날 종가로 계산한 값 · 다르면 고치세요</span>
        </div>
        {fills == null ? (
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {fills.length === 0 && (
              <p className="py-6 text-center text-xs text-zinc-500">
                {plan.processed_through && plan.processed_through >= plan.auto_from
                  ? `${fmtDay(plan.auto_from)}부터 확인했지만 ${belowMinimum(plan) ? '금액이 최소 단위보다 작아' : plan.condition !== 'always' ? '조건에 맞는 날이 없어' : '아직'} 산 회차가 없습니다.`
                  : plan.status === 'active'
                    ? `${fmtDay(plan.auto_from)} 장이 끝나면 첫 회차가 기록됩니다.`
                    : '앱이 기록한 회차가 없습니다.'}
              </p>
            )}
            {fills.map((f) =>
              editId === f.transaction_id ? (
                <div key={f.transaction_id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="w-16 shrink-0 text-sm text-zinc-300">{f.round}회차</span>
                  <label className="flex items-center gap-1 text-xs text-zinc-500">
                    금액
                    <input inputMode="decimal" className="input-field num !w-24 !px-2 !py-1 text-right" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} aria-label="실제 금액" />
                    {ccy === 'KRW' ? '원' : '$'}
                  </label>
                  <label className="flex items-center gap-1 text-xs text-zinc-500">
                    수량
                    <input inputMode="decimal" className="input-field num !w-24 !px-2 !py-1 text-right" value={editQty} onChange={(e) => setEditQty(e.target.value)} aria-label="실제 수량" />주
                  </label>
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="btn-icon !h-7 !w-7" onClick={saveFill} disabled={busy} aria-label="저장">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="btn-icon !h-7 !w-7" onClick={() => setEditId(null)} aria-label="취소">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              ) : (
                <div key={f.transaction_id} className="group flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm text-zinc-100">
                      {f.round}회차
                      {f.edited && <span className="badge !px-1.5 !py-0 border border-sky-400/25 bg-sky-400/10 text-[10px] text-sky-200">고침</span>}
                    </p>
                    <p className="text-[11px] text-zinc-500">{fmtDay(f.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="num text-sm text-zinc-100">{fmtAmount(f.amount, ccy)}</p>
                    <p className="num text-[11px] text-zinc-500">
                      {fmtQty(f.quantity)} · {fmtPrice(f.price, assetCcy)}
                    </p>
                  </div>
                  <span className="flex shrink-0 gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                    <button type="button" className="btn-icon !h-7 !w-7" onClick={() => startEdit(f)} disabled={busy} aria-label={`${f.round}회차 고치기`} title="실제 금액·수량으로 고치기">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="btn-icon !h-7 !w-7 hover:!text-rose-300" onClick={() => skipFill(f)} disabled={busy} aria-label={`${f.round}회차 지우기`} title="실제로 사지 않은 날">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              ),
            )}
            {(plan.opening_rounds > 0 || plan.opening_quantity > 0) && (
              <div className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-300">등록 전 {plan.opening_rounds}회 합계</p>
                  <p className="text-[11px] text-zinc-500">{plan.started_on ? `${fmtDay(plan.started_on)}부터` : '증권사 앱의 누적 값'}{plan.opening_tx_id ? ' · 보유에 더함' : ''}</p>
                </div>
                <div className="text-right">
                  <p className="num text-sm text-zinc-300">{fmtAmount(plan.opening_amount, ccy)}</p>
                  <p className="num text-[11px] text-zinc-500">{fmtQty(plan.opening_quantity)}</p>
                </div>
                <span className="w-[60px] shrink-0" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
