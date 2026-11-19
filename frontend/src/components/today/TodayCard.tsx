import type { PriceZoneRow, TodayParts, TodayPick, ZoneLevel } from '../../types/models';
import { fmtCcy } from '../../utils/fx';
import { accountDisplayName } from '../../utils/accountLabel';

/** 오늘 살 종목 카드 — 순위 · 오늘 점수와 구성 · 1년 주가와 사기 좋은 가격대 · 고른 이유 · 제안 금액과 살 계좌 */

type PartKey = 'price' | 'signal' | 'dividend' | 'weight' | 'cash';
const PARTS: { key: PartKey; label: string; cls: string }[] = [
  { key: 'price', label: '가격', cls: 'bg-emerald-400' },
  { key: 'signal', label: '신호', cls: 'bg-mint-400' },
  { key: 'dividend', label: '배당', cls: 'bg-amber-300' },
  { key: 'weight', label: '비중', cls: 'bg-sky-400' },
  { key: 'cash', label: '살 돈', cls: 'bg-zinc-500' },
];

/** 가격대 이름과 색 */
export const ZONE_LEVEL: Record<ZoneLevel, { label: string; badge: string }> = {
  great: { label: '아주 좋은 가격', badge: 'border border-emerald-400/40 bg-emerald-400/15 text-emerald-200' },
  good: { label: '좋은 가격', badge: 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-200' },
  fair: { label: '보통', badge: 'border border-white/10 bg-white/[0.04] text-zinc-300' },
  high: { label: '비싼 편', badge: 'border border-white/10 bg-white/[0.04] text-zinc-400' },
};

const isKR = (t: string) => /\.(KS|KQ)$/i.test(t) || /^FUND:/i.test(t);
export const pickTitle = (p: Pick<TodayPick, 'ticker' | 'name'>) => (isKR(p.ticker) ? { primary: p.name, secondary: /^FUND:/i.test(p.ticker) ? '펀드' : p.ticker } : { primary: p.ticker, secondary: p.name });

/** 1년 주가 미니 차트 — 좋은 가격 아래를 띠로 칠한다 (선이 보이게 범위에 좋은 가격을 넣는다) */
function Spark({ series, zone }: { series: number[]; zone?: PriceZoneRow | null }) {
  if (series.length < 2) return <div className="grid h-[58px] place-items-center rounded-lg bg-white/[0.03] text-[11px] text-zinc-500">주가 이력 없음</div>;
  const w = 300;
  const h = 58;
  const pad = 4;
  const good = zone && zone.good > 0 ? zone.good : 0;
  const min = Math.min(...series, ...(good ? [good] : []));
  const max = Math.max(...series);
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
  const pts = series.map((v, i) => [pad + (i * (w - pad * 2)) / (series.length - 1), y(v)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  const gy = good ? y(good) : 0;
  return (
    <div className="relative">
      <svg className="block h-[58px] w-full text-mint-400" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        {good > 0 && (
          <>
            <rect x={0} y={gy} width={w} height={h - gy} className="fill-emerald-400" fillOpacity={0.1} />
            <line x1={0} x2={w} y1={gy} y2={gy} className="stroke-emerald-400" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          </>
        )}
        <path d={area} fill="currentColor" fillOpacity={0.1} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r={3} fill="currentColor" />
      </svg>
      {good > 0 && zone && (
        <span
          className="num pointer-events-none absolute left-1 -translate-y-full rounded bg-ink-900/75 px-1 text-[10px] font-medium leading-[14px] text-emerald-300"
          style={{ top: `${Math.max(12, (gy / h) * 100)}%` }}
        >
          좋은 가격 {fmtCcy(good, zone.currency)}
        </span>
      )}
    </div>
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
    if (isKR(p.ticker) && !/^FUND:/i.test(p.ticker)) return Math.max(1, Math.floor(q));
    // 환율로 오간 반올림 차이(1.0001주 등)는 정수로
    return Math.abs(q - Math.round(q)) < 0.002 ? Math.max(1, Math.round(q)) : Math.round(q * 10000) / 10000;
  }
  return 1;
}

const partMax = (parts: TodayParts, key: PartKey) => parts[`${key}_max` as const] ?? 0;

export default function TodayCard({ pick: p, onBuy, onDetail }: { pick: TodayPick; onBuy: () => void; onDetail: () => void }) {
  const t = pickTitle(p);
  const a = p.account;
  const z = p.zone;
  const parts = PARTS.map((x) => ({ ...x, value: p.parts[x.key] ?? 0, max: partMax(p.parts, x.key) })).filter((x) => x.max > 0);
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
        <div className="flex flex-col items-end gap-1 text-right">
          <p className="num text-[15px] font-semibold text-white">{fmtCcy(p.price, p.currency)}</p>
          {z ? (
            <span className={`badge !py-0 !text-[11px] ${ZONE_LEVEL[z.level].badge}`} title={`1년 중 하위 ${Math.round(z.pos_1y)}% · 3년 중 하위 ${Math.round(z.pos_3y)}%`}>
              {ZONE_LEVEL[z.level].label}
            </span>
          ) : (
            p.from_high_pct < 0 && <p className="num text-[12px] text-rose-300">고점 대비 {p.from_high_pct.toFixed(1)}%</p>
          )}
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
      <Spark series={p.series} zone={z} />
      <ul className="flex flex-col gap-1.5 text-[13px] text-zinc-200">
        {p.reasons.map((r) => (
          <li key={r} className="flex items-baseline gap-2">
            <span className="h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full bg-mint-400" />
            <span className="min-w-0">{r}</span>
          </li>
        ))}
        {p.warn && (
          <li className="flex items-baseline gap-2 text-amber-300">
            <span className="h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full bg-amber-300" />
            <span className="min-w-0">{p.warn}</span>
          </li>
        )}
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
