import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Info, RefreshCw } from 'lucide-react';
import { PageActions } from '../components/shell/PageSlots';
import { apiClient } from '../api/client';
import type { TodayPick, TodayPicks } from '../types/models';
import TodayCard, { pickTitle } from '../components/today/TodayCard';
import RankingList, { accountRanking } from '../components/today/RankingList';
import QuickBuyModal from '../components/today/QuickBuyModal';
import { useAlerts } from '../components/alerts/AlertsProvider';
import { fmtCcy } from '../utils/fx';
import { accountDisplayName } from '../utils/accountLabel';

/**
 * 오늘 살 종목 — 보유 종목 전체에 '오늘 점수'(가격 매력 70 · 매수 신호 15 · 배당 점수 10 · 비중 여유 5)를 매겨 아래에 순위로 보여 주고,
 * 그 순위에서 살 수 있는 앞의 3개를 위에 카드로 보여 준다 (위·아래가 같은 점수). 가격 매력은 백그라운드에서 날짜별로 계산해 둔 '사기 좋은 가격'을 쓴다.
 * 보여 주는 방식: 커버플로우 · 카드 스택 · 피크 캐러셀 (고른 방식을 이 PC에 기억)
 * 아래 순위는 계좌를 골라 그 계좌에 담긴 종목만 볼 수 있다 (새 종목 말고 그 계좌에 있던 것 가운데 고르려는 사람 — 고른 계좌를 이 PC에 기억)
 * 계산은 시세를 받느라 몇 초 걸려서(앱을 막 켰을 때는 10초 넘게), 마지막 결과(앱을 새로 켰으면 DB 에 남긴 것)부터
 * 계산 시각과 함께 보여 주고 뒤에서 새로 계산해 바꾼다.
 */

const RANK_ACCOUNT_KEY = 'today-ranking-account';
const loadRankAccount = (): number | null => {
  try {
    const v = Number(localStorage.getItem(RANK_ACCOUNT_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
};

// 이번 실행 동안 마지막 결과 (오늘 탭을 다시 열면 바로 보여 준다)
let lastToday: TodayPicks | null = null;
/** 먼저 보여 줘도 되는 결과: 3일 안에 계산한 것 */
const recent = (p: TodayPicks | null): p is TodayPicks => {
  if (!p) return false;
  const t = new Date(p.computed_at).getTime();
  return !Number.isNaN(t) && Date.now() - t <= 72 * 3600_000;
};
const hm = (t: Date) => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
const ageText = (iso: string) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const min = Math.floor((Date.now() - t.getTime()) / 60000);
  if (min < 1) return '방금 계산';
  if (min < 60) return `${min}분 전 계산`;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(t)) / 86400000);
  if (days <= 0) return `${hm(t)} 계산`;
  if (days === 1) return `어제 ${hm(t)} 계산`;
  return `${t.getMonth() + 1}월 ${t.getDate()}일 ${hm(t)} 계산`;
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
  const [data, setData] = useState<TodayPicks | null>(() => (recent(lastToday) ? lastToday : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !recent(lastToday));
  const [refreshing, setRefreshing] = useState(false);
  const [style, setStyle] = useState<Style>(savedStyle);
  const [active, setActive] = useState(0);
  const [buy, setBuy] = useState<TodayPick | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { focusAsset } = useAlerts();
  const picks = data?.picks ?? [];
  const n = picks.length;
  // 아래 순위: 전체 계좌 또는 고른 계좌 (고른 계좌가 결과에 없으면 전체)
  const [rankAccountId, setRankAccountId] = useState<number | null>(loadRankAccount);
  const rankAccounts = data?.accounts ?? [];
  const rankAcc = rankAccountId != null ? (rankAccounts.find((a) => a.id === rankAccountId) ?? null) : null;
  const rankRows = rankAcc ? accountRanking(data?.ranking ?? [], rankAcc.id) : (data?.ranking ?? []);
  const pickRankAccount = (id: number | null) => {
    setRankAccountId(id);
    try {
      if (id) localStorage.setItem(RANK_ACCOUNT_KEY, String(id));
      else localStorage.removeItem(RANK_ACCOUNT_KEY);
    } catch {
      /* 기억 못 해도 화면은 그대로 */
    }
  };

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
      let shown = recent(lastToday) ? lastToday : null;
      if (!shown) {
        // 앱에서 마지막으로 계산한 결과 (새로 켰으면 DB 에 남긴 것)
        try {
          const c = await apiClient.GetTodayPicksCached();
          if (recent(c) && !cancelled) {
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
          {data ? `${dayLabel(data.date)} · ` : ''}보유 종목 전체를 오늘 점수로 매긴 순위에서 살 수 있는 앞의 3개
          {data && data.considered > 0 ? ` (보유 ${data.considered}종목 중)` : ''}
          {data && (
            <span className="num ml-2 text-[12px] text-zinc-500">
              · {ageText(data.computed_at)}
              {refreshing && ' · 지금 시세로 새로 계산하는 중…'}
            </span>
          )}
        </p>
        <span className="text-zinc-500" title={'오늘 점수 = 가격 매력 70 + 매수 신호 15 + 배당 점수 10 + 비중 여유 5 (예수금은 점수에 넣지 않음)\n가격 매력: 그 종목을 과거에 싸게 샀을 때 1년 뒤 평소보다 더 번 정도(최대 30%p) × 지금 얼마나 싼가 — 보유 종목 2017~2025 백테스트에서 가장 일관되게 맞은 조합\nTop 3 는 아래 순위에서 매도·충돌, 매수를 막은 종목(쉬는 기간·최대 비중·반등 미확인), 오늘 산 종목, 오늘 모으기로 사는 종목, 20점 미만을 건너뛴 앞의 3개입니다.\n과거 가격으로 계산한 참고값이며 투자 권유가 아닙니다.'} aria-label="안내">
          <Info className="h-4 w-4" />
        </span>
      </div>

      {notice && <p className="rounded-xl border border-mint-400/30 bg-mint-400/10 px-4 py-2.5 text-sm text-mint-200">{notice}</p>}
      {error && <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</p>}

      {loading && !data ? (
        <div className="h-[600px] animate-pulse rounded-[22px] bg-white/[0.03]" />
      ) : n === 0 ? (
        <div className="surface px-6 py-16 text-center">
          <p className="text-base font-semibold text-white">오늘은 추천할 종목이 없어요</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-zinc-400">
            20점을 넘긴 보유 종목이 없거나, 모두 매도 신호 · 쉬는 기간 · 최대 비중 · 오늘 이미 산 종목입니다. 아래 순위에서 빠진 이유를 볼 수 있어요.
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
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="min-w-0 text-[14px] font-semibold text-white">
              {rankAcc ? `${accountDisplayName(rankAcc)} 순위` : '보유 종목 전체 순위'} <span className="num text-zinc-400">{rankRows.length}종목</span>
            </p>
            {rankAccounts.length > 1 && (
              <select
                aria-label="순위를 볼 계좌"
                value={rankAcc?.id ?? ''}
                onChange={(e) => pickRankAccount(Number(e.target.value) || null)}
                className="input-field !w-full !py-1.5 px-3 text-[12.5px] sm:!w-auto sm:min-w-[14rem]"
              >
                <option value="">전체 계좌 · {(data.ranking ?? []).length}종목</option>
                {rankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountDisplayName(a)} · {a.count}종목
                  </option>
                ))}
              </select>
            )}
          </div>
          {rankAcc ? (
            <p className="mb-2 text-[12px] leading-relaxed text-zinc-500">
              이 계좌에 담긴 종목만 — 점수는 위와 같고 이 계좌 안에서 순위를 매겨요. 빠질 이유가 없는 앞의 3개가 이 계좌 Top 3 예요.
              <span className="num block text-zinc-400">
                {rankAcc.no_cash
                  ? '예수금 기록 안 함 · 통장에서 바로'
                  : `예수금 원화 ${fmtCcy(rankAcc.krw, 'KRW')}${rankAcc.usd !== 0 || rankRows.some((r) => r.currency === 'USD') ? ` · 달러 ${fmtCcy(rankAcc.usd, 'USD')}` : ''}`}
              </span>
            </p>
          ) : (
            <p className="mb-2 text-[12px] leading-relaxed text-zinc-500">
              위 Top 3 와 같은 오늘 점수예요. 과거 기준 기대 = 그 종목을 과거에 이만큼 쌌을 때 샀다면 1년 뒤 평소보다 더 번 정도(배당 포함). 빠진 이유가 있는 종목은 Top 3 에서 건너뛰어요.
            </p>
          )}
          {rankAcc && rankRows.length > 0 && !rankRows.some((r) => r.pick) && (
            <p className="mb-2 rounded-lg bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-400">이 계좌에는 오늘 Top 3 에 넣을 종목이 없어요 (모두 빠질 이유가 있거나 20점 미만). 순서는 참고로 보세요.</p>
          )}
          {data.zone_count > 0 && (
            <p className="num mb-2 text-[11.5px] text-zinc-500">가격대 {clock(data.zone_updated_at)} 계산 · {data.zone_count}종목 (1년 이력이 없는 종목·펀드는 가격 매력 0)</p>
          )}
          {data.zone_count === 0 && (
            <p className="mb-2 rounded-lg bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-400">아직 가격대를 계산하지 않아 가격 매력이 0이에요. 앱이 켜져 있으면 백그라운드에서 보유 종목의 10년 주가를 받아 계산해요 (몇 분 걸려요).</p>
          )}
          {rankRows.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-zinc-400">새로 계산하면 순위가 보여요.</p>
          ) : (
            <RankingList key={rankAcc?.id ?? 0} rows={rankRows} accountId={rankAcc?.id ?? null} onOpen={focusAsset} />
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { pt: '70', title: '가격 매력', text: '과거에 싸게 샀을 때 1년 뒤 평소보다 더 번 정도(최대 30%p) × 지금 얼마나 싼가. 이력이 없으면 0', cls: 'border-emerald-400' },
          { pt: '15', title: '매수 신호', text: '매매 신호의 매수 조건을 얼마나 채웠나 (매수 검토면 만점)', cls: 'border-mint-400' },
          { pt: '10', title: '배당 점수', text: '배당 점수와 지금 수익률 매력', cls: 'border-amber-300' },
          { pt: '5', title: '비중 여유', text: '매수 최대 비중(없으면 20%)보다 낮을수록. 예수금은 점수에 넣지 않고 카드에 보여만 줘요', cls: 'border-sky-400' },
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

  const frame = 'relative h-[600px] overflow-hidden rounded-[22px] border border-white/[0.08] bg-[radial-gradient(120%_90%_at_50%_0%,rgb(var(--c-mint-400)/0.08)_0%,transparent_60%)]';
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
