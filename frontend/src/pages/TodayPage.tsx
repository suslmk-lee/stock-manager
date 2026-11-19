import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Info, RefreshCw } from 'lucide-react';
import { PageActions } from '../components/shell/PageSlots';
import { apiClient } from '../api/client';
import type { TodayPick, TodayPicks } from '../types/models';
import TodayCard, { pickTitle } from '../components/today/TodayCard';
import ZoneList from '../components/today/ZoneList';
import QuickBuyModal from '../components/today/QuickBuyModal';
import { useAlerts } from '../components/alerts/AlertsProvider';
import { fmtCcy } from '../utils/fx';

/**
 * 오늘 살 종목 Top 3 — 보유 종목마다 '오늘 점수'(가격 매력 30 · 매수 신호 25 · 배당 점수 20 · 비중 여유 10 · 살 돈 15)를 매겨 높은 순으로 3개.
 * 가격 매력은 백그라운드에서 날짜별로 계산해 둔 '사기 좋은 가격'을 쓰고, 그 가격대에 있는 보유 종목을 아래에 모아 보여 준다.
 * 보여 주는 방식: 커버플로우 · 카드 스택 · 피크 캐러셀 (고른 방식을 이 PC에 기억)
 * 계산은 시세를 받느라 몇 초 걸려서, 다시 열면 마지막 결과부터 보여 주고 뒤에서 새로 계산해 바꾼다.
 */

// 이번 실행 동안 마지막 결과 (오늘 탭을 다시 열면 바로 보여 준다)
let lastToday: TodayPicks | null = null;
const sameDay = (iso: string) => {
  const t = new Date(iso);
  return !Number.isNaN(t.getTime()) && t.toDateString() === new Date().toDateString();
};
const ageText = (iso: string) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const min = Math.floor((Date.now() - t.getTime()) / 60000);
  if (min < 1) return '방금 계산';
  if (min < 60) return `${min}분 전 계산`;
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 계산`;
};

type Style = 'cover' | 'stack' | 'peek';
const STYLES: { key: Style; label: string; hint: string }[] = [
  { key: 'cover', label: '커버플로우', hint: '옆 카드를 누르거나 ← → 키로 넘겨 보세요' },
  { key: 'stack', label: '카드 스택', hint: '맨 위 카드를 옆으로 밀면 다음 종목으로 (← → 키도)' },
  { key: 'peek', label: '피크 캐러셀', hint: '옆으로 넘기면 다음 카드가 가운데로' },
];
const STYLE_KEY = 'today-style';
const CARD_W = 'min(330px, 80vw)';

const clock = (iso: string | null) => {
  if (!iso) return '';
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : `${t.getMonth() + 1}월 ${t.getDate()}일 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '불러오지 못했습니다.');
const dayLabel = (d: string) => {
  const t = new Date(`${d}T00:00:00`);
  return Number.isNaN(t.getTime()) ? d : `${t.getMonth() + 1}월 ${t.getDate()}일 (${'일월화수목금토'[t.getDay()]})`;
};

function savedStyle(): Style {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    if (v === 'cover' || v === 'stack' || v === 'peek') return v;
  } catch {
    /* 저장소를 못 써도 기본값으로 */
  }
  return typeof window !== 'undefined' && window.innerWidth < 640 ? 'peek' : 'cover';
}

export default function TodayPage() {
  const [data, setData] = useState<TodayPicks | null>(() => (lastToday && sameDay(lastToday.computed_at) ? lastToday : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !(lastToday && sameDay(lastToday.computed_at)));
  const [refreshing, setRefreshing] = useState(false);
  const [style, setStyle] = useState<Style>(savedStyle);
  const [active, setActive] = useState(0);
  const [buy, setBuy] = useState<TodayPick | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { focusAsset } = useAlerts();
  const picks = data?.picks ?? [];
  const n = picks.length;

  // quiet: 보이는 결과는 그대로 두고 뒤에서 새로 계산
  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const d = await apiClient.GetTodayPicks();
      lastToday = d;
      setData(d);
      setActive((a) => (quiet && d.picks.length > 0 ? Math.min(a, d.picks.length - 1) : 0));
    } catch (e) {
      setError(`오늘 살 종목을 계산하지 못했습니다: ${errText(e)}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let shown = lastToday && sameDay(lastToday.computed_at) ? lastToday : null;
      if (!shown) {
        // 앱이 켜질 때 미리 계산해 둔 결과
        try {
          const c = await apiClient.GetTodayPicksCached();
          if (c && sameDay(c.computed_at) && !cancelled) {
            lastToday = c;
            shown = c;
            setData(c);
            setLoading(false);
          }
        } catch {
          /* 없으면 새로 계산 */
        }
      }
      if (cancelled) return;
      if (shown && Date.now() - new Date(shown.computed_at).getTime() < 60_000) return; // 1분 안에 계산한 결과면 그대로
      load(!!shown);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const pickStyle = (s: Style) => {
    setStyle(s);
    try {
      localStorage.setItem(STYLE_KEY, s);
    } catch {
      /* 기억 못 해도 화면은 바뀐다 */
    }
  };

  const go = useCallback((i: number) => n > 0 && setActive(((i % n) + n) % n), [n]);

  // ← → 키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (buy || (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) return;
      if (e.key === 'ArrowLeft') go(active - 1);
      if (e.key === 'ArrowRight') go(active + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, active, buy]);

  const card = (p: TodayPick) => <TodayCard pick={p} onBuy={() => setBuy(p)} onDetail={() => focusAsset(p.asset_id)} />;

  return (
    <div className="space-y-5">
      <PageActions>
        <div className="glass-pill inline-flex p-1" role="group" aria-label="보여 주는 방식">
          {STYLES.map((s) => (
            <button key={s.key} type="button" onClick={() => pickStyle(s.key)} aria-pressed={style === s.key} className={`pill-item !px-3 !py-1 ${style === s.key ? 'pill-item-active' : ''}`}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-icon !h-9 !w-9" onClick={() => load(!!data)} disabled={loading || refreshing} aria-label="다시 계산" title="지금 시세로 다시 계산">
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
        </button>
      </PageActions>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] text-zinc-400">
          {data ? `${dayLabel(data.date)} · ` : ''}보유 종목을 가격 매력 · 매매 신호 · 배당 점수 · 비중 · 예수금으로 매긴 오늘 점수 순
          {data && data.considered > 0 ? ` (점수를 넘긴 ${data.considered}종목 중)` : ''}
          {data && (
            <span className="num ml-2 text-[12px] text-zinc-500">
              · {refreshing ? '지금 시세로 새로 계산하는 중…' : ageText(data.computed_at)}
            </span>
          )}
        </p>
        <span className="text-zinc-500" title={'오늘 점수 = 가격 매력 30 + 매수 신호 25 + 배당 점수 20 + 비중 여유 10 + 살 돈 15 (배당 점수·가격 매력이 없으면 그 몫은 신호로)\n가격 매력: 1년·3년 종가 가운데 지금 위치와 배당률 위치, 과거에 싸게 산 날 1년 뒤 수익이 평소보다 나빴던 종목은 절반\n매도·충돌, 매수를 막은 종목(쉬는 기간·최대 비중·반등 미확인), 오늘 산 종목, 오늘 모으기로 사는 종목은 뺍니다.\n규칙으로 계산한 참고값이며 투자 권유가 아닙니다.'} aria-label="안내">
          <Info className="h-4 w-4" />
        </span>
      </div>

      {notice && <p className="rounded-xl border border-mint-400/30 bg-mint-400/10 px-4 py-2.5 text-sm text-mint-200">{notice}</p>}
      {error && <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</p>}

      {loading && !data ? (
        <div className="h-[540px] animate-pulse rounded-[22px] bg-white/[0.03]" />
      ) : n === 0 ? (
        <div className="surface px-6 py-16 text-center">
          <p className="text-base font-semibold text-white">오늘은 추천할 종목이 없어요</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-zinc-400">
            점수를 넘긴 보유 종목이 없거나, 모두 쉬는 기간 · 최대 비중 · 오늘 이미 산 종목입니다. 매매 신호 화면에서 종목별 조건을 볼 수 있어요.
          </p>
        </div>
      ) : (
        <>
          <Stage style={style} picks={picks} active={active} go={go} card={card} onActive={setActive} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {picks.map((p, i) => (
                <button
                  key={p.asset_id}
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === active}
                  className={`rounded-[10px] border px-3 py-1.5 text-[13px] transition-colors ${i === active ? 'border-mint-400 text-white' : 'border-white/10 text-zinc-400 hover:text-zinc-200'}`}
                >
                  {p.rank}위 · {pickTitle(p).primary}
                </button>
              ))}
            </div>
            {n > 1 && (
              <div className="flex gap-1.5">
                <button type="button" className="btn-icon !h-9 !w-9" onClick={() => go(active - 1)} aria-label="이전 카드">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button type="button" className="btn-icon !h-9 !w-9" onClick={() => go(active + 1)} aria-label="다음 카드">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {data && (
        <div className="surface p-4 sm:p-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-[14px] font-semibold text-white">
              사기 좋은 가격대 <span className="num text-zinc-400">{data.in_zone.length}종목</span>
            </p>
            <p className="num text-[11.5px] text-zinc-500">
              {data.zone_count > 0
                ? `${clock(data.zone_updated_at)} 계산 · 보유 ${data.zone_held}종목 중 ${data.zone_count}종목 (1년 이력이 없는 종목·펀드 제외)`
                : ''}
            </p>
          </div>
          <p className="mb-2 text-[12px] leading-relaxed text-zinc-500">각 종목의 지난 3년 종가 중 싼 20% 이하 가격 · 과거 이만큼 쌌을 때 샀다면 1년 뒤 총수익(배당 포함)과 평소를 비교해요</p>
          {data.zone_count === 0 ? (
            <p className="py-6 text-center text-[13px] text-zinc-400">아직 가격대를 계산하지 않았어요. 앱이 켜져 있으면 백그라운드에서 보유 종목의 10년 주가를 받아 계산해요 (몇 분 걸려요).</p>
          ) : data.in_zone.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-zinc-400">지금 사기 좋은 가격대에 있는 보유 종목이 없어요.</p>
          ) : (
            <ZoneList rows={data.in_zone} picked={new Set(picks.map((p) => p.asset_id))} onOpen={focusAsset} />
          )}
        </div>
      )}

      {data && data.plans.length > 0 && (
        <div className="surface p-4 sm:p-5">
          <p className="label-mono mb-2">오늘 모으기로 사는 종목 · 추천에서 뺐어요</p>
          <div className="divide-y divide-white/[0.05]">
            {data.plans.map((pl) => (
              <div key={`${pl.asset_id}-${pl.account}`} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="min-w-0 truncate text-zinc-200">
                  {pl.name} <span className="text-[11.5px] text-zinc-500">{pl.account}</span>
                </span>
                <span className="num shrink-0 text-zinc-300">{fmtCcy(pl.amount, pl.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { pt: '30', title: '가격 매력', text: '과거 1년·3년 가격과 배당률에 비해 지금 얼마나 싼가 (과거에 싸게 사도 안 통한 종목은 절반)', cls: 'border-emerald-400' },
          { pt: '25', title: '매수 신호', text: '매매 신호의 매수 조건을 얼마나 채웠나 (매수 검토면 만점)', cls: 'border-mint-400' },
          { pt: '20', title: '배당 점수', text: '배당 점수와 지금 수익률 매력', cls: 'border-amber-300' },
          { pt: '10', title: '비중 여유', text: '매수 최대 비중(없으면 20%)보다 낮을수록', cls: 'border-sky-400' },
          { pt: '15', title: '살 돈', text: '그 종목을 살 계좌의 예수금이 제안 금액을 얼마나 채우나', cls: 'border-zinc-500' },
        ].map((x) => (
          <div key={x.title} className={`min-w-0 border-t-[3px] pt-2 ${x.cls}`}>
            <p className="num text-xl font-semibold text-white">{x.pt}</p>
            <p className="text-[13px] font-semibold text-zinc-100">{x.title}</p>
            <p className="text-[11.5px] leading-relaxed text-zinc-500">{x.text}</p>
          </div>
        ))}
      </div>

      {buy && buy.account && (
        <QuickBuyModal
          pick={buy}
          onClose={() => setBuy(null)}
          onSaved={(msg) => {
            setBuy(null);
            setNotice(msg);
            load(true);
          }}
        />
      )}
    </div>
  );
}

/** 카드 3장을 고른 방식으로 보여 주는 무대 */
function Stage({ style, picks, active, go, card, onActive }: { style: Style; picks: TodayPick[]; active: number; go: (i: number) => void; card: (p: TodayPick) => JSX.Element; onActive: (i: number) => void }) {
  const n = picks.length;
  const hint = STYLES.find((s) => s.key === style)?.hint;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const trans = reduce ? 'none' : 'transform 520ms cubic-bezier(.2,.8,.2,1), opacity 400ms ease, filter 400ms ease';

  // 카드 스택: 맨 위 카드를 옆으로 밀면 다음
  const drag = useRef<{ x: number; dx: number; el: HTMLElement } | null>(null);
  const onDown = (e: ReactPointerEvent<HTMLElement>, i: number) => {
    if (style !== 'stack' || i !== active || (e.target as HTMLElement).closest('button')) return; // 카드 안 버튼(매수 기록 등)은 끌지 않는다
    const el = e.currentTarget;
    drag.current = { x: e.clientX, dx: 0, el };
    el.style.transition = 'none';
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.x;
    d.el.style.transform = `translateX(${d.dx}px) rotate(${d.dx / 18}deg)`;
  };
  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.el.style.transition = trans;
    if (Math.abs(d.dx) > 80) go(active + 1);
    else d.el.style.transform = 'translateY(0) scale(1)';
  };

  // 피크 캐러셀: 가운데 온 카드를 따라간다
  const track = useRef<HTMLDivElement>(null);
  const fromScroll = useRef(false);
  useEffect(() => {
    if (style !== 'peek' || !track.current || fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const el = track.current.children[active] as HTMLElement | undefined;
    if (el) track.current.scrollTo({ left: el.offsetLeft - (track.current.clientWidth - el.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
  }, [style, active, reduce]);
  const onScroll = () => {
    const t = track.current;
    if (!t) return;
    const mid = t.scrollLeft + t.clientWidth / 2;
    let best = 0;
    let bd = Infinity;
    Array.from(t.children).forEach((c, i) => {
      const el = c as HTMLElement;
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best !== active) {
      fromScroll.current = true;
      onActive(best);
    }
  };

  const frame = 'relative h-[560px] overflow-hidden rounded-[22px] border border-white/[0.08] bg-[radial-gradient(120%_90%_at_50%_0%,rgb(var(--c-mint-400)/0.08)_0%,transparent_60%)]';
  const cardCls = 'surface cursor-pointer select-none rounded-[20px] p-[18px] shadow-2xl';

  if (style === 'peek') {
    return (
      <div className={frame}>
        <div ref={track} onScroll={onScroll} className="scrollbar-hide absolute inset-0 flex snap-x snap-mandatory gap-4 overflow-x-auto pt-8" style={{ paddingInline: `calc(50% - ${CARD_W} / 2)` }}>
          {picks.map((p, i) => (
            <article key={p.asset_id} className={`${cardCls} h-max shrink-0 snap-center`} style={{ width: CARD_W }} onClick={() => go(i)}>
              {card(p)}
            </article>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-9 flex justify-center gap-1.5">
          {picks.map((p, i) => (
            <i key={p.asset_id} className={`h-[7px] rounded-full transition-all ${i === active ? 'w-5 bg-mint-400' : 'w-[7px] bg-white/25'}`} />
          ))}
        </div>
        <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-zinc-500">{hint}</p>
      </div>
    );
  }

  return (
    <div className={frame} style={{ perspective: style === 'cover' ? '1400px' : undefined }}>
      {picks.map((p, i) => {
        let transform: string;
        let z: number;
        let opacity = 1;
        let filter = 'none';
        if (style === 'cover') {
          const d = n >= 3 ? ((i - active + n + 1) % n) - 1 : i - active; // 3장이면 고리처럼 가운데 하나, 양옆에 하나씩
          const ad = Math.abs(d);
          transform = `translateX(${d * 72}%) translateZ(${ad ? -160 : 0}px) rotateY(${-d * 38}deg) scale(${ad ? 0.86 : 1})`;
          z = 10 - ad;
          opacity = ad > 1 ? 0 : 1;
          filter = ad ? 'brightness(0.7)' : 'none';
        } else {
          const o = (i - active + n) % n; // 0 = 맨 위
          transform = `translateY(${o * 16}px) scale(${1 - o * 0.05})`;
          z = 10 - o;
          opacity = o > 2 ? 0 : 1;
          filter = o ? `brightness(${1 - o * 0.16})` : 'none';
        }
        return (
          <article
            key={p.asset_id}
            className={`${cardCls} absolute top-8`}
            style={{ left: '50%', width: CARD_W, marginLeft: `calc(${CARD_W} / -2)`, transform, zIndex: z, opacity, filter, transition: trans, touchAction: style === 'stack' ? 'pan-y' : undefined }}
            onClick={() => (style === 'stack' && i === active ? undefined : go(i))}
            onPointerDown={(e) => onDown(e, i)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {card(p)}
          </article>
        );
      })}
      <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-zinc-500">{hint}</p>
    </div>
  );
}
