import type { PriceZone, PriceZoneDetail, ZoneLevel } from '../../types/models';
import { fmtCcy } from '../../utils/fx';
import { ZONE_LEVEL } from '../today/TodayCard';

/**
 * 사기 좋은 가격 — 백그라운드에서 날짜별로 계산해 둔 이 종목의 가격대.
 * 가격 사다리(아주 좋은 · 좋은 · 중간 · 1년 범위와 지금), 1년·3년 위치, 배당률 위치, 과거에 싸게 산 날의 1년 뒤 수익, 최근 30일 기록
 */

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const md = (d: string) => {
  const [, m, day] = d.split('-');
  return m && day ? `${Number(m)}/${Number(day)}` : d;
};
const clock = (iso: string) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : `${t.getMonth() + 1}월 ${t.getDate()}일 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
};

const BAR: Record<ZoneLevel, string> = {
  great: 'bg-emerald-400',
  good: 'bg-emerald-400/60',
  fair: 'bg-zinc-500/70',
  high: 'bg-zinc-600/50',
};

function Ladder({ z }: { z: PriceZone }) {
  const lo = Math.min(z.low_1y, z.great, z.price);
  const hi = Math.max(z.high_1y, z.mid, z.price);
  const span = hi - lo || 1;
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100))}%`;
  const w = (a: number, b: number) => `${Math.max(0, ((Math.min(b, hi) - Math.max(a, lo)) / span) * 100)}%`;
  return (
    <div className="pt-6">
      <div className="relative h-2.5 rounded-full bg-white/[0.06]">
        <span className="absolute inset-y-0 left-0 rounded-l-full bg-emerald-400/70" style={{ width: w(lo, z.great) }} />
        <span className="absolute inset-y-0 bg-emerald-400/35" style={{ left: at(z.great), width: w(z.great, z.good) }} />
        <span className="absolute inset-y-0 bg-white/[0.10]" style={{ left: at(z.good), width: w(z.good, z.mid) }} />
        {[z.great, z.good, z.mid].map((v, i) => (
          <span key={i} className="absolute -bottom-1 -top-1 w-px bg-zinc-400/60" style={{ left: at(v) }} />
        ))}
        <span className="absolute -top-[22px] -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-white" style={{ left: at(z.price) }}>
          지금 {fmtCcy(z.price, z.currency)}
        </span>
        <span className="absolute -top-1 h-[18px] w-[3px] -translate-x-1/2 rounded-full bg-white shadow" style={{ left: at(z.price) }} />
      </div>
      <div className="num mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <span className="text-emerald-300">
          <i className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-emerald-400/70 align-[0px]" />
          아주 좋은 가격
          <br />
          <b className="text-[12.5px] font-semibold">{fmtCcy(z.great, z.currency)} 이하</b>
        </span>
        <span className="text-center text-emerald-200/90">
          <i className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-emerald-400/35 align-[0px]" />
          좋은 가격
          <br />
          <b className="text-[12.5px] font-semibold">{fmtCcy(z.good, z.currency)} 이하</b>
        </span>
        <span className="text-right text-zinc-400">
          3년 중간
          <br />
          <b className="text-[12.5px] font-semibold text-zinc-200">{fmtCcy(z.mid, z.currency)}</b>
        </span>
      </div>
      <p className="num mt-1 text-[11px] text-zinc-500">
        1년 범위 {fmtCcy(z.low_1y, z.currency)} ~ {fmtCcy(z.high_1y, z.currency)}
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.03] px-3 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="num text-[15px] font-semibold text-white">{value}</p>
      {sub && <p className="num truncate text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export default function PriceZonePanel({ detail, loading }: { detail: PriceZoneDetail | null; loading: boolean }) {
  if (loading && !detail) return <div className="surface-inset h-40 animate-pulse" />;
  const z = detail?.zone;
  if (!z) {
    return (
      <div className="surface-inset px-4 py-3">
        <p className="text-xs font-medium text-zinc-200">사기 좋은 가격</p>
        <p className="mt-1 text-[12px] text-zinc-500">아직 계산한 기록이 없어요. 보유 종목은 백그라운드에서 매일 계산해요 (주가 이력이 1년보다 짧은 종목·펀드는 빼요).</p>
      </div>
    );
  }
  const lv = ZONE_LEVEL[z.level];
  const hist = detail?.history ?? [];
  const yieldText = z.yield <= 0 ? '배당 없음' : `${z.yield.toFixed(2)}%`;
  const yieldSub = z.yield_pos >= 0 ? `지난 5년 중 상위 ${Math.max(1, Math.round(100 - z.yield_pos))}%` : z.yield > 0 ? '배당률이 낮아 점수에 안 씀' : undefined;
  return (
    <div className="surface-inset flex flex-col gap-3 px-4 pb-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-200">사기 좋은 가격</span>
          <span className={`badge !py-0 !text-[11px] ${lv.badge}`}>{lv.label}</span>
        </span>
        <span className="num text-[10.5px] text-zinc-500">
          가격 매력 {Math.round(z.score)}/100{z.expect > 0 ? ` · 과거 기준 +${z.expect.toFixed(1)}%p` : ''} · {clock(z.updated_at)} 계산
        </span>
      </div>

      <Ladder z={z} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="1년 중 위치" value={`하위 ${Math.round(z.pos_1y)}%`} sub="0% = 1년 최저" />
        <Stat label="3년 중 위치" value={z.years >= 1.5 ? `하위 ${Math.round(z.pos_3y)}%` : '이력 부족'} sub={`이력 ${z.years.toFixed(1)}년`} />
        <Stat label="배당률 (최근 1년)" value={yieldText} sub={yieldSub} />
        <Stat label="배당률이 높아지는 가격" value={z.yield_good_price > 0 ? fmtCcy(z.yield_good_price, z.currency) : '—'} sub={z.yield_good_price > 0 ? '지난 상위 20% 배당률' : undefined} />
      </div>

      {z.verdict === 'works' && (
        <p className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] px-3 py-2 text-[12.5px] leading-relaxed text-zinc-200">
          과거에 1년 중 싼 20% 가격이던 날({z.cheap_days}일 · {z.cheap_episodes}번의 하락기)에 샀다면 1년 뒤 총수익이 평균 <b className="text-emerald-300">{pct(z.cheap_avg)}</b>, 이익인 날이 {Math.round(z.cheap_win)}% — 아무 날이나 샀을 때는 평균 {pct(z.all_avg)}.
          {z.expect > 0 && <> 지금 싼 정도를 곱하면 평소보다 <b className="text-emerald-300">+{z.expect.toFixed(1)}%p</b> (가격 매력 {Math.round(z.score)}/100, 30%p 면 만점)</>}
        </p>
      )}
      {z.verdict === 'trap' && (
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/[0.08] px-3 py-2 text-[12.5px] leading-relaxed text-zinc-200">
          과거에 1년 중 싼 20% 가격이던 날({z.cheap_days}일)에 샀다면 1년 뒤 총수익이 평균 <b className="text-amber-300">{pct(z.cheap_avg)}</b> — 아무 날이나 샀을 때 {pct(z.all_avg)}보다 나빴어요. 싸 보여도 더 떨어진 적이 많아 가격 매력은 0이에요.
        </p>
      )}
      {z.verdict === 'few' && (
        <p className="rounded-xl bg-white/[0.03] px-3 py-2 text-[12.5px] text-zinc-400">
          비교할 과거 사례가 적어요 (1년 뒤를 알 수 있는 날 {z.test_days}일 중 싼 날 {z.cheap_days}일).{z.cheap_days < 40 ? ' 오늘 점수에서는 가격 매력을 0 대신 보유 종목 중간값으로 매겨요 (적은 사례로 따로 추정하면 과거에 오히려 틀렸어요).' : ' 하락기가 한 번뿐이라 참고만 하세요.'}
        </p>
      )}
      {z.falling && (z.level === 'great' || z.level === 'good' || z.pos_1y <= 30) && (
        <p className="text-[12px] text-amber-300">
          아직 내려가는 중 · 20일선 {fmtCcy(z.ma20, z.currency)} 아래, 직전 20거래일 저점 대비 {pct(z.from_low20)}
        </p>
      )}

      {hist.length > 1 && (
        <div>
          <p className="mb-1 text-[11px] text-zinc-500">최근 {hist.length}일 가격 매력 (매일 계산해 30일 보관)</p>
          <div className="flex h-10 items-end gap-[3px]">
            {hist.map((h) => (
              <span
                key={h.date}
                className={`min-w-0 flex-1 rounded-t-[2px] ${BAR[h.level]}`}
                style={{ height: `${Math.max(6, h.score)}%` }}
                title={`${md(h.date)} ${fmtCcy(h.price, h.currency)} · ${ZONE_LEVEL[h.level].label} · 매력 ${Math.round(h.score)}`}
              />
            ))}
          </div>
          <div className="num mt-0.5 flex justify-between text-[10px] text-zinc-600">
            <span>{md(hist[0].date)}</span>
            <span>{md(hist[hist.length - 1].date)}</span>
          </div>
        </div>
      )}
      <p className="text-[10.5px] text-zinc-600">과거 가격으로 계산한 참고값이며 앞으로의 수익을 보장하지 않아요.</p>
    </div>
  );
}
