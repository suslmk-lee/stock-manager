import { useState } from 'react';
import { X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { ContributionPlanView } from '../../types/models';
import Portal from '../ui/Portal';
import DatePicker from '../ui/DatePicker';
import { fmtCcy } from '../../utils/fx';

/**
 * 현금성자산 맞추기 — 은행 앱 퇴직연금의 '현금성자산' 금액을 넣으면 앱이 계산한 현금과의 차이를 남긴다.
 * 늘어난 차이는 그동안 붙은 이자로, 줄어든 차이는 잔액 맞추기로. 금리(연 %)도 함께 적어 두면 예상 이자를 보여 준다.
 */

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '저장하지 못했습니다.');
const won = (v: number) => fmtCcy(v, 'KRW');
const num = (s: string) => Number(s.replace(/,/g, '').trim());
const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function CashSyncModal({ plan, onClose, onSaved }: { plan: ContributionPlanView; onClose: () => void; onSaved: (msg: string) => void }) {
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState(plan.cash_rate > 0 ? String(plan.cash_rate) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const b = num(balance);
  const has = balance.trim() !== '' && Number.isFinite(b);
  const diff = has ? Math.round(b - plan.cash) : 0;

  const save = async () => {
    const r = rate.trim() === '' ? -1 : num(rate);
    if (rate.trim() !== '' && !(r >= 0 && r <= 30)) return setError('금리는 0~30% 사이로 넣어 주세요.');
    if (balance.trim() !== '' && !(b >= 0)) return setError('현금성자산 금액을 0 이상으로 넣어 주세요.');
    if (!has && r < 0) return setError('현금성자산 금액이나 금리를 넣어 주세요.');
    setBusy(true);
    setError(null);
    try {
      // 금액을 비우면 금리만 바꾼다 (지금 계산된 현금 그대로 — 남길 차이 없음)
      const res = await apiClient.SyncContributionCash(plan.id, has ? b : plan.cash, date, r);
      onSaved(
        res.kind === 'interest'
          ? `현금성자산 이자 ${won(res.amount)}를 기록했습니다.`
          : res.kind === 'adjust'
            ? `현금성자산을 은행 앱에 맞췄습니다 (${won(res.amount)}).`
            : r >= 0
              ? `현금성자산 금리를 연 ${r}%로 적었습니다.`
              : '앱의 현금성자산이 은행 앱과 같습니다.',
      );
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[92vh] w-full max-w-md flex-col" role="dialog" aria-modal="true" aria-label="현금성자산 맞추기">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div>
              <h3 className="section-title">현금성자산 맞추기</h3>
              <p className="mt-0.5 text-xs text-zinc-500">부담금 중 투자하고 남은 돈 · 앱 계산 {won(plan.cash)}</p>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-300">은행 앱의 현금성자산 (원)</p>
              <input inputMode="numeric" className="input-field num" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder={`예: ${Math.max(0, Math.round(plan.cash)).toLocaleString('ko-KR')}`} autoFocus />
              {has && (
                <p className={`num text-[12px] leading-relaxed ${diff > 0 ? 'text-mint-300' : diff < 0 ? 'text-amber-200' : 'text-zinc-400'}`}>
                  {diff > 0
                    ? `앱보다 ${won(diff)} 많습니다 — 그동안 붙은 이자로 기록합니다.`
                    : diff < 0
                      ? `앱보다 ${won(-diff)} 적습니다 — 잔액 맞추기로 남깁니다. 아직 기록하지 않은 매수가 있으면 먼저 '추가 매수 기록'을 해 주세요.`
                      : '앱과 같습니다.'}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-zinc-300">기준일</p>
                <DatePicker value={date} onChange={setDate} ariaLabel="기준일" />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-zinc-300">금리 (연 %)</p>
                <input inputMode="decimal" className="input-field num" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="예: 3.03" />
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              은행 앱 퇴직연금 메뉴의 '현금성자산' 금액을 그대로 넣으세요. 구매를 신청해 두어 그 금액이 이미 빠져 보이면, 체결된 뒤 추가 매수를 기록하고 맞추는 것이 정확합니다. 금리는 예상 이자 표시에만 씁니다.
            </p>
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
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
