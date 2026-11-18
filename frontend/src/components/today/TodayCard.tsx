import type { TodayPick } from '../../types/models';
import { fmtCcy } from '../../utils/fx';
import { accountDisplayName } from '../../utils/accountLabel';

/** 오늘 살 종목 카드 — 순위 · 오늘 점수와 구성 · 6개월 주가 · 고른 이유 · 제안 금액과 살 계좌 */

const PARTS: { key: 'signal' | 'dividend' | 'weight' | 'cash'; label: string; cls: string }[] = [
  { key: 'signal', label: '신호', cls: 'bg-mint-400' },
  { key: 'dividend', label: '배당', cls: 'bg-amber-300' },
  { key: 'weight', label: '비중', cls: 'bg-sky-400' },
  { key: 'cash', label: '살 돈', cls: 'bg-zinc-500' },
];

const isKR = (t: string) => /\.(KS|KQ)$/i.test(t) || /^FUND:/i.test(t);
export const pickTitle = (p: Pick<TodayPick, 'ticker' | 'name'>) => (isKR(p.ticker) ? { primary: p.name, secondary: /^FUND:/i.test(p.ticker) ? '펀드' : p.ticker } : { primary: p.ticker, secondary: p.name });

function Spark({ series }: { series: number[] }) {
  if (series.length < 2) return <div className="grid h-[54px] place-items-center rounded-lg bg-white/[0.03] text-[11px] text-zinc-500">주가 이력 없음</div>;
  const w = 300;
  const h = 54;
  const pad = 4;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const pts = series.map((v, i) => [pad + (i * (w - pad * 2)) / (series.length - 1), pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  return (
    <svg className="block h-[54px] w-full text-mint-400" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={area} fill="currentColor" fillOpacity={0.12} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={3} fill="currentColor" />
    </svg>
  );
}

/** 제안 금액·수량 문구 (살 계좌의 예수금 통화) */
export function suggestText(p: TodayPick): string {
  const a = p.account;
  const qty = suggestQty(p);
  const amt = a && a.need > 0 ? fmtCcy(a.need, a.currency) : p.suggest_krw > 0 ? fmtCcy(p.suggest_krw, 'KRW') : fmtCcy(p.price, p.currency);
  return qty ? `${amt} · ${qty.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${/^FUND:/i.test(p.ticker) ? '좌' : '주'}` : amt;
}

/** 제안 수량: 매매 신호의 제안 수량, 없으면 제안 금액 ÷ 현재가 (통화가 같을 때), 그것도 없으면 1주 */
export function suggestQty(p: TodayPick): number {
  if (p.suggest_qty > 0) return p.suggest_qty;
  const a = p.account;
  if (a && a.need > 0 && p.price > 0 && a.currency === p.currency) {
    const q = a.need / p.price;
    return isKR(p.ticker) && !/^FUND:/i.test(p.ticker) ? Math.max(1, Math.floor(q)) : Math.round(q * 10000) / 10000;
  }
  return 1;
}

export default function TodayCard({ pick: p, onBuy, onDetail }: { pick: TodayPick; onBuy: () => void; onDetail: () => void }) {
  const t = pickTitle(p);
  const a = p.account;
  const parts = PARTS.map((x) => ({ ...x, value: p.parts[x.key], max: x.key === 'signal' ? p.parts.signal_max : x.key === 'dividend' ? (p.parts.signal_max === 70 ? 0 : 30) : 15 })).filter((x) => x.max > 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-white">
          <span className={`num inline-grid h-[26px] min-w-[30px] place-items-center rounded-full px-2 text-[13px] ${p.rank === 1 ? 'bg-mint-400 text-ink-950' : 'bg-white/[0.12] text-white'}`}>{p.rank}</span>위
        </span>
        <span className="flex items-center gap-2">
          <span className="num rounded-md border border-white/10 px-1.5 text-[11px] text-zinc-400">{p.market}</span>
          <button
            type="button"
            className="text-[11.5px] text-zinc-400 hover:text-white hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onDetail();
            }}
          >
            신호 보기
          </button>
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[18px] font-bold leading-snug tracking-tight text-white" title={p.name}>
          {t.primary}
        </p>
        <p className="truncate text-[12px] text-zinc-400">{t.secondary}</p>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="label-mono">오늘 점수</p>
          <p className="num text-[40px] font-semibold leading-none tracking-tight text-white">
            {Math.round(p.score)}
            <span className="ml-0.5 text-[13px] font-medium text-zinc-400">/100</span>
          </p>
        </div>
        <div className="text-right">
          <p className="num text-[15px] font-semibold text-white">{fmtCcy(p.price, p.currency)}</p>
          {p.from_high_pct < 0 && <p className="num text-[12px] text-rose-300">고점 대비 {p.from_high_pct.toFixed(1)}%</p>}
        </div>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.08]" role="img" aria-label={`점수 구성: ${parts.map((x) => `${x.label} ${x.value}`).join(', ')}`}>
        {parts.map((x) => (
          <span key={x.key} className={`block h-full ${x.cls}`} style={{ width: `${x.value}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-zinc-400">
        {parts.map((x) => (
          <span key={x.key} className="num">
            <i className={`mr-1 inline-block h-[7px] w-[7px] rounded-[2px] align-[1px] ${x.cls}`} />
            {x.label} {Math.round(x.value)}/{x.max}
          </span>
        ))}
      </div>
      <Spark series={p.series} />
      <ul className="flex flex-col gap-1.5 text-[13px] text-zinc-200">
        {p.reasons.map((r) => (
          <li key={r} className="flex items-baseline gap-2">
            <span className="h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full bg-mint-400" />
            <span className="min-w-0">{r}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
        <div className="min-w-0">
          <p className="num truncate text-[14px] font-semibold text-white">제안 {suggestText(p)}</p>
          <p className="num truncate text-[11.5px] text-zinc-400">
            {a ? (a.no_cash ? `${accountDisplayName(a)} · 통장에서 바로` : `${accountDisplayName(a)} 예수금 ${fmtCcy(a.cash, a.currency)}`) : '살 계좌 없음'}
          </p>
          {a && !a.no_cash && a.short > 0 && <p className="num truncate text-[11.5px] text-amber-300">{fmtCcy(a.short, a.currency)} 모자람 · 입금 필요</p>}
        </div>
        <button
          type="button"
          className="btn-primary shrink-0 !px-3.5 !py-1.5 !text-[13px]"
          disabled={!a}
          onClick={(e) => {
            e.stopPropagation();
            onBuy();
          }}
        >
          매수 기록
        </button>
      </div>
    </div>
  );
}
