import { useState } from 'react';
import { X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { TodayPick } from '../../types/models';
import Portal from '../ui/Portal';
import DatePicker from '../ui/DatePicker';
import { fmtCcy } from '../../utils/fx';
import { accountDisplayName } from '../../utils/accountLabel';
import { pickTitle, suggestQty } from './TodayCard';
import BuyCashNotice, { pendingText, recordPendingCash, type PendingCash } from '../cash/BuyCashNotice';

/** 오늘 살 종목에서 바로 매수 기록 — 수량은 제안 수량, 가격은 지금 가격, 날짜는 오늘로 채워 둔다 */

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '저장하지 못했습니다.');
const num = (s: string) => Number(s.replace(/,/g, '').trim());
const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function QuickBuyModal({ pick: p, onClose, onSaved }: { pick: TodayPick; onClose: () => void; onSaved: (msg: string) => void }) {
  const t = pickTitle(p);
  const a = p.account!;
  const unit = /^FUND:/i.test(p.ticker) ? '좌' : '주';
  const [qty, setQty] = useState(String(suggestQty(p)));
  const [price, setPrice] = useState(String(p.price));
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashItems, setCashItems] = useState<PendingCash[]>([]);
  const q = num(qty);
  const pr = num(price);
  const total = q > 0 && pr > 0 ? q * pr : 0;

  const save = async () => {
    if (!(q > 0)) return setError('수량을 넣어 주세요.');
    if (!(pr > 0)) return setError('가격을 넣어 주세요.');
    setBusy(true);
    setError(null);
    try {
      await apiClient.CreateTransaction(a.id, p.asset_id, 'Buy', date, pr, q, 0, '오늘 살 종목에서 기록');
      // 매수는 이미 기록됐다 — 입금·환전 기록이 실패해도 닫고 알린다 (다시 눌러 매수가 두 번 기록되지 않게)
      let dep = '';
      if (cashItems.length > 0) {
        try {
          await recordPendingCash(a.id, date, cashItems);
          dep = ` · ${cashItems.map(pendingText).join(' · ')}도 기록`;
        } catch (e) {
          dep = ` · 입금·환전 기록은 남기지 못했어요 (${errText(e)}) — 예수금 화면에서 넣어 주세요`;
        }
      }
      onSaved(`${t.primary} ${q.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${unit} 매수를 기록했습니다${dep}.`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[92vh] w-full max-w-md flex-col" role="dialog" aria-modal="true" aria-label="매수 기록">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div className="min-w-0">
              <h3 className="section-title">매수 기록</h3>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {t.primary} · {accountDisplayName(a)}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-300">수량 ({unit})</span>
                <input id="quickbuy-qty" inputMode="decimal" className="input-field num" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
              </label>
              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-300">체결가 ({p.currency === 'KRW' ? '원' : p.currency === 'USD' ? '$' : p.currency})</span>
                <input id="quickbuy-price" inputMode="decimal" className="input-field num" value={price} onChange={(e) => setPrice(e.target.value)} />
              </label>
            </div>
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-zinc-300">체결일</span>
              <DatePicker value={date} onChange={setDate} ariaLabel="체결일" />
            </div>
            <p className="num text-[12px] leading-relaxed text-zinc-400">
              {total > 0 ? `합계 ${fmtCcy(total, p.currency)}` : ''}
              {total > 0 && !a.no_cash ? ` · ${accountDisplayName(a)} 예수금 ${fmtCcy(a.cash, a.currency)}` : ''}
            </p>
            {!a.no_cash && <BuyCashNotice input={{ accountId: a.id, assetId: p.asset_id, date, price: pr, quantity: q, fee: 0 }} onChange={setCashItems} />}
            <p className="text-[11px] leading-relaxed text-zinc-500">증권사 앱에서 체결된 수량과 가격으로 고쳐 넣으세요. 기록하면 오늘은 이 종목을 추천에서 뺍니다.</p>
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
            <button type="button" className="btn-ghost" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>
              {busy ? '저장 중…' : '매수 기록'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
