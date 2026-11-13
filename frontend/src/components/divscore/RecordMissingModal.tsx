import { useState } from 'react';
import { X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { MissingDividend } from '../../types/models';
import DatePicker from '../ui/DatePicker';
import Portal from '../ui/Portal';
import { dps } from './scoreText';
import { accountDisplayName } from '../../utils/accountLabel';

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '저장하지 못했습니다.');
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 기록 누락 회차를 받은 배당으로 바로 기록 (금액은 예상 세후 금액으로 채워 두고 고칠 수 있다) */
export default function RecordMissingModal({ item, onClose, onSaved }: { item: MissingDividend; onClose: () => void; onSaved: (msg: string) => void }) {
  // 받은 날 기본값: 배당락일 2주 뒤 (오늘보다 늦으면 오늘)
  const guess = new Date(`${item.ex_date}T00:00:00`);
  guess.setDate(guess.getDate() + 14);
  const today = new Date();
  const [date, setDate] = useState(ymd(guess > today ? today : guess));
  const [amount, setAmount] = useState(String(item.currency === 'KRW' ? Math.round(item.expected_net) : item.expected_net.toFixed(2)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const v = Number(amount.replace(/,/g, ''));
    if (!(v > 0)) return setError('받은 금액을 넣어 주세요.');
    setBusy(true);
    setError(null);
    try {
      const saved = await apiClient.CreateDividend(item.account_id, item.asset_id, date, v, 0, item.currency, true, `배당락 ${item.ex_date} · 주당 ${dps(item.per_share, item.currency)} × ${item.quantity}주`);
      const sheetNote = (saved as { sheet_note?: string } | null | undefined)?.sheet_note;
      onSaved(`${item.ticker} ${item.ex_date} 회차를 기록했습니다.${sheetNote ? ` ${sheetNote}` : ''}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[92vh] w-full max-w-md flex-col" role="dialog" aria-modal="true" aria-label="배당 기록">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div>
              <h3 className="section-title">빠진 배당 기록</h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                {item.ticker} · {accountDisplayName({ name: item.account_name, broker: item.account_broker })} · 배당락 {item.ex_date}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-300">받은 금액 (세후, {item.currency === 'KRW' ? '원' : '$'})</p>
              <input inputMode="decimal" className="input-field num" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              <p className="num text-[11px] leading-relaxed text-zinc-500">
                예상: 주당 {dps(item.per_share, item.currency)} × {item.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 6 })}주 × (1 − 세금 {item.currency === 'KRW' ? '15.4' : '15'}%) — 증권사 앱의 실제 금액으로 고쳐 주세요.
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-300">받은 날</p>
              <DatePicker value={date} onChange={setDate} ariaLabel="받은 날" />
            </div>
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
            <button type="button" className="btn-ghost" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>
              {busy ? '저장 중…' : '받은 배당으로 기록'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
