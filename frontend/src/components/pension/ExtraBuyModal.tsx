import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { Asset, ContributionPlanView } from '../../types/models';
import Portal from '../ui/Portal';
import DatePicker from '../ui/DatePicker';
import AddProduct from './AddProduct';
import { assetPrimary, assetSecondary, isFundTicker, isKRTicker } from '../../utils/assetLabel';
import { fmtCcy } from '../../utils/fx';

/**
 * 추가 매수 기록 — 부담금 배분과 별개로 현금성자산으로 산 상품.
 * ETF 는 체결 수량·체결가, 펀드는 매수 금액만 (앱 기준가로 좌수를 센다 — 평가금액은 나중에 '맞추기'로 은행 앱과 맞춘다).
 */

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '저장하지 못했습니다.');
const won = (v: number) => fmtCcy(v, 'KRW');
const num = (s: string) => Number(s.replace(/,/g, '').trim());
const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const usable = (a: Asset) => isFundTicker(a.ticker) || isKRTicker(a.ticker); // 원화 상품(국내 ETF·주식·펀드)만

export default function ExtraBuyModal({ plan, onClose, onSaved }: { plan: ContributionPlanView; onClose: () => void; onSaved: (msg: string) => void }) {
  const mine = useMemo(() => [...plan.items, ...(plan.others ?? [])].map((it) => it.asset).filter((a): a is Asset => !!a), [plan]);
  const [all, setAll] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState(0);
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .GetAllAssets()
      .then((list) => setAll((list ?? []) as Asset[]))
      .catch(() => setAll([]));
  }, []);

  const mineIds = new Set(mine.map((a) => a.id));
  const rest = all.filter((a) => usable(a) && !mineIds.has(a.id));
  const asset = [...mine, ...all].find((a) => a.id === assetId) ?? null;
  const fund = asset ? isFundTicker(asset.ticker) : false;
  const spend = fund ? num(amount) : num(qty) * num(price);
  const after = Number.isFinite(spend) && spend > 0 ? plan.cash - spend : null;

  const put = (a: Asset) => {
    setAll((xs) => (xs.some((x) => x.id === a.id) ? xs : [...xs, a]));
    setAssetId(a.id);
  };

  const save = async () => {
    if (!asset) return setError('상품을 골라 주세요.');
    setBusy(true);
    setError(null);
    try {
      const tx = await apiClient.RecordContributionBuy(plan.id, fund ? { asset_id: asset.id, date, amount: num(amount) } : { asset_id: asset.id, date, quantity: num(qty), price: num(price) });
      onSaved(`${assetPrimary(asset)} ${fund ? `${won(num(amount))} (${tx.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}좌)` : `${num(qty).toLocaleString('ko-KR')}주`} 매수를 기록했습니다.`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[94vh] w-full max-w-lg flex-col" role="dialog" aria-modal="true" aria-label="추가 매수 기록">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div>
              <h3 className="section-title">추가 매수 기록</h3>
              <p className="mt-0.5 text-xs text-zinc-500">현금성자산으로 따로 산 상품 · 지금 현금성자산 {won(plan.cash)}</p>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-300">상품</p>
              <select className="input-field !text-sm" value={assetId || ''} onChange={(e) => setAssetId(Number(e.target.value))}>
                <option value="">상품을 고르세요</option>
                {mine.length > 0 && (
                  <optgroup label="이 계좌 상품">
                    {mine.map((a) => (
                      <option key={a.id} value={a.id}>
                        {assetPrimary(a)} · {isFundTicker(a.ticker) ? '펀드' : assetSecondary(a)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {rest.length > 0 && (
                  <optgroup label="다른 펀드·국내 ETF">
                    {rest.map((a) => (
                      <option key={a.id} value={a.id}>
                        {assetPrimary(a)} · {isFundTicker(a.ticker) ? '펀드' : assetSecondary(a)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <AddProduct known={[...mine, ...all]} onAdded={put} onError={setError} stacked />

            {asset && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5 sm:col-span-1">
                  <p className="text-xs font-medium text-zinc-300">체결일</p>
                  <DatePicker value={date} onChange={setDate} ariaLabel="체결일" />
                </div>
                {fund ? (
                  <div className="col-span-2 space-y-1.5 sm:col-span-1">
                    <p className="text-xs font-medium text-zinc-300">매수 금액 (원)</p>
                    <input inputMode="numeric" className="input-field num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 500000" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-zinc-300">체결 수량 (주)</p>
                      <input inputMode="decimal" className="input-field num" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="예: 10" />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-zinc-300">체결가 (원)</p>
                      <input inputMode="numeric" className="input-field num" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="예: 15455" />
                    </div>
                  </>
                )}
              </div>
            )}
            {asset && (
              <p className="text-[11px] leading-relaxed text-zinc-500">
                {fund
                  ? '펀드는 금액만 넣으면 앱 기준가로 좌수를 셉니다. 은행 앱의 좌수와 달라도 괜찮아요 — 평가금액은 상품 줄의 \'맞추기\'로 은행 앱과 맞춥니다.'
                  : '은행 앱 거래내역의 체결 수량과 체결가를 넣으세요.'}
                {after != null && <span className={after < 0 ? 'text-amber-200' : ''}> 기록하면 현금성자산은 {won(after)}가 됩니다.</span>}
              </p>
            )}
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
            <button type="button" className="btn-ghost" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy || !asset}>
              {busy ? '저장 중…' : '매수 기록'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
