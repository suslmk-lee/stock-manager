import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { HoldingCheck, PriceHistory } from '../../types/models';
import DatePicker from '../ui/DatePicker';
import Portal from '../ui/Portal';
import { dps } from '../divscore/scoreText';
import { accountDisplayName } from '../../utils/accountLabel';

/**
 * 배당 기록으로 본 보유 수량이 앱과 다를 때 — 무엇이 다른지 계산을 보여 주고 바로 고친다.
 *  - 매수가 빠진 듯: 빠진 수량만큼 매수 기록 추가 (날짜는 배당락 전날, 가격은 그날 종가) · 매달 늘면 모으기 등록 권유
 *  - 매도가 빠진 듯: 매매 기록 확인 안내
 *  - 세전으로 기록한 듯: 세후 금액으로 고치기
 */

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '저장하지 못했습니다.');
const qty = (q: number, digits = 2) => q.toLocaleString('ko-KR', { maximumFractionDigits: digits });
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const taxText = (c: HoldingCheck) => {
  if (c.tax_rate <= 0) return '세금 없음';
  const pct = `${Math.round(c.tax_rate * 1000) / 10}%`;
  return c.currency === 'USD' ? `세금 ${pct}` : `세금 0~${pct}`;
};

/** 그 날(또는 그 전 마지막 거래일) 종가 */
async function closeOn(ticker: string, day: string): Promise<number | null> {
  try {
    const h = (await apiClient.GetPriceHistory(ticker, '1y', '1d')) as PriceHistory | null;
    const end = new Date(`${day}T23:59:59`).getTime() / 1000;
    let best: number | null = null;
    for (const p of h?.points ?? []) if (p.time <= end && p.close > 0) best = p.close;
    return best;
  } catch {
    return null;
  }
}

export default function HoldingFixModal({ check: c, onClose, onDone }: { check: HoldingCheck; onClose: () => void; onDone: (msg: string) => void }) {
  const diff = Math.abs(c.implied - c.app_qty);
  const [qtyIn, setQtyIn] = useState(String(Math.round(diff * 10000) / 10000));
  const [date, setDate] = useState(c.buy_date);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = accountDisplayName({ name: c.account_name, broker: c.account_broker });
  const label = /\.(KS|KQ)$/i.test(c.ticker) ? c.asset_name : c.ticker;
  const money = (v: number) => dps(v, c.currency);

  // 매수 가격: 고른 날 종가 (사용자가 고치기 전까지 날짜를 바꾸면 다시 채운다)
  const [priceTouched, setPriceTouched] = useState(false);
  useEffect(() => {
    if (c.status !== 'short' || priceTouched) return;
    let cancelled = false;
    closeOn(c.ticker, date).then((v) => {
      if (!cancelled && v != null) setPrice(String(c.currency === 'KRW' ? Math.round(v) : Math.round(v * 100) / 100));
    });
    return () => {
      cancelled = true;
    };
  }, [c.status, c.ticker, c.currency, date, priceTouched]);

  const addBuy = async () => {
    const q = Number(qtyIn);
    const p = Number(price.replace(/,/g, ''));
    if (!(q > 0)) return setError('수량을 넣어 주세요.');
    if (!(p > 0)) return setError('가격을 넣어 주세요.');
    setBusy(true);
    setError(null);
    try {
      await apiClient.CreateTransaction(c.account_id, c.asset_id, 'Buy', date, p, q, 0, `배당으로 확인한 빠진 매수 (${shortDate(c.paid_on)} 배당 기준 약 ${qty(c.implied)}주)`);
      onDone(`${label} ${account}에 매수 ${qty(q, 4)}주를 기록했습니다.`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const fixGross = async () => {
    if (!c.fixed_amount) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.UpdateDividend(c.dividend_id, c.account_id, c.asset_id, c.paid_on, c.fixed_amount, 0, c.currency, true, c.notes);
      onDone(`${label} ${shortDate(c.paid_on)} 배당을 세후 ${money(c.fixed_amount)}로 고쳤습니다.`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const go = (hash: string) => {
    onClose();
    window.location.hash = hash;
  };

  const title =
    c.status === 'short' ? `매수 약 ${qty(diff)}주가 빠진 것 같아요` : c.status === 'over' ? `앱이 ${qty(diff)}주 더 알고 있어요` : c.status === 'gross' ? '세전 금액으로 기록한 것 같아요' : '수량이 맞아요';

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[92vh] w-full max-w-md flex-col" role="dialog" aria-modal="true" aria-label="보유 수량 확인">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div className="min-w-0">
              <h3 className="section-title">{title}</h3>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {label} · {account} · {shortDate(c.paid_on)} 배당
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {/* 계산 */}
            <div className="surface-inset space-y-1.5 px-4 py-3 text-[12.5px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-zinc-400">배당으로 본 수량</span>
                <span className="num text-[15px] font-semibold text-white">
                  {c.status === 'short' && c.tax_rate > 0 && c.currency !== 'USD' ? '적어도 ' : c.status === 'over' && c.currency !== 'USD' ? '많아야 ' : '약 '}
                  {qty(c.status === 'gross' ? c.app_qty : c.implied)}주
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-zinc-400">앱이 아는 수량 ({shortDate(c.buy_date)})</span>
                <span className="num text-[15px] text-zinc-200">{qty(c.app_qty, 4)}주</span>
              </div>
              <p className="num border-t border-white/[0.06] pt-1.5 text-[11px] leading-relaxed text-zinc-500">
                {c.status === 'gross'
                  ? `기록 ${money(c.amount)} = ${qty(c.app_qty, 4)}주 × 주당 ${money(c.per_share)} (세금 떼기 전)`
                  : `받은 배당 ${money(c.amount)} ÷ (주당 ${money(c.per_share)} × (1 − ${taxText(c)}))`}{' '}
                · {shortDate(c.ex_date)} 배당락 회차
              </p>
            </div>

            {c.status === 'short' && (
              <>
                {c.recurring && (
                  <div className="rounded-xl border border-orange-400/25 bg-orange-500/[0.07] px-3.5 py-3 text-[12px] leading-relaxed text-orange-100">
                    최근 회차마다 수량이 조금씩 늘고 있어요. 증권사의 정기 소액 매수(모으기)라면 <b>모으기</b>로 등록해 두세요. 앞으로는 회차마다 자동으로 기록돼요.
                    <button type="button" className="mt-2 block text-[12px] font-medium text-orange-200 underline-offset-2 hover:underline" onClick={() => go('accumulate')}>
                      모으기로 등록하러 가기 →
                    </button>
                  </div>
                )}
                <div className="space-y-3">
                  <p className="text-xs font-medium text-zinc-300">빠진 매수 추가</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-[11px] text-zinc-500">수량 (주)</span>
                      <input inputMode="decimal" className="input-field num" value={qtyIn} onChange={(e) => setQtyIn(e.target.value)} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-zinc-500">가격 ({c.currency === 'KRW' ? '원' : c.currency === 'USD' ? '$' : c.currency})</span>
                      <input
                        inputMode="decimal"
                        className="input-field num"
                        value={price}
                        placeholder="불러오는 중…"
                        onChange={(e) => {
                          setPriceTouched(true);
                          setPrice(e.target.value);
                        }}
                      />
                    </label>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-500">날짜</span>
                    <DatePicker value={date} onChange={setDate} ariaLabel="매수 날짜" />
                  </div>
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    배당락 전날({shortDate(c.buy_date)})과 그날 종가로 채워 두었어요. 여러 번에 나눠 샀다면 증권사 앱의 실제 날짜·가격으로 나눠 넣어도 되고, 한 줄로 넣어도 수량과 평가금액은 맞아요.
                  </p>
                </div>
              </>
            )}

            {c.status === 'over' && (
              <p className="text-[12.5px] leading-relaxed text-zinc-300">
                배당으로 보면 그때 {account}에는 {c.currency === 'USD' ? '약' : '많아야'} {qty(c.implied)}주가 있었어요. 여러 번에 걸쳐 산 것을 실제보다 이른 날짜로 한 번에 넣었거나, 매도 기록이 빠졌거나, 이 회차 배당을 일부만 기록한 것 같아요. 매매 기록과 배당 금액을 증권사 앱과 맞춰 보세요.
              </p>
            )}

            {c.status === 'gross' && c.fixed_amount != null && (
              <p className="text-[12.5px] leading-relaxed text-zinc-300">
                다른 배당 기록은 세금을 뗀 금액이에요. 이 기록도 세후로 고치면 <b className="num text-white">{money(c.fixed_amount)}</b>예요 (세금 {Math.round(c.tax_rate * 100)}%). 증권사 앱의 실제 입금액이 다르면 배당 기록에서 직접 고쳐 주세요.
              </p>
            )}

            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {c.status === 'over' ? '닫기' : '나중에'}
            </button>
            {c.status === 'short' && (
              <button type="button" className="btn-primary" onClick={addBuy} disabled={busy}>
                {busy ? '저장 중…' : '매수 기록 추가'}
              </button>
            )}
            {c.status === 'over' && (
              <button type="button" className="btn-primary" onClick={() => go('trades')}>
                매매 기록 보기
              </button>
            )}
            {c.status === 'gross' && c.fixed_amount != null && (
              <button type="button" className="btn-primary" onClick={fixGross} disabled={busy}>
                {busy ? '고치는 중…' : `세후 ${money(c.fixed_amount)}로 고치기`}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
