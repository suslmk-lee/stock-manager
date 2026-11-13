import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import type { DivScorePosition } from '../../types/models';
import BrokerLogo from '../ui/BrokerLogo';
import { accountDisplayName } from '../../utils/accountLabel';
import { isRestrictedAccount } from '../../utils/accountType';
import { money } from '../cash/CashPanel';
import { convertCcy, toKRW, type FxRates } from '../../utils/fx';

/**
 * 배당 점수 종목 상세의 '내 보유' — 수량·평단·원금 → 지금 평가·손익, 지금 보유 기간에 받은 배당과 그것까지 더한 손익,
 * 지금 수량으로 앞으로 1년 받을 배당 예상(최근 12개월 주당 배당 × 수량, 세전), 계좌가 둘 이상이면 계좌별 줄.
 * 금액은 종목 통화 (미국 종목은 달러, 합계 옆에 ≈ 원화).
 */

const shortDate = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
const qtyText = (q: number) => `${q.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}주`;
const signedMoney = (v: number, ccy: string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v), ccy)}`;
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
const tone = (v: number) => (v > 0 ? 'text-mint-300' : v < 0 ? 'text-rose-300' : 'text-zinc-300');

/** 보유 기간 (예: '1년 8개월째', '3개월째', '12일째') */
function heldFor(since: string, now = new Date()): string {
  const s = new Date(`${since}T00:00:00`);
  let months = (now.getFullYear() - s.getFullYear()) * 12 + (now.getMonth() - s.getMonth());
  if (now.getDate() < s.getDate()) months -= 1;
  if (months <= 0) return `${Math.max(1, Math.round((now.getTime() - s.getTime()) / 86400000))}일째`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y > 0 ? `${y}년 ` : ''}${m > 0 ? `${m}개월` : ''}째`.replace(' 째', '째');
}

function Tile({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="label-mono">{label}</p>
      <div className="num mt-0.5 truncate text-[16px] text-white">{children}</div>
      {sub != null && <p className="num truncate text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export default function MyPosition({ position: p, price, ccy, ttm, rates }: { position: DivScorePosition; price: number | null; ccy: string; ttm: number; rates: FxRates }) {
  // 받은 배당을 종목 통화로 (기록 통화가 다르면 지금 환율로 — 그때는 ≈)
  const conv = (v: number, from: string) => convertCcy(v, from, ccy, rates);
  const approx = p.received.some((r) => r.currency !== ccy);
  const received = p.received.reduce((s, r) => s + conv(r.total, r.currency), 0);
  const received12 = p.received.reduce((s, r) => s + conv(r.last_12m, r.currency), 0);
  const count = p.received.reduce((s, r) => s + r.count, 0);

  const value = price != null && price > 0 ? p.quantity * price : null;
  const pnl = value != null ? value - p.cost : null;
  const pct = (v: number) => (p.cost > 0 ? (v / p.cost) * 100 : 0);
  const withDiv = pnl != null ? pnl + received : null;
  const expected = p.quantity * ttm;
  // 미국 종목이면 원화 환산 (지금 환율)
  const approxKRW = (v: number) => (ccy !== 'KRW' && toKRW(1, ccy, rates) > 0 ? `≈ ${money(toKRW(v, ccy, rates), 'KRW')}` : '');
  const krw = (v: number) => (approxKRW(v) ? ` · ${approxKRW(v)}` : '');
  const one = p.accounts.length === 1 ? p.accounts[0] : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-mono">내 보유 · 지금 기준</p>
        {p.since && (
          <p className="num text-[11px] text-zinc-500">
            처음 산 날 {shortDate(p.since)} · {heldFor(p.since)}
          </p>
        )}
      </div>
      <div className="surface-inset grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4">
        <Tile label="보유 수량" sub={one ? accountDisplayName(one) : `계좌 ${p.accounts.length}개`}>
          {qtyText(p.quantity)}
        </Tile>
        <Tile
          label="평균 매수가"
          sub={
            price != null && price > 0 ? (
              <>
                현재가 {money(price, ccy)} (<span className={tone(price - p.avg_price)}>{signedPct((price / p.avg_price - 1) * 100)}</span>)
              </>
            ) : undefined
          }
        >
          {money(p.avg_price, ccy)}
        </Tile>
        <Tile label="평가금액" sub={[value != null && approxKRW(value), `원금 ${money(p.cost, ccy)}`].filter(Boolean).join(' · ')}>
          {value != null ? money(value, ccy) : '—'}
        </Tile>
        <Tile label="평가손익" sub={pnl != null ? <span className={tone(pnl)}>{signedPct(pct(pnl))}</span> : '현재가를 불러오는 중'}>
          {pnl != null ? <span className={tone(pnl)}>{signedMoney(pnl, ccy)}</span> : '—'}
        </Tile>
        <Tile label="받은 배당 (세후)" sub={count > 0 ? `최근 12개월 ${approx ? '≈ ' : ''}${money(received12, ccy)} · ${count}회` : '내 배당 기록 없음'}>
          {count > 0 ? `${approx ? '≈ ' : ''}${money(received, ccy)}` : '—'}
        </Tile>
        <Tile label="배당 포함 손익" sub={withDiv != null ? <span className={tone(withDiv)}>원금 대비 {signedPct(pct(withDiv))}</span> : undefined}>
          {withDiv != null ? <span className={tone(withDiv)}>{signedMoney(withDiv, ccy)}</span> : '—'}
        </Tile>
        <Tile label="앞으로 1년 예상 배당" sub={expected > 0 ? `세전 · 월 ≈ ${money(expected / 12, ccy)}${krw(expected)}` : '최근 12개월 배당 없음'}>
          {expected > 0 ? `≈ ${money(expected, ccy)}` : '—'}
        </Tile>
        <Tile label="내 평단 대비 배당률" sub="최근 12개월 ÷ 평균 매수가">
          {p.avg_price > 0 && ttm > 0 ? `${((ttm / p.avg_price) * 100).toFixed(2)}%` : '—'}
        </Tile>
      </div>

      {p.accounts.length > 1 && (
        <div className="mt-2 divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
          <div className="hidden grid-cols-[minmax(0,2.6fr)_minmax(0,0.9fr)_repeat(3,minmax(0,1fr))_4rem] gap-3 bg-white/[0.02] px-3 py-1.5 md:grid">
            {['계좌', '수량', '평단', '평가금액', '평가손익', '비중'].map((h, i) => (
              <span key={h} className={`label-mono ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </span>
            ))}
          </div>
          {p.accounts.map((a) => {
            const cost = a.quantity * a.avg_price;
            const v = price != null && price > 0 ? a.quantity * price : null;
            const g = v != null ? v - cost : null;
            const share = p.cost > 0 ? (cost / p.cost) * 100 : 0;
            return (
              <div key={a.account_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 md:grid-cols-[minmax(0,2.6fr)_minmax(0,0.9fr)_repeat(3,minmax(0,1fr))_4rem]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <BrokerLogo broker={a.broker} className="h-7 w-16 shrink-0" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 truncate text-[13px] text-zinc-100">
                      {isRestrictedAccount(a) && <Lock className="h-3 w-3 shrink-0 text-amber-300" />}
                      {/* 로고가 증권사를 보여 주므로 계좌 이름만 (좁은 칸에서 잘리지 않게) */}
                      <span className="truncate" title={accountDisplayName(a)}>
                        {a.name}
                      </span>
                    </span>
                    <span className="num block truncate text-[11px] text-zinc-500">
                      {a.since ? `${shortDate(a.since)}부터` : ''}
                      <span className="md:hidden">
                        {a.since ? ' · ' : ''}
                        {qtyText(a.quantity)} · 평단 {money(a.avg_price, ccy)}
                      </span>
                    </span>
                  </span>
                </span>
                <span className="num hidden text-right text-[13px] text-zinc-200 md:block">{qtyText(a.quantity)}</span>
                <span className="num hidden text-right text-[13px] text-zinc-200 md:block">{money(a.avg_price, ccy)}</span>
                <span className="num hidden text-right text-[13px] text-zinc-100 md:block">{v != null ? money(v, ccy) : '—'}</span>
                <span className={`num text-right text-[13px] ${g != null ? tone(g) : 'text-zinc-500'}`}>
                  {g != null ? (
                    <>
                      {signedMoney(g, ccy)}
                      <span className="block text-[11px]">{signedPct(cost > 0 ? (g / cost) * 100 : 0)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="hidden md:block">
                  <span className="num block text-right text-[12px] text-zinc-300">{share.toFixed(0)}%</span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <span className="block h-full rounded-full bg-mint-400/70" style={{ width: `${share}%` }} />
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
