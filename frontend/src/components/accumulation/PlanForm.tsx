import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import Portal from '../ui/Portal';
import Switch from '../ui/Switch';
import DatePicker from '../ui/DatePicker';
import { apiClient } from '../../api/client';
import type { Account, AccumulationPlanRequest, AccumulationPlanView, Asset, Holding, PlanCondition, PlanCurrency, PlanSchedule } from '../../types/models';
import {
  QTY_STEPS,
  accountLabel,
  assetTitle,
  WEEKDAY_LABELS,
  currencyOfTicker,
  defaultAutoFrom,
  defaultQtyStep,
  floorQty,
  fmtAmount,
  fmtDay,
  fmtPrice,
  fmtQty,
  isKRTicker,
  kstDate,
  ruleText,
} from './planText';

interface PlanFormProps {
  /** 없으면 새로 추가 */
  plan?: AccumulationPlanView | null;
  onClose: () => void;
  onSaved: (plan: AccumulationPlanView) => void;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : typeof err === 'string' ? err : '저장하지 못했습니다.');

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="glass-pill inline-flex p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value} className={`pill-item !px-3 !py-1 ${value === o.value ? 'pill-item-active' : ''}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-zinc-300">{label}</p>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-zinc-500">{hint}</p>}
    </div>
  );
}

const numOr = (s: string, fallback = 0) => {
  const v = Number(s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : fallback;
};

/** 주식 모으기 추가·수정 */
export default function PlanForm({ plan, onClose, onSaved }: PlanFormProps) {
  const editing = !!plan;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [quote, setQuote] = useState<{ ticker: string; price: number } | null>(null);
  const [fx, setFx] = useState<number | null>(null);

  const [accountId, setAccountId] = useState<number>(plan?.account_id ?? 0);
  const [assetId, setAssetId] = useState<number>(plan?.asset_id ?? 0);
  const [assetQuery, setAssetQuery] = useState('');
  const [amount, setAmount] = useState(plan ? String(plan.amount) : '1000');
  const [currency, setCurrency] = useState<PlanCurrency>(plan?.amount_currency ?? 'KRW');
  const [step, setStep] = useState<number>(plan?.qty_step ?? 0.000001);
  const [stepTouched, setStepTouched] = useState(editing);
  const [schedule, setSchedule] = useState<PlanSchedule>(plan?.schedule ?? 'daily');
  const [weekdays, setWeekdays] = useState<number>(plan?.weekdays || 1 << 1);
  const [monthDay, setMonthDay] = useState<number>(plan?.month_day || 1);
  const [condition, setCondition] = useState<PlanCondition>(plan?.condition ?? 'always');
  const [condValue, setCondValue] = useState(plan && plan.condition !== 'always' ? String(plan.condition_value) : '');
  const [openingRounds, setOpeningRounds] = useState(plan ? String(plan.opening_rounds || '') : '');
  const [openingAmount, setOpeningAmount] = useState(plan ? String(plan.opening_amount || '') : '');
  const [openingQty, setOpeningQty] = useState(plan ? String(plan.opening_quantity || '') : '');
  const [startedOn, setStartedOn] = useState(plan?.started_on ?? '');
  const [autoFrom, setAutoFrom] = useState(plan?.auto_from ?? '');
  const [autoFromTouched, setAutoFromTouched] = useState(editing);
  const [addToHoldings, setAddToHoldings] = useState(true);
  const [addTouched, setAddTouched] = useState(false);
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    Promise.all([apiClient.GetAllAccounts(), apiClient.GetAllAssets()])
      .then(([acc, as]) => {
        setAccounts((acc ?? []) as Account[]);
        setAssets(((as ?? []) as Asset[]).slice().sort((a, b) => a.name.localeCompare(b.name, 'ko')));
      })
      .catch((e) => setError(`계좌·종목을 불러오지 못했습니다: ${errText(e)}`));
  }, [editing]);

  const account = editing ? plan?.account : accounts.find((a) => a.id === accountId);
  const asset = editing ? plan?.asset : assets.find((a) => a.id === assetId);
  const ticker = asset?.ticker ?? '';
  const assetCcy: PlanCurrency = ticker ? currencyOfTicker(ticker) : 'USD';

  // 계좌·종목을 고르면 수량 단위 기본값 (직접 바꾸기 전까지)
  useEffect(() => {
    if (editing || !account) return;
    if (!stepTouched) setStep(defaultQtyStep(account, ticker));
  }, [editing, account, ticker, stepTouched]);

  // 이 계좌의 보유 (지금까지 모은 것을 보유에 더할지 기본값)
  useEffect(() => {
    if (editing || !accountId) return;
    apiClient
      .GetHoldingsByAccount(accountId)
      .then((h) => setHoldings((h ?? []) as unknown as Holding[]))
      .catch(() => setHoldings([]));
  }, [editing, accountId]);
  const heldQty = holdings.find((h) => h.asset_id === assetId)?.quantity ?? 0;
  useEffect(() => {
    if (!editing && !addTouched) setAddToHoldings(heldQty <= 0);
  }, [editing, addTouched, heldQty]);

  useEffect(() => {
    if (!editing && ticker && !autoFromTouched) setAutoFrom(defaultAutoFrom(ticker));
  }, [editing, ticker, autoFromTouched]);

  // 미리보기용 현재가·환율
  useEffect(() => {
    if (!ticker) return;
    let alive = true;
    apiClient
      .GetCurrentPrice(ticker)
      .then((q: any) => alive && q?.price > 0 && setQuote({ ticker, price: q.price }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ticker]);
  useEffect(() => {
    if (currency === assetCcy || fx) return;
    apiClient
      .GetUSDToKRW()
      .then((v: any) => typeof v === 'number' && v > 0 && setFx(v))
      .catch(() => undefined);
  }, [currency, assetCcy, fx]);

  const amountNum = numOr(amount);
  const preview = useMemo(() => {
    const price = quote && quote.ticker === ticker ? quote.price : plan?.current_price || 0;
    if (!price || amountNum <= 0) return null;
    let inAsset = amountNum;
    if (currency !== assetCcy) {
      if (!fx) return null;
      inAsset = currency === 'KRW' ? amountNum / fx : amountNum * fx;
    }
    const qty = floorQty(inAsset, price, step);
    const spent = qty * price;
    const spentInPlan = currency === assetCcy ? spent : currency === 'KRW' ? spent * (fx ?? 0) : spent / (fx ?? 1);
    return { price, qty, spentInPlan };
  }, [quote, ticker, plan, amountNum, currency, assetCcy, fx, step]);

  const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => a.name.toLowerCase().includes(q) || a.ticker.toLowerCase().includes(q) || a.id === assetId);
  }, [assets, assetQuery, assetId]);

  const toggleWeekday = (i: number) => setWeekdays((w) => w ^ (1 << i));

  const save = async () => {
    setError(null);
    if (!editing && (!accountId || !assetId)) return setError('계좌와 종목을 고르세요.');
    if (amountNum <= 0) return setError('한 번에 살 금액을 입력하세요.');
    if (schedule === 'weekly' && (weekdays & 0x7f) === 0) return setError('매주 살 요일을 고르세요.');
    if (condition !== 'always' && condValue.trim() === '') return setError(condition === 'return_below' ? '수익률 기준을 입력하세요.' : '주가 기준을 입력하세요.');
    if (condition === 'price_below' && numOr(condValue) <= 0) return setError('주가 기준은 0보다 커야 합니다.');
    const oAmount = numOr(openingAmount);
    const oQty = numOr(openingQty);
    if (!editing && addToHoldings && (oAmount > 0 || oQty > 0) && (oAmount <= 0 || oQty <= 0)) {
      return setError('보유에 더하려면 지금까지 모은 금액과 수량을 모두 입력하세요.');
    }
    const req: AccumulationPlanRequest = {
      account_id: editing ? plan!.account_id : accountId,
      asset_id: editing ? plan!.asset_id : assetId,
      amount: amountNum,
      amount_currency: currency,
      qty_step: step,
      schedule,
      weekdays: schedule === 'weekly' ? weekdays : 0,
      month_day: schedule === 'monthly' ? monthDay : 0,
      condition,
      condition_value: condition === 'always' ? 0 : numOr(condValue),
      status: plan?.status ?? 'active',
      started_on: startedOn,
      auto_from: autoFrom,
      opening_rounds: Math.max(0, Math.round(numOr(openingRounds))),
      opening_amount: oAmount,
      opening_quantity: oQty,
      add_opening_to_holdings: !editing && addToHoldings && oAmount > 0 && oQty > 0,
      notes,
    };
    setSaving(true);
    try {
      const saved = editing ? await apiClient.UpdateAccumulationPlan(plan!.id, req) : await apiClient.CreateAccumulationPlan(req);
      onSaved(saved);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const ruleRule = {
    schedule,
    weekdays,
    month_day: monthDay,
    condition,
    condition_value: numOr(condValue),
    amount: amountNum,
    amount_currency: currency,
  };

  return (
    <Portal>
      {/* 입력 중인 값을 잃지 않도록 바깥을 눌러도 닫지 않는다 — 닫기(X)·취소로만 닫는다 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[92vh] w-full max-w-xl flex-col" role="dialog" aria-modal="true" aria-label={editing ? '주식 모으기 수정' : '주식 모으기 추가'}>
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div className="min-w-0">
              <h3 className="section-title">{editing ? '주식 모으기 수정' : '주식 모으기 추가'}</h3>
              <p className="mt-0.5 text-xs text-zinc-500">증권사에 설정한 모으기를 그대로 적어 두면, 장이 끝날 때마다 앱이 회차를 기록합니다.</p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* 계좌·종목 */}
            {editing ? (
              <div className="surface-inset flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-sm">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className={`shrink-0 text-white ${assetTitle(asset).tickerFirst ? 'font-semibold' : ''}`}>{assetTitle(asset).primary}</span>
                  <span className="truncate text-xs text-zinc-500">{assetTitle(asset).secondary}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-500">{accountLabel(account)}</span>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="계좌">
                  <select className="input-field" value={accountId || ''} onChange={(e) => setAccountId(Number(e.target.value))} aria-label="계좌">
                    <option value="">계좌 선택</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.broker ? ` · ${a.broker}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="종목">
                  <input type="search" className="input-field !py-1.5 text-sm" placeholder="이름·티커로 찾기" value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} aria-label="종목 찾기" />
                  <select className="input-field" value={assetId || ''} onChange={(e) => setAssetId(Number(e.target.value))} aria-label="종목">
                    <option value="">종목 선택 ({filteredAssets.length})</option>
                    {filteredAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.ticker})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            {/* 금액·주기 */}
            <Field label="한 번에 살 금액">
              <div className="flex gap-2">
                <input inputMode="decimal" className="input-field num flex-1" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="금액" />
                <Segmented
                  label="금액 통화"
                  value={currency}
                  onChange={setCurrency}
                  options={[
                    { value: 'KRW', label: '원' },
                    { value: 'USD', label: '달러' },
                  ]}
                />
              </div>
            </Field>

            <Field label="주기" hint={schedule !== 'daily' ? '그날이 휴장이면 그 회차는 건너뜁니다.' : '장이 열린 날마다 기록합니다.'}>
              <Segmented
                label="주기"
                value={schedule}
                onChange={setSchedule}
                options={[
                  { value: 'daily', label: '매일' },
                  { value: 'weekly', label: '매주' },
                  { value: 'monthly', label: '매월' },
                ]}
              />
              {schedule === 'weekly' && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {WEEKDAY_LABELS.map((d, i) =>
                    i === 0 || i === 6 ? null : (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleWeekday(i)}
                        aria-pressed={((weekdays >> i) & 1) === 1}
                        className={`h-8 w-9 rounded-lg border text-sm transition-colors ${((weekdays >> i) & 1) === 1 ? 'border-mint-400/50 bg-mint-400/15 text-white' : 'border-white/10 text-zinc-400 hover:text-zinc-200'}`}
                      >
                        {d}
                      </button>
                    ),
                  )}
                </div>
              )}
              {schedule === 'monthly' && (
                <select className="input-field !w-auto" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))} aria-label="매월 날짜">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}일{d >= 29 ? ' (없는 달은 말일)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              label="조건"
              hint={
                condition === 'return_below'
                  ? '이 계좌 보유의 평균 단가와 그날 종가로 판단합니다 (종목 통화 기준). 증권사와 판단 시점이 달라 기준선 근처에서는 하루씩 엇갈릴 수 있습니다.'
                  : condition === 'price_below'
                    ? `그날 종가가 이 값 이하일 때만 삽니다 (${assetCcy === 'KRW' ? '원' : '달러'}).`
                    : undefined
              }
            >
              <Segmented
                label="조건"
                value={condition}
                onChange={setCondition}
                options={[
                  { value: 'always', label: '항상' },
                  { value: 'return_below', label: '수익률 이하일 때' },
                  { value: 'price_below', label: '주가 이하일 때' },
                ]}
              />
              {condition !== 'always' && (
                <div className="flex items-center gap-2 pt-1">
                  <input inputMode="decimal" className="input-field num !w-32" value={condValue} onChange={(e) => setCondValue(e.target.value)} placeholder={condition === 'return_below' ? '-5' : assetCcy === 'KRW' ? '50000' : '30'} aria-label="조건 기준" />
                  <span className="text-sm text-zinc-400">{condition === 'return_below' ? '% 이하' : `${assetCcy === 'KRW' ? '원' : '달러'} 이하`}</span>
                </div>
              )}
            </Field>

            <Field label="수량 단위" hint={QTY_STEPS.find((s) => s.value === step)?.hint}>
              <Segmented
                label="수량 단위"
                value={String(step)}
                onChange={(v) => {
                  setStep(Number(v));
                  setStepTouched(true);
                }}
                options={QTY_STEPS.map((s) => ({ value: String(s.value), label: s.label }))}
              />
              {preview && (
                <p className="num pt-1 text-xs text-zinc-300">
                  지금 가격 {fmtPrice(preview.price, assetCcy)}이면 {preview.qty > 0 ? `${fmtQty(preview.qty)} · ${fmtAmount(preview.spentInPlan, currency)}` : '최소 단위보다 금액이 작아 못 삽니다'}
                </p>
              )}
            </Field>

            {/* 지금까지 모은 것 */}
            <div className="surface-inset space-y-3 rounded-xl p-3.5">
              <div>
                <p className="text-xs font-medium text-zinc-200">지금까지 모은 것</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">증권사 앱에 보이는 누적 값을 그대로 적으세요. 회차를 하나씩 채우지 않고 합계로 기록합니다.</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="label-mono">회차</span>
                  <input inputMode="numeric" className="input-field num !px-2.5" value={openingRounds} onChange={(e) => setOpeningRounds(e.target.value)} placeholder="22" />
                </label>
                <label className="space-y-1">
                  <span className="label-mono">투자 금액 ({currency === 'KRW' ? '원' : '$'})</span>
                  <input inputMode="decimal" className="input-field num !px-2.5" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} placeholder={currency === 'KRW' ? '21343' : '15'} />
                </label>
                <label className="space-y-1">
                  <span className="label-mono">수량 (주)</span>
                  <input inputMode="decimal" className="input-field num !px-2.5" value={openingQty} onChange={(e) => setOpeningQty(e.target.value)} placeholder="0.087" />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <span className="label-mono shrink-0">처음 시작한 날</span>
                <DatePicker value={startedOn} onChange={setStartedOn} max={kstDate()} clearable placeholder="선택 (안 적어도 됨)" className="!w-auto !py-1.5" ariaLabel="처음 시작한 날" />
              </div>
              {!editing && (
                <div className="flex items-start justify-between gap-3 border-t border-white/[0.06] pt-3">
                  <div className="min-w-0 text-xs">
                    <p className="text-zinc-200">이 수량을 보유에 더하기</p>
                    <p className="mt-0.5 leading-relaxed text-zinc-500">
                      {heldQty > 0
                        ? `이 계좌에 이미 ${fmtQty(heldQty)}를 갖고 있습니다. 모은 것을 매매 기록에 이미 넣었다면 끄세요.`
                        : '오늘 날짜의 매수 1건으로 기록합니다.'}
                    </p>
                  </div>
                  <Switch
                    label="보유에 더하기"
                    checked={addToHoldings}
                    onChange={(v) => {
                      setAddToHoldings(v);
                      setAddTouched(true);
                    }}
                  />
                </div>
              )}
              {editing && plan?.opening_tx_id && <p className="text-[11px] text-zinc-500">등록할 때 보유에 더한 기록도 함께 고쳐집니다.</p>}
            </div>

            <Field
              label="자동 기록 시작"
              hint={
                ticker
                  ? isKRTicker(ticker)
                    ? '한국 종목은 오늘 회차가 이미 위 누적 값에 들어 있다고 보고 다음 거래일부터 기록합니다.'
                    : '미국 종목은 오늘 밤 열리는 장부터 기록합니다. 증권사 앱에 오늘 밤 회차까지 이미 보이면 하루 뒤로 미루세요.'
                  : undefined
              }
            >
              <div className="flex items-center gap-2">
                <DatePicker
                  value={autoFrom}
                  onChange={(v) => {
                    setAutoFrom(v);
                    setAutoFromTouched(true);
                  }}
                  className="!w-auto !py-1.5"
                  ariaLabel="자동 기록 시작일"
                />
                {autoFrom && <span className="text-xs text-zinc-400">{fmtDay(autoFrom)} 장부터</span>}
              </div>
            </Field>

            <Field label="메모">
              <input className="input-field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="선택" maxLength={500} />
            </Field>
          </div>

          <div className="space-y-3 border-t border-white/[0.07] px-5 py-3.5">
            {amountNum > 0 && (ticker || editing) && (
              <p className="text-xs text-zinc-400">
                <span className="text-zinc-200">{ruleText(ruleRule, assetCcy)}</span>
              </p>
            )}
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                취소
              </button>
              <button type="button" className="btn-primary" onClick={save} disabled={saving}>
                {saving ? '저장 중…' : editing ? '저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
