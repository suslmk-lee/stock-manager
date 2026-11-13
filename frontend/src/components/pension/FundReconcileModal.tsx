import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { ContributionItemView, FundPrice } from '../../types/models';
import Portal from '../ui/Portal';
import DatePicker from '../ui/DatePicker';
import { assetPrimary } from '../../utils/assetLabel';
import { fmtCcy } from '../../utils/fx';
import { askConfirm } from '../ui/confirmDialog';

/**
 * 펀드 평가금액 맞추기 — 은행 앱에 보이는 이 펀드의 평가금액을 넣으면 그날 기준가(= 평가금액 ÷ 앱 좌수)를 정한다.
 * 그 사이 날짜는 맞춘 기준가로 이어서 평가한다 (자산 추이·통계에 반영).
 */

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '저장하지 못했습니다.');
const won = (v: number) => fmtCcy(v, 'KRW');
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shortDate = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;

export default function FundReconcileModal({ accountId, item, onClose, onSaved }: { accountId: number; item: ContributionItemView; onClose: () => void; onSaved: (msg: string) => void }) {
  const [date, setDate] = useState(ymd(new Date()));
  const [value, setValue] = useState('');
  const [prices, setPrices] = useState<FundPrice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPrices = () =>
    apiClient
      .GetFundPrices(item.asset_id)
      .then(setPrices)
      .catch(() => setPrices([]));
  useEffect(() => {
    loadPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.asset_id]);

  const v = Number(value.replace(/,/g, ''));
  const preview = v > 0 && item.quantity > 0 ? v / item.quantity : 0;
  const gain = v > 0 && item.cost > 0 ? (v / item.cost - 1) * 100 : null;

  const save = async () => {
    if (!(v > 0)) return setError('은행 앱의 평가금액을 넣어 주세요.');
    setBusy(true);
    setError(null);
    try {
      const p = await apiClient.ReconcileFund(accountId, item.asset_id, v, date);
      onSaved(`${assetPrimary(item.asset)} ${shortDate(date)} 평가금액 ${won(v)} — 기준가를 ${won(p.nav)}에 맞췄습니다.`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: FundPrice) => {
    if (!(await askConfirm(`${shortDate(p.date)} 기준가 ${won(p.nav)} 기록을 지울까요?`))) return;
    try {
      await apiClient.DeleteFundPrice(p.id);
      loadPrices();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[92vh] w-full max-w-md flex-col" role="dialog" aria-modal="true" aria-label="평가금액 맞추기">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div className="min-w-0">
              <h3 className="section-title">평가금액 맞추기</h3>
              <p className="mt-0.5 truncate text-xs text-zinc-500">{assetPrimary(item.asset)}</p>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-white/[0.03] p-3 text-[12px]">
              <div>
                <p className="label-mono">원금</p>
                <p className="num text-zinc-100">{won(item.cost)}</p>
              </div>
              <div>
                <p className="label-mono">앱 평가 (기준가 {won(item.price)})</p>
                <p className="num text-zinc-100">{won(item.value)}</p>
                {item.price_date && <p className="num text-[11px] text-zinc-500">{shortDate(item.price_date)}에 맞춤</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-300">은행 앱의 평가금액 (원)</p>
              <input inputMode="numeric" className="input-field num" value={value} onChange={(e) => setValue(e.target.value)} placeholder="예: 1523400" autoFocus />
              {preview > 0 && (
                <p className="num text-[11px] text-zinc-500">
                  기준가 {won(preview)} (좌수 {item.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 })})
                  {gain != null && <span className={gain >= 0 ? 'text-mint-300' : 'text-rose-300'}> · 원금 대비 {gain >= 0 ? '+' : '−'}{Math.abs(gain).toFixed(2)}%</span>}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-300">기준일</p>
              <DatePicker value={date} onChange={setDate} ariaLabel="기준일" />
            </div>
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
            {prices && prices.length > 0 && (
              <div>
                <p className="label-mono mb-1">맞춘 기준가</p>
                <div className="divide-y divide-white/[0.05] overflow-hidden rounded-lg border border-white/[0.06]">
                  {prices.slice(0, 8).map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-1.5 text-[12px]">
                      <span className="num w-20 text-zinc-400">{shortDate(p.date)}</span>
                      <span className="num flex-1 text-zinc-100">{won(p.nav)}</span>
                      <span className="text-[11px] text-zinc-500">{p.source === 'opening' ? '시작 잔고' : '맞추기'}</span>
                      <button type="button" className="text-zinc-500 hover:text-rose-300" onClick={() => remove(p)} aria-label="지우기">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
            <button type="button" className="btn-ghost" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>
              {busy ? '저장 중…' : '맞추기'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
