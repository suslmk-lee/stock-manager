import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { Account, Asset, ContributionPlanView, ContributionPlanRequest } from '../../types/models';
import Portal from '../ui/Portal';
import DatePicker from '../ui/DatePicker';
import AccountSelect from '../ui/AccountSelect';
import { assetPrimary, assetSecondary, isFundTicker, isKRTicker } from '../../utils/assetLabel';
import { fmtCcy } from '../../utils/fx';

/**
 * 부담금 배분 만들기·고치기 — 계좌, 매달 부담금·납입일, 상품별 비율(합 100%).
 * 새로 만들 때만: 자동 기록 시작일과, 그 전까지 쌓인 시작 잔고(ETF 수량·평균 단가 / 펀드 원금·평가금액).
 */

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '저장하지 못했습니다.');
const won = (v: number) => fmtCcy(v, 'KRW');
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (s: string) => Number(s.replace(/,/g, '').trim());
const usable = (a: Asset) => isFundTicker(a.ticker) || isKRTicker(a.ticker); // 원화 상품(국내 ETF·주식·펀드)만

interface Row {
  key: number;
  assetId: number;
  weight: string;
  // 시작 잔고 (새로 만들 때만)
  qty: string;
  avg: string;
  cost: string;
  value: string;
}

let seq = 0;
const emptyRow = (assetId = 0, weight = ''): Row => ({ key: ++seq, assetId, weight, qty: '', avg: '', cost: '', value: '' });

export default function PensionForm({ plan, accounts, onClose, onSaved }: { plan: ContributionPlanView | null; accounts: Account[]; onClose: () => void; onSaved: (id?: number) => void }) {
  const editing = plan != null;
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return ymd(d);
  }, []);
  // 퇴직연금 계좌(DC·IRP)를 앞에
  const sortedAccounts = useMemo(() => [...accounts].sort((a, b) => Number(['DC', 'IRP'].includes(b.account_type ?? '')) - Number(['DC', 'IRP'].includes(a.account_type ?? ''))), [accounts]);
  const [accountId, setAccountId] = useState(plan?.account_id ?? sortedAccounts.find((a) => a.account_type === 'DC')?.id ?? 0);
  const [amount, setAmount] = useState(plan ? String(plan.amount) : '');
  const [monthDay, setMonthDay] = useState(plan ? String(plan.month_day) : '25');
  const [autoFrom, setAutoFrom] = useState(plan?.auto_from ?? tomorrow);
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const [rows, setRows] = useState<Row[]>(() => (plan ? plan.items.map((it) => emptyRow(it.asset_id, String(it.weight))) : [emptyRow()]));
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 새 상품 추가
  const [fundName, setFundName] = useState('');
  const [fundCode, setFundCode] = useState('');
  const [etfCode, setEtfCode] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    apiClient
      .GetAllAssets()
      .then((list) => setAssets(((list ?? []) as Asset[]).filter(usable)))
      .catch(() => setAssets([]));
  }, []);

  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const sum = rows.reduce((s, r) => s + (num(r.weight) || 0), 0);
  const amountN = num(amount);

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // 비어 있는 첫 줄에 넣고, 없으면 줄을 더한다
  const putAsset = (a: Asset) => {
    setAssets((as) => (as.some((x) => x.id === a.id) ? as : [...as, a]));
    setRows((rs) => {
      if (rs.some((r) => r.assetId === a.id)) return rs;
      const empty = rs.find((r) => !r.assetId);
      return empty ? rs.map((r) => (r.key === empty.key ? { ...r, assetId: a.id } : r)) : [...rs, emptyRow(a.id)];
    });
  };

  const addFund = async () => {
    if (!fundName.trim()) return setError('펀드 이름을 넣어 주세요.');
    setAdding(true);
    setError(null);
    try {
      putAsset(await apiClient.CreateFund(fundName.trim(), fundCode.trim()));
      setFundName('');
      setFundCode('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setAdding(false);
    }
  };

  const addEtf = async () => {
    const code = etfCode.trim().toUpperCase();
    if (!/^[0-9A-Z]{6}$/.test(code)) return setError('국내 ETF·주식 코드 6자리를 넣어 주세요 (예: 360750).');
    setAdding(true);
    setError(null);
    try {
      const ticker = `${code}.KS`;
      const existing = assets.find((a) => a.ticker.toUpperCase() === ticker);
      if (existing) {
        putAsset(existing);
      } else {
        const info = (await apiClient.GetTickerInfo(ticker)) as { name?: string; type?: string } | null;
        if (!info?.name) throw new Error(`${code} 종목을 찾지 못했습니다.`);
        const created = (await apiClient.CreateAsset(ticker, info.name, 'ETF', '', 0, 0, 0)) as Asset;
        putAsset(created);
      }
      setEtfCode('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setAdding(false);
    }
  };

  const save = async () => {
    setError(null);
    const day = Number(monthDay);
    if (!accountId) return setError('계좌를 골라 주세요.');
    if (!(amountN > 0)) return setError('매달 부담금을 넣어 주세요.');
    if (!(day >= 1 && day <= 31)) return setError('납입일은 1~31일 중에서 넣어 주세요.');
    const filled = rows.filter((r) => r.assetId);
    if (filled.length === 0) return setError('상품을 하나 이상 넣어 주세요.');
    if (new Set(filled.map((r) => r.assetId)).size !== filled.length) return setError('같은 상품이 두 번 들어 있습니다.');
    if (filled.some((r) => !(num(r.weight) > 0))) return setError('상품마다 비율을 넣어 주세요.');
    if (Math.abs(sum - 100) > 0.01) return setError(`비율 합이 100%가 되어야 합니다 (지금 ${sum.toFixed(2)}%).`);
    // 시작 잔고는 자동 기록 시작 전날 기준
    const start = new Date(`${autoFrom}T00:00:00`);
    start.setDate(start.getDate() - 1);
    const req: ContributionPlanRequest = {
      account_id: accountId,
      amount: amountN,
      month_day: day,
      auto_from: autoFrom,
      started_on: ymd(start),
      notes,
      status: plan?.status,
      items: filled.map((r) => ({
        asset_id: r.assetId,
        weight: num(r.weight),
        ...(editing ? {} : { opening_qty: num(r.qty) || 0, opening_avg: num(r.avg) || 0, opening_cost: num(r.cost) || 0, opening_value: num(r.value) || 0 }),
      })),
    };
    setBusy(true);
    try {
      if (editing) {
        await apiClient.UpdateContributionPlan(plan!.id, req);
        onSaved(plan!.id);
      } else {
        const created = (await apiClient.CreateContributionPlan(req)) as { id?: number } | null;
        onSaved(created?.id);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[94vh] w-full max-w-3xl flex-col" role="dialog" aria-modal="true" aria-label="부담금 배분">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div>
              <h3 className="section-title">{editing ? '부담금 배분 고치기' : '퇴직연금 부담금 배분'}</h3>
              <p className="mt-0.5 text-xs text-zinc-500">매달 들어오는 부담금을 정한 비율대로 사는 퇴직연금(DC 등) — 납입일마다 입금과 상품별 매수를 기록합니다.</p>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-5 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <label className="field-label">계좌 *</label>
                {editing ? (
                  <p className="text-sm text-zinc-200">{plan!.account?.name}</p>
                ) : (
                  <AccountSelect accounts={sortedAccounts} value={accountId} onChange={setAccountId} ariaLabel="계좌" />
                )}
                {!editing && <p className="mt-1 text-[11px] text-zinc-500">퇴직연금 계좌가 없으면 계좌 화면에서 '퇴직연금 DC' 종류·은행(예: IBK기업은행)으로 먼저 만들어 주세요.</p>}
              </div>
              <div>
                <label className="field-label">매달 부담금 (원) *</label>
                <input inputMode="numeric" className="input-field num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 400000" />
              </div>
              <div>
                <label className="field-label">납입일 (매달) *</label>
                <input inputMode="numeric" className="input-field num" value={monthDay} onChange={(e) => setMonthDay(e.target.value)} placeholder="25" />
                <p className="mt-1 text-[11px] text-zinc-500">그달 말일보다 크면 말일</p>
              </div>
              <div>
                <label className="field-label">자동 기록 시작일</label>
                <DatePicker value={autoFrom} onChange={setAutoFrom} ariaLabel="자동 기록 시작일" />
                <p className="mt-1 text-[11px] text-zinc-500">이 날부터의 납입일 회차를 기록</p>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <p className="label-mono">상품과 비율</p>
                <p className={`num text-[12px] ${Math.abs(sum - 100) <= 0.01 ? 'text-mint-300' : 'text-amber-300'}`}>합 {sum.toFixed(sum % 1 ? 2 : 0)}% {amountN > 0 && `· 매달 ${won(amountN)}`}</p>
              </div>
              <div className="space-y-2">
                {rows.map((r) => {
                  const a = byId.get(r.assetId);
                  const fund = a ? isFundTicker(a.ticker) : false;
                  const share = amountN > 0 && num(r.weight) > 0 ? won((amountN * num(r.weight)) / 100) : '';
                  return (
                    <div key={r.key} className="rounded-xl border border-white/[0.06] p-2.5">
                      <div className="flex items-center gap-2">
                        <select className="input-field min-w-0 flex-1 !py-1.5 !text-sm" value={r.assetId || ''} onChange={(e) => setRow(r.key, { assetId: Number(e.target.value) })}>
                          <option value="">상품을 고르세요</option>
                          <optgroup label="펀드">
                            {assets.filter((x) => isFundTicker(x.ticker)).map((x) => (
                              <option key={x.id} value={x.id}>
                                {assetPrimary(x)} · {assetSecondary(x)}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="국내 ETF·주식">
                            {assets.filter((x) => !isFundTicker(x.ticker)).map((x) => (
                              <option key={x.id} value={x.id}>
                                {assetPrimary(x)} · {assetSecondary(x)}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        <div className="relative w-24 shrink-0">
                          <input inputMode="decimal" className="input-field num !py-1.5 !pr-6 text-right !text-sm" value={r.weight} onChange={(e) => setRow(r.key, { weight: e.target.value })} placeholder="비율" aria-label="비율" />
                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">%</span>
                        </div>
                        <button type="button" className="btn-icon !h-8 !w-8 shrink-0" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))} aria-label="이 상품 빼기">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {share && <p className="num mt-1 text-[11px] text-zinc-500">매달 {share}{a && !fund ? ' · ETF 는 1주 단위로 사고 남는 돈은 예수금' : ''}</p>}
                      {!editing && a && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {fund ? (
                            <>
                              <input inputMode="numeric" className="input-field num !py-1.5 !text-xs" value={r.cost} onChange={(e) => setRow(r.key, { cost: e.target.value })} placeholder="지금까지 원금 (원, 선택)" />
                              <input inputMode="numeric" className="input-field num !py-1.5 !text-xs" value={r.value} onChange={(e) => setRow(r.key, { value: e.target.value })} placeholder="지금 평가금액 (원, 선택)" />
                            </>
                          ) : (
                            <>
                              <input inputMode="decimal" className="input-field num !py-1.5 !text-xs" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} placeholder="지금 보유 수량 (선택)" />
                              <input inputMode="numeric" className="input-field num !py-1.5 !text-xs" value={r.avg} onChange={(e) => setRow(r.key, { avg: e.target.value })} placeholder="평균 단가 (원, 선택)" />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button type="button" className="btn-ghost mt-2 !py-1 !text-xs" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
                <Plus className="h-3.5 w-3.5" />
                상품 줄 더하기
              </button>
              {!editing && (
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  시작 잔고는 자동 기록 시작일 <b className="font-medium text-zinc-300">전날까지</b> 쌓인 것을 은행 앱에서 보고 넣으세요. 이미 이 계좌에 보유를 기록해 두었다면 비워 두면 됩니다. 펀드는 원금으로 좌수를, 평가금액으로 기준가를 정합니다.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-xl border border-dashed border-white/[0.1] p-3 sm:grid-cols-2">
              <div>
                <p className="label-mono mb-1.5">목록에 없는 펀드 추가</p>
                <div className="flex gap-2">
                  <input className="input-field min-w-0 flex-1 !py-1.5 !text-xs" value={fundName} onChange={(e) => setFundName(e.target.value)} placeholder="펀드 이름" />
                  <input className="input-field w-32 !py-1.5 !text-xs" value={fundCode} onChange={(e) => setFundCode(e.target.value)} placeholder="펀드코드 (선택)" />
                  <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 !text-xs" onClick={addFund} disabled={adding}>
                    추가
                  </button>
                </div>
              </div>
              <div>
                <p className="label-mono mb-1.5">목록에 없는 국내 ETF 추가</p>
                <div className="flex gap-2">
                  <input className="input-field min-w-0 flex-1 !py-1.5 !text-xs" value={etfCode} onChange={(e) => setEtfCode(e.target.value)} placeholder="종목코드 6자리 (예: 360750)" />
                  <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 !text-xs" onClick={addEtf} disabled={adding}>
                    찾아서 추가
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="field-label">메모</label>
              <input className="input-field !text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="예: 회사 DC — 연봉 인상 때 부담금 고치기" />
            </div>
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
            <button type="button" className="btn-ghost" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>
              {busy ? '저장 중…' : editing ? '고치기' : '만들기'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
