import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Plus, RefreshCw } from 'lucide-react';
import { PageActions } from '../components/shell/PageSlots';
import SplitView from '../components/shell/SplitView';
import PlanList from '../components/accumulation/PlanList';
import PlanDetail from '../components/accumulation/PlanDetail';
import PlanForm from '../components/accumulation/PlanForm';
import { apiClient } from '../api/client';
import type { AccumulationPlanView, PlanStatus } from '../types/models';

const errText = (err: unknown) => (err instanceof Error ? err.message : typeof err === 'string' ? err : '');

/** 주식 모으기: 증권사의 정기 소액 매수를 적어 두고, 장이 끝날 때마다 회차를 기록한다 */
export default function AccumulationPage() {
  const [plans, setPlans] = useState<AccumulationPlanView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<PlanStatus>('active');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [split, setSplit] = useState<boolean | null>(null);
  const [form, setForm] = useState<{ plan: AccumulationPlanView | null } | null>(null);

  const load = useCallback(async (initial = false) => {
    try {
      if (initial) setLoading(true);
      setError(null);
      const r = await apiClient.GetAccumulationPlans();
      setPlans(r.plans ?? []);
    } catch (e) {
      const d = errText(e);
      setError(d ? `주식 모으기를 불러오지 못했습니다: ${d}` : '주식 모으기를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  // 장이 끝난 거래일의 회차를 채운 뒤, 새로 생긴 게 있으면 다시 불러온다
  const runDue = useCallback(
    async (manual = false) => {
      setRefreshing(true);
      try {
        const r = await apiClient.RunAccumulations();
        if (r.created > 0) {
          setNotice(`새 회차 ${r.created}건을 기록했습니다.`);
          await load(false);
        } else if (manual) {
          await load(false);
          setNotice(r.errors?.length ? `일부 시세를 가져오지 못했습니다: ${r.errors[0]}` : '새로 기록할 회차가 없습니다.');
        }
      } catch (e) {
        if (manual) setError(`자동 기록을 확인하지 못했습니다: ${errText(e)}`);
      } finally {
        setRefreshing(false);
      }
    },
    [load],
  );

  useEffect(() => {
    load(true).then(() => runDue(false));
  }, [load, runDue]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const counts = useMemo(() => {
    const c: Record<PlanStatus, number> = { active: 0, paused: 0 };
    for (const p of plans ?? []) c[p.status] += 1;
    return c;
  }, [plans]);
  const visible = useMemo(() => (plans ?? []).filter((p) => p.status === status), [plans, status]);
  const selected = (plans ?? []).find((p) => p.id === selectedId) ?? null;

  // 넓은 화면은 항상 하나를 보여 주고, 좁은 화면은 고를 때만 상세로 간다
  useEffect(() => {
    if (split === null || plans === null) return;
    if (selectedId != null && visible.some((p) => p.id === selectedId)) return;
    if (split) setSelectedId(visible[0]?.id ?? null);
    else if (selectedId != null) setSelectedId(null);
  }, [split, plans, visible, selectedId]);

  const onSaved = async (p: AccumulationPlanView) => {
    setForm(null);
    await load(false);
    setStatus(p.status);
    setSelectedId(p.id);
    runDue(false);
  };

  const lead = (
    <span className="text-zinc-500" title={'증권사에 설정한 모으기를 적어 두면 장이 끝날 때마다 그날 종가로 회차를 기록합니다.\n주문을 넣지는 않으며, 금액·수량은 추정값이라 증권사 앱과 다르면 고칠 수 있습니다.'} aria-label="안내">
      <Info className="h-4 w-4" />
    </span>
  );

  return (
    <div>
      <PageActions lead={lead}>
        <button type="button" className="btn-primary !py-1.5" onClick={() => setForm({ plan: null })}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">모으기 추가</span>
        </button>
        <button type="button" className="btn-icon !h-9 !w-9" onClick={() => runDue(true)} disabled={refreshing} aria-label="새 회차 확인" title="장이 끝난 회차 확인">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </PageActions>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-rose-200">
          <span className="text-sm">{error}</span>
          <button type="button" className="btn-ghost !py-1 !text-xs" onClick={() => load(true)}>
            다시 시도
          </button>
        </div>
      )}
      {notice && <div className="mb-4 rounded-2xl border border-mint-400/30 bg-mint-400/10 px-4 py-2.5 text-sm text-mint-100">{notice}</div>}

      {loading ? (
        <div className="surface h-[calc(100vh_-_var(--app-header-h,56px)_-_3rem)] min-h-[520px] animate-pulse" />
      ) : plans && plans.length === 0 ? (
        <div className="surface px-6 py-16 text-center">
          <p className="text-sm text-zinc-200">아직 등록한 주식 모으기가 없습니다.</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
            증권사에서 매일 1,000원, 매주 $1처럼 설정한 모으기를 적어 두면, 장이 끝날 때마다 그날 종가로 산 수량을 매매 기록에 남깁니다. 지금까지 모은 것은 합계로 한 번에 적으면 됩니다.
          </p>
          <button type="button" className="btn-primary mt-5" onClick={() => setForm({ plan: null })}>
            <Plus className="h-4 w-4" />
            모으기 추가
          </button>
        </div>
      ) : plans ? (
        <SplitView
          onSplitChange={setSplit}
          showDetail={selected != null}
          onBack={() => setSelectedId(null)}
          listWidth={420}
          list={<PlanList plans={plans} status={status} onStatus={setStatus} counts={counts} selectedId={selectedId} onSelect={setSelectedId} />}
          detail={
            selected ? (
              <PlanDetail
                key={selected.id}
                plan={selected}
                onEdit={() => setForm({ plan: selected })}
                onChanged={(nextStatus) => {
                  // 중지·다시 시작한 계획은 옮겨 간 쪽 목록에서 계속 보여 준다 (선택이 풀리지 않게 상태를 먼저 같이 바꾼다)
                  if (nextStatus) {
                    const id = selected.id;
                    setPlans((ps) => ps?.map((p) => (p.id === id ? { ...p, status: nextStatus } : p)) ?? ps);
                    setStatus(nextStatus);
                  }
                  load(false);
                }}
                onDeleted={() => {
                  setSelectedId(null);
                  load(false);
                }}
              />
            ) : (
              <p className="py-16 text-center text-sm text-zinc-400">왼쪽 목록에서 모으기를 고르세요.</p>
            )
          }
        />
      ) : null}

      {form && <PlanForm plan={form.plan} onClose={() => setForm(null)} onSaved={onSaved} />}
    </div>
  );
}
