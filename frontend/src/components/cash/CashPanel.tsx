import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeftRight, Scale, Trash2, Wallet, X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { Account, CashFlow, CashFlowKind, CashSummary } from '../../types/models';
import CardIcon from '../ui/CardIcon';
import DatePicker from '../ui/DatePicker';
import Portal from '../ui/Portal';
import { IconWallet } from '../ui/appIcons';

/**
 * 계좌 예수금 — 원화·달러 잔액, 계좌 총액(주식 평가금 + 예수금), 현금 흐름(입출금·매매·배당).
 * 입금·출금·이자, 환전, 잔액 맞추기(증권사 앱의 예수금에 맞춤)를 여기서 기록한다.
 */
type Ccy = 'KRW' | 'USD';
type Mode = 'flow' | 'exchange' | 'reconcile';

const money = (v: number, ccy: Ccy | string) => {
  const neg = ccy === 'KRW' ? Math.round(v) < 0 : v <= -0.005;
  const a = Math.abs(v);
  const body = ccy === 'KRW' ? `₩${Math.round(a).toLocaleString('ko-KR')}` : `$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return neg ? `−${body}` : body;
};
const signed = (v: number, ccy: Ccy | string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v), ccy)}`;
const shortDay = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const today = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '처리하지 못했습니다.');
const num = (s: string) => Number(s.replace(/,/g, ''));

const KIND: Record<CashFlowKind, { label: string; cls: string }> = {
  deposit: { label: '입금', cls: 'bg-mint-400/15 text-mint-300' },
  withdraw: { label: '출금', cls: 'bg-rose-500/10 text-rose-300' },
  interest: { label: '이자', cls: 'bg-mint-400/15 text-mint-300' },
  exchange: { label: '환전', cls: 'border border-white/10 bg-white/[0.05] text-zinc-300' },
  adjust: { label: '맞춤', cls: 'border border-white/10 bg-white/[0.05] text-zinc-300' },
  buy: { label: '매수', cls: 'bg-mint-400/10 text-zinc-300' },
  sell: { label: '매도', cls: 'bg-rose-500/10 text-zinc-300' },
  dividend: { label: '배당', cls: 'bg-mint-400/15 text-mint-300' },
};

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="glass-pill inline-flex p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value} className={`pill-item !px-3 !py-1 text-sm ${value === o.value ? 'pill-item-active' : ''}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-zinc-300">{label}</p>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-zinc-500">{hint}</p>}
    </div>
  );
}

// ───────────────────────── 입력 창 ─────────────────────────

function CashForm({ mode, account, summary, onClose, onSaved }: { mode: Mode; account: Account; summary: CashSummary; onClose: () => void; onSaved: (msg: string) => void }) {
  const defaultCcy: Ccy = account.market_type === 'Domestic' || account.foreign_settle === 'KRW' ? 'KRW' : 'USD';
  const [kind, setKind] = useState<'deposit' | 'withdraw' | 'interest'>('deposit');
  const [ccy, setCcy] = useState<Ccy>(defaultCcy);
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [from, setFrom] = useState<Ccy>('KRW');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = ccy === 'KRW' ? summary.krw : summary.usd;
  const to: Ccy = from === 'KRW' ? 'USD' : 'KRW';
  const a = num(amount);
  const b = num(toAmount);
  const rate = a > 0 && b > 0 ? (from === 'KRW' ? a / b : b / a) : 0;

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'flow') {
        if (!(a > 0)) throw new Error('금액을 입력하세요.');
        await apiClient.CreateCashEntry(account.id, { currency: ccy, date, kind, amount: a, notes });
        onSaved(`${kind === 'deposit' ? '입금' : kind === 'withdraw' ? '출금' : '이자'} ${money(a, ccy)}을 기록했습니다.`);
      } else if (mode === 'exchange') {
        if (!(a > 0) || !(b > 0)) throw new Error('내준 금액과 받은 금액을 모두 입력하세요.');
        await apiClient.CreateCashExchange(account.id, { date, from_currency: from, from_amount: a, to_amount: b, notes });
        onSaved(`환전 ${money(a, from)} → ${money(b, to)}을 기록했습니다.`);
      } else {
        if (amount.trim() === '' || !Number.isFinite(a)) throw new Error('증권사 앱에 보이는 예수금을 입력하세요.');
        const r = await apiClient.ReconcileCash(account.id, { currency: ccy, balance: a, date });
        onSaved(r.entry ? `${ccy === 'KRW' ? '원화' : '달러'} 예수금을 ${money(a, ccy)}에 맞췄습니다.` : '이미 증권사 잔액과 같습니다.');
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'flow' ? '입금 · 출금' : mode === 'exchange' ? '환전' : '잔액 맞추기';
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[92vh] w-full max-w-md flex-col" role="dialog" aria-modal="true" aria-label={title}>
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div>
              <h3 className="section-title">{title}</h3>
              <p className="mt-0.5 text-xs text-zinc-500">{account.name}</p>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {mode === 'flow' && (
              <Field label="종류">
                <Seg label="종류" value={kind} onChange={setKind} options={[{ value: 'deposit', label: '입금' }, { value: 'withdraw', label: '출금' }, { value: 'interest', label: '이자' }]} />
              </Field>
            )}
            {mode !== 'exchange' ? (
              <>
                <Field label="통화">
                  <Seg label="통화" value={ccy} onChange={setCcy} options={[{ value: 'KRW', label: '원화' }, { value: 'USD', label: '달러' }]} />
                </Field>
                <Field
                  label={mode === 'reconcile' ? '증권사 앱에 보이는 예수금' : '금액'}
                  hint={
                    mode === 'reconcile'
                      ? `지금 계산된 ${ccy === 'KRW' ? '원화' : '달러'} 예수금은 ${money(current, ccy)}입니다. ${amount.trim() !== '' && Number.isFinite(a) ? `차이 ${signed(a - current, ccy)}를 '잔액 맞추기'로 남깁니다.` : ''}`
                      : undefined
                  }
                >
                  <input inputMode="decimal" className="input-field num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={ccy === 'KRW' ? '100000' : '100.00'} autoFocus />
                </Field>
              </>
            ) : (
              <>
                <Field label="방향">
                  <Seg label="환전 방향" value={from} onChange={setFrom} options={[{ value: 'KRW', label: '원화 → 달러' }, { value: 'USD', label: '달러 → 원화' }]} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`내준 금액 (${from === 'KRW' ? '원' : '$'})`}>
                    <input inputMode="decimal" className="input-field num" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
                  </Field>
                  <Field label={`받은 금액 (${to === 'KRW' ? '원' : '$'})`}>
                    <input inputMode="decimal" className="input-field num" value={toAmount} onChange={(e) => setToAmount(e.target.value)} />
                  </Field>
                </div>
                {rate > 0 && <p className="num text-xs text-zinc-400">적용 환율 {rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원 / $1</p>}
              </>
            )}
            <Field label="날짜" hint={mode === 'reconcile' ? '그날 장이 끝난 뒤의 잔액으로 봅니다.' : undefined}>
              <DatePicker value={date} onChange={setDate} ariaLabel="날짜" />
            </Field>
            {mode !== 'reconcile' && (
              <Field label="메모">
                <input className="input-field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="선택" maxLength={200} />
              </Field>
            )}
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
            <button type="button" className="btn-ghost" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>
              {busy ? '저장 중…' : mode === 'reconcile' ? '맞추기' : '기록'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ───────────────────────── 패널 ─────────────────────────

const SHOW = 15;

export default function CashPanel({ account }: { account: Account }) {
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [limit, setLimit] = useState(SHOW);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSummary(await apiClient.GetAccountCash(account.id));
    } catch (e) {
      setError(`예수금을 불러오지 못했습니다: ${errText(e)}`);
    }
  }, [account.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const remove = async (f: CashFlow) => {
    if (f.entry_id == null) return;
    const what = f.kind === 'exchange' ? '이 환전(원화·달러 두 줄 모두)' : `이 ${KIND[f.kind].label} 기록`;
    if (!window.confirm(`${what}을 지울까요?`)) return;
    try {
      await apiClient.DeleteCashEntry(f.entry_id);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  // 원화·달러 중 보여 줄 통화: 쓰고 있거나 계좌 성격상 쓰는 통화
  const showUSD = !!summary && (summary.usd !== 0 || (account.market_type === 'International' && account.foreign_settle !== 'KRW') || summary.flows.some((f) => f.currency === 'USD'));
  const showKRW = !!summary && (summary.krw !== 0 || !showUSD || summary.flows.some((f) => f.currency === 'KRW'));
  const negative = !!summary && (summary.krw < -0.5 || summary.usd < -0.005);
  const neverAdjusted = !!summary && !summary.last_adjusted && summary.flows.some((f) => f.kind === 'buy' || f.kind === 'sell');
  const flows = useMemo(() => summary?.flows ?? [], [summary]);

  return (
    <section className="surface-inset mb-5 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CardIcon icon={IconWallet} size="sm" />
          <p className="section-title">예수금</p>
          {summary?.last_adjusted && <span className="label-mono">{shortDay(summary.last_adjusted)} 잔액 맞춤</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setMode('flow')}>
            <Wallet className="h-3.5 w-3.5" />
            입금 · 출금
          </button>
          <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setMode('exchange')}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
            환전
          </button>
          <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setMode('reconcile')}>
            <Scale className="h-3.5 w-3.5" />
            잔액 맞추기
          </button>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
      {notice && <p className="mb-3 rounded-lg border border-mint-400/30 bg-mint-400/10 px-3 py-2 text-xs text-mint-200">{notice}</p>}

      {!summary ? (
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
      ) : (
        <>
          {/* 잔액 · 계좌 총액 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {showKRW && (
              <div>
                <p className="label-mono">원화 예수금</p>
                <p className={`num mt-0.5 text-xl font-light ${summary.krw < -0.5 ? 'text-rose-300' : 'text-white'}`}>{money(summary.krw, 'KRW')}</p>
              </div>
            )}
            {showUSD && (
              <div>
                <p className="label-mono">달러 예수금</p>
                <p className={`num mt-0.5 text-xl font-light ${summary.usd < -0.005 ? 'text-rose-300' : 'text-white'}`}>{money(summary.usd, 'USD')}</p>
                {summary.usd_krw > 0 && <p className="num text-[11px] text-zinc-500">≈ {money(summary.usd * summary.usd_krw, 'KRW')}</p>}
              </div>
            )}
            <div>
              <p className="label-mono">주식 평가금</p>
              <p className="num mt-0.5 text-xl font-light text-zinc-200">{summary.stock_value_krw != null ? money(summary.stock_value_krw, 'KRW') : '—'}</p>
            </div>
            <div>
              <p className="label-mono">계좌 총액</p>
              <p className="num mt-0.5 text-xl font-semibold text-mint-300">{summary.account_total_krw != null ? money(summary.account_total_krw, 'KRW') : '—'}</p>
              <p className="text-[11px] text-zinc-500">평가금 + 예수금</p>
            </div>
          </div>

          {(negative || neverAdjusted) && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {neverAdjusted
                ? "지금 잔액은 기록된 매매·배당만으로 계산한 값이라 실제와 다릅니다. 처음 한 번 '잔액 맞추기'로 증권사 앱의 예수금을 넣어 주세요."
                : "계산된 예수금이 마이너스입니다. 빠진 입금이 있거나 잔액이 어긋났습니다 — '입금 · 출금'으로 채우거나 '잔액 맞추기'로 맞춰 주세요."}
            </p>
          )}

          {/* 현금 흐름 */}
          <div className="mt-5">
            <p className="label-mono mb-1.5">현금 흐름 · 최근 것부터</p>
            {flows.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-500">아직 현금 흐름이 없습니다. 입금이나 잔액 맞추기부터 기록해 보세요.</p>
            ) : (
              <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
                {flows.slice(0, limit).map((f, i) => (
                  <div key={`${f.kind}-${f.entry_id ?? f.transaction_id ?? i}-${i}`} className="group flex items-center gap-3 px-3 py-2">
                    <span className="num w-11 shrink-0 text-[12px] text-zinc-500">{shortDay(f.date)}</span>
                    <span className={`badge shrink-0 !py-0 text-[11px] ${KIND[f.kind].cls}`}>{KIND[f.kind].label}</span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="truncate text-[13px] text-zinc-100">{f.label}</span>
                      <span className="truncate text-[11px] text-zinc-500">
                        {[f.detail, f.plan_fill ? '모으기' : '', f.fx ? `환율 ${Math.round(f.fx).toLocaleString('ko-KR')}` : '', f.notes].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={`num shrink-0 text-[13px] font-medium ${f.amount >= 0 ? 'text-mint-300' : 'text-rose-300'}`}>{signed(f.amount, f.currency)}</span>
                    <span className="num hidden w-24 shrink-0 text-right text-[11px] text-zinc-500 sm:block">{money(f.balance, f.currency)}</span>
                    {f.entry_id != null ? (
                      <button type="button" onClick={() => remove(f)} className="btn-icon !h-6 !w-6 shrink-0 opacity-0 transition-opacity hover:!text-rose-300 group-hover:opacity-100" aria-label="기록 지우기">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : (
                      <span className="w-6 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
            {flows.length > limit && (
              <button type="button" onClick={() => setLimit((l) => l + 50)} className="mt-2 text-xs text-mint-300 hover:underline">
                {flows.length - limit}건 더 보기
              </button>
            )}
          </div>
        </>
      )}

      {mode && summary && (
        <CashForm
          mode={mode}
          account={account}
          summary={summary}
          onClose={() => setMode(null)}
          onSaved={(msg) => {
            setMode(null);
            setNotice(msg);
            load();
          }}
        />
      )}
    </section>
  );
}
