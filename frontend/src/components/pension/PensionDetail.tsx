import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pause, Pencil, Play, Plus, Scale, Trash2 } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { ContributionItemView, ContributionPlanView, ContributionRound } from '../../types/models';
import BrokerLogo from '../ui/BrokerLogo';
import { assetPrimary, assetSecondary } from '../../utils/assetLabel';
import { accountDisplayName } from '../../utils/accountLabel';
import { fmtCcy } from '../../utils/fx';
import FundReconcileModal from './FundReconcileModal';
import CashSyncModal from './CashSyncModal';
import ExtraBuyModal from './ExtraBuyModal';
import { askConfirm } from '../ui/confirmDialog';

/** 부담금 배분 상세 — 요약(상품 + 현금성자산), 상품별 보유·원금·평가(펀드는 평가금액 맞추기)·배분 밖 보유, 회차 기록 */

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '처리하지 못했습니다.');
const won = (v: number) => fmtCcy(v, 'KRW');
const shortDate = (d: string) => (d ? `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}` : '—');
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const tone = (v: number) => (v > 0 ? 'text-mint-300' : v < 0 ? 'text-rose-300' : 'text-zinc-300');
const qtyText = (it: ContributionItemView) => `${it.quantity.toLocaleString('ko-KR', { maximumFractionDigits: it.is_fund ? 2 : 4 })}${it.is_fund ? '좌' : '주'}`;
const daysSince = (d: string) => (d ? Math.floor((Date.now() - new Date(`${d}T00:00:00`).getTime()) / 86400000) : null);

function Tile({ label, value, sub, action }: { label: string; value: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center justify-between gap-2">
        <span className="label-mono">{label}</span>
        {action}
      </p>
      <div className="num mt-0.5 truncate text-lg text-white">{value}</div>
      {sub != null && <p className="num truncate text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export default function PensionDetail({ plan, onEdit, onChanged, onNotice }: { plan: ContributionPlanView; onEdit: () => void; onChanged: (deleted?: boolean) => void; onNotice: (msg: string) => void }) {
  const [rounds, setRounds] = useState<ContributionRound[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconcile, setReconcile] = useState<ContributionItemView | null>(null);
  const [cashSync, setCashSync] = useState(false);
  const [extraBuy, setExtraBuy] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRounds = useCallback(() => {
    apiClient
      .GetContributionRounds(plan.id)
      .then(setRounds)
      .catch((e) => setError(errText(e)));
  }, [plan.id]);
  useEffect(() => loadRounds(), [loadRounds, plan.rounds]);

  // 상품: 배분 상품 + 배분 밖 보유 (현금성자산으로 따로 산 것 등)
  const others = plan.others ?? [];
  const products = [...plan.items, ...others];
  const cost = products.reduce((s, it) => s + it.cost, 0);
  const value = products.reduce((s, it) => s + it.value, 0);
  const gain = value - cost;
  const staleFunds = products.filter((it) => it.is_fund && it.quantity > 0 && !!it.price_date && (daysSince(it.price_date) ?? 0) > 45);
  const unsyncedFunds = products.filter((it) => it.is_fund && it.quantity > 0 && !it.price_date);
  const cash = plan.cash;
  const yearlyInterest = plan.cash_rate > 0 && cash > 0 ? (cash * plan.cash_rate) / 100 : 0;

  const toggle = async () => {
    setBusy(true);
    try {
      await apiClient.UpdateContributionPlan(plan.id, {
        account_id: plan.account_id,
        amount: plan.amount,
        month_day: plan.month_day,
        notes: plan.notes,
        status: plan.status === 'active' ? 'paused' : 'active',
        items: plan.items.map((it) => ({ asset_id: it.asset_id, weight: it.weight })),
      });
      onNotice(plan.status === 'active' ? '자동 기록을 멈췄습니다.' : '자동 기록을 다시 시작했습니다.');
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await askConfirm('이 부담금 배분을 지울까요?\n이미 기록된 입금·매수는 실제 내역이라 그대로 남습니다.'))) return;
    try {
      await apiClient.DeleteContributionPlan(plan.id);
      onChanged(true);
    } catch (e) {
      setError(errText(e));
    }
  };

  const removeRound = async (r: ContributionRound) => {
    if (!(await askConfirm(`${shortDate(r.date)} 회차(입금 ${won(r.deposit)}와 매수 ${r.buys.length}건)를 지울까요?\n그달 부담금이 없었거나 금액이 달랐을 때 씁니다. 다시 자동으로 채우지 않습니다.`))) return;
    try {
      await apiClient.DeleteContributionRound(plan.id, r.date);
      onNotice(`${shortDate(r.date)} 회차를 지웠습니다.`);
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="space-y-4">
      {/* 머리말 */}
      <section className="surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrokerLogo broker={plan.account?.broker ?? ''} className="h-9 w-20 shrink-0" />
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-base font-semibold text-white">
                {accountDisplayName(plan.account, '퇴직연금')}
                <span className={`badge !py-0 text-[11px] ${plan.status === 'active' ? 'bg-mint-400/15 text-mint-300' : 'bg-white/[0.06] text-zinc-400'}`}>{plan.status === 'active' ? '자동 기록 중' : '멈춤'}</span>
              </p>
              <p className="num mt-0.5 text-[12px] text-zinc-400">
                매달 {plan.month_day}일 · {won(plan.amount)}
                {plan.status === 'active' && plan.next_date && ` · 다음 ${shortDate(plan.next_date)}`}
              </p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button type="button" className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              고치기
            </button>
            <button type="button" className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={toggle} disabled={busy}>
              {plan.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {plan.status === 'active' ? '멈추기' : '다시 시작'}
            </button>
            <button type="button" className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={remove} aria-label="지우기">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="surface-inset mt-4 grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4">
          <Tile label="총액" value={won(value + cash)} sub={`상품 ${won(value)} · 현금성 ${won(cash)}`} />
          <Tile
            label="상품 평가손익"
            value={<span className={tone(gain)}>{`${gain >= 0 ? '+' : '−'}${won(Math.abs(gain))}`}</span>}
            sub={cost > 0 ? (
              <>
                <span className={tone(gain)}>{signedPct((gain / cost) * 100)}</span> · 원금 {won(cost)}
              </>
            ) : undefined}
          />
          <Tile
            label="현금성자산"
            value={<span className={cash < 0 ? 'text-rose-300' : ''}>{won(cash)}</span>}
            sub={`${plan.cash_rate > 0 ? `연 ${plan.cash_rate}%${yearlyInterest > 0 ? ` · 1년 ≈ ${won(yearlyInterest)}` : ''}` : '금리 미입력'} · ${plan.cash_synced_on ? `${shortDate(plan.cash_synced_on)} 맞춤` : '아직 안 맞춤'}`}
            action={
              <button type="button" className="text-[11px] font-medium text-mint-300 hover:underline" onClick={() => setCashSync(true)} title="은행 앱의 현금성자산 금액에 맞추기 (늘어난 차이는 이자)">
                맞추기
              </button>
            }
          />
          <Tile label="자동 기록" value={`${plan.rounds}회`} sub={`${shortDate(plan.auto_from)}부터 · 부담금 ${won(plan.paid)}${plan.processed_through ? ` · ${shortDate(plan.processed_through)}까지 처리` : ''}`} />
        </div>
        {(staleFunds.length > 0 || unsyncedFunds.length > 0) && (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
            {staleFunds.length > 0 && `펀드 ${staleFunds.map((it) => assetPrimary(it.asset)).join(', ')}의 평가금액을 한 달 넘게 맞추지 않았습니다. `}
            {unsyncedFunds.length > 0 && `펀드 ${unsyncedFunds.map((it) => assetPrimary(it.asset)).join(', ')}는 아직 평가금액을 맞추지 않아 산 값 그대로 평가합니다. `}
            은행 앱의 평가금액으로 '맞추기'를 하면 자산 추이가 정확해집니다.
          </p>
        )}
        {error && <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
      </section>

      {/* 상품 */}
      <section className="surface p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="label-mono">상품 · 목표 비율 대비 지금 비중</p>
          <button type="button" className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => setExtraBuy(true)} title="현금성자산으로 따로 산 상품 기록">
            <Plus className="h-3.5 w-3.5" />
            추가 매수 기록
          </button>
        </div>
        <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
          <div className="hidden grid-cols-[minmax(0,1.8fr)_6rem_repeat(3,minmax(0,1fr))_6.5rem] gap-3 bg-white/[0.02] px-3 py-1.5 md:grid">
            {['상품', '목표 → 지금', '원금', '평가금액', '수익률', '평가'].map((h, i) => (
              <span key={h} className={`label-mono ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </span>
            ))}
          </div>
          {products.map((it, i) => {
            const g = it.value - it.cost;
            const actual = value > 0 ? (it.value / value) * 100 : 0;
            const outside = i >= plan.items.length;
            return (
              <div key={outside ? `o-${it.asset_id}` : it.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 md:grid-cols-[minmax(0,1.8fr)_6rem_repeat(3,minmax(0,1fr))_6.5rem]">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] text-zinc-100">{assetPrimary(it.asset)}</span>
                    <span className="chip shrink-0 !px-1.5 !py-0 !text-[10px]">{it.is_fund ? '펀드' : 'ETF'}</span>
                    {outside && <span className="chip shrink-0 !px-1.5 !py-0 !text-[10px] text-amber-200">배분 밖</span>}
                  </span>
                  <span className="num block truncate text-[11px] text-zinc-500">
                    {assetSecondary(it.asset)} · {qtyText(it)} · {it.is_fund ? `기준가 ${won(it.price)}` : `현재가 ${won(it.price)}`}
                  </span>
                </span>
                <span className="hidden md:block">
                  <span className="num block text-right text-[12px] text-zinc-300">
                    {outside ? '—' : `${it.weight}%`} <span className="text-zinc-500">→ {actual.toFixed(1)}%</span>
                  </span>
                  <span className="relative mt-1 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-mint-400/70" style={{ width: `${Math.min(100, actual)}%` }} />
                    {!outside && <span className="absolute inset-y-0 w-0.5 bg-white/70" style={{ left: `${Math.min(100, it.weight)}%` }} />}
                  </span>
                </span>
                <span className="num hidden text-right text-[13px] text-zinc-300 md:block">{won(it.cost)}</span>
                <span className="num hidden text-right text-[13px] text-zinc-100 md:block">{won(it.value)}</span>
                <span className={`num hidden text-right text-[13px] md:block ${tone(g)}`}>{it.cost > 0 ? signedPct((g / it.cost) * 100) : '—'}</span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="num text-[13px] text-zinc-100 md:hidden">{won(it.value)}</span>
                  {it.is_fund ? (
                    <>
                      <button type="button" className="btn-ghost !px-2 !py-0.5 !text-[11px]" onClick={() => setReconcile(it)} title="은행 앱의 평가금액으로 기준가 맞추기">
                        <Scale className="h-3 w-3" />
                        맞추기
                      </button>
                      <span className={`num text-[10.5px] ${(daysSince(it.price_date) ?? 999) > 45 ? 'text-amber-300' : 'text-zinc-500'}`}>{it.price_date ? `${shortDate(it.price_date)} 맞춤` : '아직 안 맞춤'}</span>
                    </>
                  ) : (
                    <span className="num text-[10.5px] text-zinc-500">시세로 평가</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          ETF 는 납입일(휴장이면 다음 거래일) 종가로 1주 단위로 사고 남는 돈은 현금성자산(예수금)에 남습니다 — 붙는 이자는 현금성자산 '맞추기'로 기록합니다. 펀드는 그날까지 맞춘 기준가로 좌수를 셉니다 — 실제 매수 기준가와 조금 달라도 평가금액을 맞추면 평가는 은행 앱과 같아집니다.
        </p>
      </section>

      {/* 회차 */}
      <section className="surface p-4 sm:p-5">
        <p className="label-mono mb-2">회차 기록 · 최근부터</p>
        {rounds == null ? (
          <div className="h-20 animate-pulse rounded-xl bg-white/[0.03]" />
        ) : rounds.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-500">아직 자동 기록한 회차가 없습니다. 납입일이 지나면 그날 입금과 매수를 기록합니다.</p>
        ) : (
          <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
            {rounds.slice(0, 24).map((r) => (
              <div key={r.date} className="flex items-start gap-3 px-3 py-2">
                <span className="num w-16 shrink-0 pt-0.5 text-[12px] text-zinc-400">{shortDate(r.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="num block text-[13px] text-zinc-100">입금 {won(r.deposit)}</span>
                  <span className="num block text-[11px] leading-relaxed text-zinc-500">
                    {r.buys.length === 0
                      ? '매수 없음'
                      : r.buys.map((t) => `${assetPrimary(t.asset)} ${t.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${/^FUND:/i.test(t.asset?.ticker ?? '') ? '좌' : '주'} × ${won(t.price)}`).join(' · ')}
                  </span>
                </span>
                <button type="button" className="shrink-0 text-zinc-500 hover:text-rose-300" onClick={() => removeRound(r)} aria-label="회차 지우기" title="회차 지우기">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {cashSync && (
        <CashSyncModal
          plan={plan}
          onClose={() => setCashSync(false)}
          onSaved={(msg) => {
            setCashSync(false);
            onNotice(msg);
            onChanged();
          }}
        />
      )}
      {extraBuy && (
        <ExtraBuyModal
          plan={plan}
          onClose={() => setExtraBuy(false)}
          onSaved={(msg) => {
            setExtraBuy(false);
            onNotice(msg);
            onChanged();
          }}
        />
      )}
      {reconcile && (
        <FundReconcileModal
          accountId={plan.account_id}
          item={reconcile}
          onClose={() => setReconcile(null)}
          onSaved={(msg) => {
            setReconcile(null);
            onNotice(msg);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
