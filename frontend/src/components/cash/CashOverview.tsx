import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Lock, Scale } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { Account, CashBalance, CashSummary } from '../../types/models';
import { isRestrictedAccount } from '../../utils/accountType';
import BrokerLogo from '../ui/BrokerLogo';
import CardIcon from '../ui/CardIcon';
import { IconWallet } from '../ui/appIcons';
import { CashForm, cashCurrencies, money } from './CashPanel';

/**
 * 예수금 한눈에 — 모든 계좌의 원화예수금·외화예수금을 모아 합계·출금 가능 금액과 계좌별 상태를 보여 준다.
 * 계좌마다 바로 '잔액 맞추기'를 할 수 있고, 계좌 이름을 누르면 그 계좌 화면으로 간다.
 */

const SETTLE_LABEL: Record<string, string> = { USD: '원화·외화 따로', AFX: '자동 환전', KRW: '원화 하나' };
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '불러오지 못했습니다.');
const shortDay = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const EMPTY = (id: number): CashBalance => ({ account_id: id, krw: 0, usd: 0, total_krw: 0, withdrawable_krw: 0, withdrawable_usd: 0, flow_count: 0 });

interface Row {
  account: Account;
  b: CashBalance;
}

function Tile({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="label-mono">{label}</p>
      <p className={`num mt-0.5 truncate text-xl ${accent ? 'font-semibold text-mint-300' : 'font-light text-white'}`}>{value}</p>
      {sub && <p className="num truncate text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export default function CashOverview({ accounts, onOpenAccount }: { accounts: Account[]; onOpenAccount: (id: number) => void }) {
  const [data, setData] = useState<{ balances: CashBalance[]; usd_krw: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recon, setRecon] = useState<{ account: Account; summary: CashSummary } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await apiClient.GetCashBalances());
    } catch (e) {
      setError(`예수금을 불러오지 못했습니다: ${errText(e)}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const fx = data?.usd_krw ?? 0;
  const { active, empty } = useMemo(() => {
    const byId = new Map((data?.balances ?? []).map((b) => [b.account_id, b]));
    const rows: Row[] = accounts.map((a) => ({ account: a, b: byId.get(a.id) ?? EMPTY(a.id) }));
    const used = (r: Row) => r.b.flow_count > 0 || r.b.krw !== 0 || r.b.usd !== 0;
    return {
      active: rows.filter(used).sort((x, y) => y.b.total_krw - x.b.total_krw),
      empty: rows.filter((r) => !used(r)),
    };
  }, [data, accounts]);

  const totals = useMemo(() => {
    const t = { krw: 0, usd: 0, total: 0, withdraw: 0, restricted: 0 };
    for (const { account, b } of active) {
      t.krw += b.krw;
      t.usd += b.usd;
      t.total += b.total_krw;
      t.withdraw += b.withdrawable_krw + b.withdrawable_usd * fx;
      if (isRestrictedAccount(account)) t.restricted += b.total_krw;
    }
    return t;
  }, [active, fx]);
  const unadjusted = active.filter((r) => !r.b.last_adjusted).length;
  const negative = active.filter((r) => r.b.krw < -0.5 || r.b.usd < -0.005).length;

  const openReconcile = async (account: Account) => {
    setBusyId(account.id);
    try {
      setRecon({ account, summary: await apiClient.GetAccountCash(account.id) });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusyId(null);
    }
  };

  const reconButton = (account: Account) => (
    <button
      type="button"
      className="btn-ghost shrink-0 !px-2.5 !py-1 !text-xs"
      onClick={(e) => {
        e.stopPropagation();
        openReconcile(account);
      }}
      disabled={busyId === account.id}
      title="증권사 앱의 예수금으로 맞추기"
    >
      <Scale className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">맞추기</span>
    </button>
  );

  const accountCell = (account: Account) => (
    <button type="button" onClick={() => onOpenAccount(account.id)} className="flex min-w-0 items-center gap-2.5 text-left hover:opacity-90" title="계좌 화면으로">
      <BrokerLogo broker={account.broker} className="h-7 w-16 shrink-0" />
      <span className="min-w-0">
        <span className="flex items-center gap-1 truncate text-[13px] text-zinc-100">
          {isRestrictedAccount(account) && <Lock className="h-3 w-3 shrink-0 text-amber-300" />}
          <span className="truncate">{account.name}</span>
        </span>
        <span className="label-mono block truncate">{SETTLE_LABEL[account.foreign_settle ?? 'USD'] ?? ''}</span>
      </span>
    </button>
  );

  return (
    <div>
      <div className="mb-5 flex items-start gap-3">
        <CardIcon icon={IconWallet} size="sm" />
        <div className="min-w-0">
          <h2 className="section-title text-lg">예수금 한눈에</h2>
          <p className="mt-0.5 text-xs text-zinc-500">모든 계좌의 원화예수금·외화예수금 · 달러는 현재 환율{fx > 0 ? ` ${fx.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}원` : ''}로 환산</p>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
      {notice && <p className="mb-3 rounded-lg border border-mint-400/30 bg-mint-400/10 px-3 py-2 text-xs text-mint-200">{notice}</p>}

      {!data ? (
        <div className="h-40 animate-pulse rounded-xl bg-white/[0.03]" />
      ) : (
        <>
          <section className="surface-inset grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
            <Tile label="예수금 합계" value={money(totals.total, 'KRW')} sub={totals.restricted !== 0 ? `인출 제한 계좌 ${money(totals.restricted, 'KRW')} 포함` : `${active.length}개 계좌`} accent />
            <Tile label="원화예수금" value={money(totals.krw, 'KRW')} />
            <Tile label="외화예수금 (USD)" value={money(totals.usd, 'USD')} sub={fx > 0 ? `≈ ${money(totals.usd * fx, 'KRW')}` : undefined} />
            <Tile label="출금 가능" value={money(totals.withdraw, 'KRW')} sub="결제 전 매도 대금 제외" />
          </section>

          {(unadjusted > 0 || negative > 0) && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {[unadjusted > 0 && `잔액을 맞추지 않은 계좌 ${unadjusted}개`, negative > 0 && `마이너스 계좌 ${negative}개`].filter(Boolean).join(' · ')} — 합계가 실제와 다를 수 있습니다. 계좌마다 '맞추기'로 증권사 앱의 예수금을 넣어 주세요.
            </p>
          )}

          <div className="mt-5">
            <p className="label-mono mb-1.5">계좌별 · 큰 순서</p>
            {active.length === 0 ? (
              <p className="py-8 text-center text-xs text-zinc-500">아직 예수금 기록이 있는 계좌가 없습니다. 계좌마다 '맞추기'로 시작하세요.</p>
            ) : (
              <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
                <div className="hidden grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))_8.5rem] gap-3 bg-white/[0.02] px-3 py-2 md:grid">
                  {['계좌', '원화예수금', '외화예수금', '합계 (원화)', '출금 가능', '잔액 맞춤'].map((h, i) => (
                    <span key={h} className={`label-mono ${i > 0 && i < 5 ? 'text-right' : ''}`}>
                      {h}
                    </span>
                  ))}
                </div>
                {active.map(({ account, b }) => {
                  const ccys = cashCurrencies(account, b, b.usd !== 0, b.krw !== 0);
                  const negKRW = b.krw < -0.5;
                  const negUSD = b.usd < -0.005;
                  const withdraw = b.withdrawable_krw + b.withdrawable_usd * fx;
                  return (
                    <div key={account.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 md:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))_8.5rem]">
                      <div className="min-w-0">
                        {accountCell(account)}
                        {/* 좁은 화면: 원화·외화를 계좌 아래에 */}
                        <p className="num mt-1 truncate text-[11px] text-zinc-400 md:hidden">
                          {[ccys.includes('KRW') && money(b.krw, 'KRW'), ccys.includes('USD') && money(b.usd, 'USD')].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className={`num hidden text-right text-[13px] md:block ${negKRW ? 'text-rose-300' : ccys.includes('KRW') ? 'text-zinc-200' : 'text-zinc-600'}`}>
                        {ccys.includes('KRW') ? money(b.krw, 'KRW') : '—'}
                      </span>
                      <span className={`num hidden text-right text-[13px] md:block ${negUSD ? 'text-rose-300' : ccys.includes('USD') ? 'text-zinc-200' : 'text-zinc-600'}`}>
                        {ccys.includes('USD') ? money(b.usd, 'USD') : '—'}
                      </span>
                      <span className="num hidden text-right text-[13px] font-medium text-white md:block">{money(b.total_krw, 'KRW')}</span>
                      <span className="num hidden text-right text-[13px] text-zinc-300 md:block">{money(withdraw, 'KRW')}</span>
                      <div className="flex items-center justify-end gap-2">
                        <span className="num text-right text-sm font-medium text-white md:hidden">{money(b.total_krw, 'KRW')}</span>
                        <span className={`hidden text-[11px] md:inline ${b.last_adjusted ? 'label-mono' : 'text-amber-300'}`}>{b.last_adjusted ? shortDay(b.last_adjusted) : '맞추지 않음'}</span>
                        {reconButton(account)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {empty.length > 0 && (
            <div className="mt-4">
              <button type="button" onClick={() => setShowEmpty((v) => !v)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white">
                {showEmpty ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                예수금 기록이 없는 계좌 {empty.length}개
              </button>
              {showEmpty && (
                <div className="mt-2 divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
                  {empty.map(({ account }) => (
                    <div key={account.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      {accountCell(account)}
                      {reconButton(account)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {recon && (
        <CashForm
          mode="reconcile"
          account={recon.account}
          summary={recon.summary}
          currencies={cashCurrencies(recon.account, recon.summary)}
          onClose={() => setRecon(null)}
          onSaved={(msg) => {
            setRecon(null);
            setNotice(`${recon.account.name}: ${msg}`);
            load();
          }}
        />
      )}
    </div>
  );
}
