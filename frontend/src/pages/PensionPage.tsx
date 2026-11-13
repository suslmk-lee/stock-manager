import { useCallback, useEffect, useState } from 'react';
import { Info, Plus, RefreshCw } from 'lucide-react';
import { PageActions } from '../components/shell/PageSlots';
import { apiClient } from '../api/client';
import type { Account, ContributionPlanView } from '../types/models';
import PensionDetail from '../components/pension/PensionDetail';
import PensionForm from '../components/pension/PensionForm';
import { accountDisplayName } from '../utils/accountLabel';
import { fmtCcy } from '../utils/fx';

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '');

/** 퇴직연금 — 매달 들어오는 부담금을 정한 비율대로 사는 계좌(DC 등)를 적어 두고, 납입일마다 입금·매수를 기록한다 */
export default function PensionPage() {
  const [plans, setPlans] = useState<ContributionPlanView[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<{ plan: ContributionPlanView | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [p, a] = await Promise.all([apiClient.GetContributionPlans(), apiClient.GetAllAccounts()]);
      setPlans(p);
      setAccounts((a ?? []) as Account[]);
    } catch (e) {
      setError(`퇴직연금을 불러오지 못했습니다: ${errText(e)}`);
      setPlans((ps) => ps ?? []);
    }
  }, []);

  // 지난 납입일 회차를 채운 뒤 새로 생긴 게 있으면 다시 불러온다
  const runDue = useCallback(
    async (manual = false) => {
      setRefreshing(true);
      try {
        const r = await apiClient.RunContributions();
        if (r.rounds > 0) {
          setNotice(`새 회차 ${r.rounds}건(매수 ${r.buys}건)을 기록했습니다.`);
          await load();
        } else if (manual) {
          await load();
          setNotice(r.errors?.length ? `일부 시세를 가져오지 못했습니다: ${r.errors[0]}` : r.pending > 0 ? '납입일 종가가 아직 없어 다음에 기록합니다.' : '새로 기록할 회차가 없습니다.');
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
    load().then(() => runDue(false));
  }, [load, runDue]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const selected = plans?.find((p) => p.id === selectedId) ?? plans?.[0] ?? null;

  const lead = (
    <span className="text-zinc-500" title={'회사 퇴직연금(DC 등)처럼 매달 정해진 부담금이 들어와 정한 비율대로 상품을 사는 계좌를 적어 두면,\n납입일마다 입금과 상품별 매수를 기록합니다. 펀드는 은행 앱의 평가금액으로 가끔 맞춰 주세요.'} aria-label="안내">
      <Info className="h-4 w-4" />
    </span>
  );

  return (
    <div>
      <PageActions lead={lead}>
        <button type="button" className="btn-primary !py-1.5" onClick={() => setForm({ plan: null })}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">부담금 배분 추가</span>
        </button>
        <button type="button" className="btn-icon !h-9 !w-9" onClick={() => runDue(true)} disabled={refreshing} aria-label="새 회차 확인" title="지난 납입일 회차 확인">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </PageActions>

      {error && <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {notice && <div className="mb-4 rounded-2xl border border-mint-400/30 bg-mint-400/10 px-4 py-2.5 text-sm text-mint-100">{notice}</div>}

      {plans == null ? (
        <div className="surface h-80 animate-pulse" />
      ) : plans.length === 0 ? (
        <div className="surface px-6 py-16 text-center">
          <p className="text-sm text-zinc-200">아직 등록한 퇴직연금 부담금 배분이 없습니다.</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
            회사에서 매달 부담금을 넣어 주고 내가 고른 상품(ETF·펀드)을 정한 비율대로 사는 퇴직연금을 적어 두면, 납입일마다 입금과 매수를 기록해 자산 추이·통계에 함께 보여 줍니다.
          </p>
          <button type="button" className="btn-primary mt-5" onClick={() => setForm({ plan: null })}>
            <Plus className="h-4 w-4" />
            부담금 배분 추가
          </button>
        </div>
      ) : (
        <>
          {plans.length > 1 && (
            <div className="glass-pill mb-4 inline-flex flex-wrap p-0.5">
              {plans.map((p) => (
                <button key={p.id} type="button" onClick={() => setSelectedId(p.id)} className={`pill-item !px-3 !py-1 !text-xs ${selected?.id === p.id ? 'pill-item-active' : ''}`}>
                  {accountDisplayName(p.account, `계좌 ${p.account_id}`)} · {fmtCcy(p.amount, 'KRW')}
                </button>
              ))}
            </div>
          )}
          {selected && (
            <PensionDetail
              key={selected.id}
              plan={selected}
              onEdit={() => setForm({ plan: selected })}
              onNotice={setNotice}
              onChanged={(deleted) => {
                if (deleted) setSelectedId(null);
                load();
              }}
            />
          )}
        </>
      )}

      {form && (
        <PensionForm
          plan={form.plan}
          accounts={accounts}
          onClose={() => setForm(null)}
          onSaved={async (id) => {
            setForm(null);
            if (id) setSelectedId(id);
            await load();
            runDue(false);
          }}
        />
      )}
    </div>
  );
}
