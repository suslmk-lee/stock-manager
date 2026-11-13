import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Info, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { PageActions } from '../components/shell/PageSlots';
import SplitView from '../components/shell/SplitView';
import { apiClient } from '../api/client';
import { ccyOfTicker } from '../utils/fx';
import type { DivScoreParts, DivScoreRanking, DivScoreRow, DivStatus, MissingDividend } from '../types/models';
import { assetPrimary, assetSecondary, tickerFirst } from '../utils/assetLabel';
import CardIcon from '../components/ui/CardIcon';
import { IconPodium } from '../components/ui/appIcons';
import ScoreDetail, { MissingList } from '../components/divscore/ScoreDetail';
import ScoreSettings from '../components/divscore/ScoreSettings';
import RecordMissingModal from '../components/divscore/RecordMissingModal';
import { monthLabel, PART_KEYS, PART_LABEL, PART_SHORT, partPoints, STATUS_META, type PartKey } from '../components/divscore/scoreText';
import { askConfirm } from '../components/ui/confirmDialog';

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '불러오지 못했습니다.');
const SUMMARY = -1;
const STATUS_ORDER: DivStatus[] = ['up', 'flat', 'down', 'missed', 'new'];

/** 목록 정렬: 종합 점수 또는 항목 하나 */
type SortKey = 'total' | PartKey;
const SORTS: { key: SortKey; label: string }[] = [{ key: 'total', label: '종합' }, ...PART_KEYS.map((k) => ({ key: k as SortKey, label: PART_SHORT[k] }))];

/** 시장 필터: 한국(.KS·.KQ) / 미국(그 밖) — 고르면 그 안에서 순위를 다시 매긴다 */
type Market = 'all' | 'kr' | 'us';
const MARKETS: { key: Market; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'kr', label: '한국' },
  { key: 'us', label: '미국' },
];
const MARKET_KEY = 'divscore-market';
// 한국 = 원화 종목, 미국 = 달러 종목 (엔화 등 그 밖의 시장은 전체에서만)
const inMarket = (ticker: string, m: Market) => m === 'all' || ccyOfTicker(ticker) === (m === 'kr' ? 'KRW' : 'USD');
const norm = (v: string) => v.toLowerCase().replace(/\s+/g, '');
const savedMarket = (): Market => {
  try {
    const v = localStorage.getItem(MARKET_KEY);
    return v === 'kr' || v === 'us' ? v : 'all';
  } catch {
    return 'all';
  }
};

/** 지난달 대비 순위 변화 칩 — 오름은 강조색, 내림은 파랑 (밝은 테마에서 오름·내림 색이 비슷해 보이지 않게) */
function RankChange({ rank, prev }: { rank: number; prev?: number }) {
  if (prev == null)
    return (
      <span className="rounded-full border border-white/15 px-1.5 text-[10px] font-semibold leading-4 tracking-wide text-zinc-300" title="지난달 순위에 없던 종목">
        NEW
      </span>
    );
  const d = prev - rank;
  if (d === 0)
    return (
      <span className="num text-[11px] text-zinc-600" title={`지난달도 ${rank}위`}>
        –
      </span>
    );
  return (
    <span className={`num rounded-full px-1.5 text-[11px] font-semibold leading-[18px] ${d > 0 ? 'bg-mint-400/15 text-mint-300' : 'bg-sky-400/15 text-sky-300'}`} title={`지난달 ${prev}위`}>
      {d > 0 ? `▲${d}` : `▼${-d}`}
    </span>
  );
}

/** 이번 달 눈여겨볼 변화: 새로 감소·누락, 순위가 3계단 넘게 오르내림, 새로 순위에 든 종목 */
function changesOf(rows: DivScoreRow[]) {
  const out: { row: DivScoreRow; text: string; tone: string }[] = [];
  for (const r of rows) {
    const s = r.metrics.status;
    if ((s === 'down' || s === 'missed') && r.prev_status !== s) out.push({ row: r, text: `${STATUS_META[s].label}으로 바뀜${r.prev_status ? ` (지난달 ${STATUS_META[r.prev_status].label})` : ''}`, tone: 'text-rose-300' });
    else if (s === 'up' && r.prev_status && r.prev_status !== 'up') out.push({ row: r, text: `증가로 바뀜 (지난달 ${STATUS_META[r.prev_status].label})`, tone: 'text-mint-300' });
    if (r.prev_rank != null && Math.abs(r.prev_rank - r.rank) >= 3) {
      const d = r.prev_rank - r.rank;
      out.push({ row: r, text: `순위 ${d > 0 ? `${d}계단 오름` : `${-d}계단 내림`} (${r.prev_rank}위 → ${r.rank}위)`, tone: d > 0 ? 'text-mint-300' : 'text-sky-300' });
    }
  }
  return out;
}

export default function DividendScorePage() {
  const [month, setMonth] = useState('');
  const [data, setData] = useState<DivScoreRanking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [split, setSplit] = useState<boolean | null>(null);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<MissingDividend | null>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());

  const load = useCallback(async (m: string) => {
    try {
      setError(null);
      setData(await apiClient.GetDividendScore(m));
    } catch (e) {
      setError(`배당 점수를 불러오지 못했습니다: ${errText(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(month);
  }, [load, month]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);

  // 넓은 화면은 처음에 요약을 보여 준다
  useEffect(() => {
    if (split && selected == null && data) setSelected(SUMMARY);
  }, [split, selected, data]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  // 항목 기준 정렬: 그 항목 점수가 높은 순 (같으면 종합 순위 순) — 서버의 항목별 순위와 같은 순서
  const [sortKey, setSortKey] = useState<SortKey>('total');
  // 시장 필터(이 PC에 기억)와 검색어
  const [market, setMarket] = useState<Market>(savedMarket);
  useEffect(() => {
    try {
      localStorage.setItem(MARKET_KEY, market);
    } catch {
      /* 저장 못 해도 이번에는 쓴다 */
    }
  }, [market]);
  const [query, setQuery] = useState('');

  // 고른 시장 안에서 고른 기준으로 순위를 매기고, 지난달도 같은 시장·같은 기준으로 다시 매겨 비교한다
  const ranked = useMemo(() => {
    type Ranked = { rank: number; parts: DivScoreParts };
    const order = (a: Ranked, b: Ranked) => (sortKey === 'total' ? a.rank - b.rank : b.parts[sortKey] - a.parts[sortKey] || a.rank - b.rank);
    const cur = rows.filter((r) => inMarket(r.asset.ticker, market)).sort(order);
    const prevRank = new Map((data?.prev ?? []).filter((p) => inMarket(p.ticker, market)).sort(order).map((p, i) => [p.asset_id, i + 1]));
    return cur.map((r, i) => ({
      row: r,
      rank: i + 1,
      // 지난달 전체 목록을 안 주는 예전 서버면 전체 보기에서만 서버가 매긴 지난달 순위를 쓴다
      prev: data?.prev ? prevRank.get(r.asset_id) : market === 'all' ? (sortKey === 'total' ? r.prev_rank : r.prev_part_rank?.[sortKey]) : undefined,
    }));
  }, [rows, data, market, sortKey]);
  // 검색은 순위를 그대로 두고 맞는 종목만 보여 준다 (한글·영문 이름, 티커 — 대소문자·띄어쓰기 무시)
  const shown = useMemo(() => {
    const q = norm(query);
    if (!q) return ranked;
    return ranked.filter(({ row }) => [row.asset.name, row.asset.ticker, assetPrimary(row.asset), assetSecondary(row.asset)].some((v) => norm(v ?? '').includes(q)));
  }, [ranked, query]);
  const marketLabel = MARKETS.find((m) => m.key === market)?.label ?? '';
  const missingShown = (data?.missing ?? []).filter((m) => m.status === 'missing' && inMarket(m.ticker, market)).length;

  const counts = useMemo(() => {
    const c: Record<DivStatus, number> = { up: 0, flat: 0, down: 0, missed: 0, new: 0 };
    for (const { row } of ranked) c[row.metrics.status] += 1;
    return c;
  }, [ranked]);
  const changes = useMemo(() => changesOf(rows), [rows]);
  const missingAll = data?.missing ?? [];
  const selectedRow = rows.find((r) => r.asset_id === selected) ?? null;

  const recompute = async () => {
    if (!data) return;
    if (!(await askConfirm(`${monthLabel(data.month)} 점수를 지우고 지금 데이터로 다시 계산할까요?${data.current ? '' : '\n지난 달은 다시 계산하면 추정으로 표시됩니다.'}`, { confirmText: '다시 계산', danger: false }))) return;
    setBusy(true);
    try {
      await apiClient.RecomputeDividendScore(data.month);
      await load(data.month);
      setNotice(`${monthLabel(data.month)} 점수를 다시 계산했습니다.`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || rows.length === 0) return;
    e.preventDefault();
    const ids = [SUMMARY, ...shown.map(({ row }) => row.asset_id)];
    const i = Math.max(0, ids.indexOf(selected ?? SUMMARY));
    const next = ids[e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1)];
    setSelected(next);
    rowRefs.current.get(next)?.focus();
  };

  const lead = (
    <span
      className="text-zinc-500"
      title={'보유 종목의 주당 배당 이력(시장, 없으면 내 기록)과 주가로 매달 1일 0시 기준 점수를 매깁니다.\n규칙으로 계산한 참고 지표이며 투자 권유가 아닙니다.'}
      aria-label="안내"
    >
      <Info className="h-4 w-4" />
    </span>
  );

  const list = (
    <>
      <div className="shrink-0 space-y-2 border-b border-white/[0.07] p-3 sm:p-4">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <span key={s} className={`badge !py-0.5 text-[11px] ${STATUS_META[s].cls}`} title={STATUS_META[s].hint}>
              {STATUS_META[s].label} <span className="num ml-0.5 font-semibold">{counts[s]}</span>
            </span>
          ))}
          {missingShown > 0 && <span className="badge !py-0.5 text-[11px] bg-amber-500/10 text-amber-200">기록 누락 {missingShown}</span>}
        </div>
        {data && (
          <p className="label-mono">
            {monthLabel(data.month)} 1일 기준 · 배당주 {rows.length}종목{market !== 'all' ? ` 중 ${marketLabel} ${ranked.length}` : ''}
            {data.no_dividend.length > 0 ? ` · 배당 없음 ${data.no_dividend.length}` : ''}
          </p>
        )}
        {rows.length > 1 && (
          <div className="flex items-center gap-2">
            <div className="glass-pill inline-flex shrink-0 p-0.5" role="radiogroup" aria-label="시장">
              {MARKETS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={market === o.key}
                  onClick={() => setMarket(o.key)}
                  title={o.key === 'all' ? '모든 종목' : `${o.label} 종목만 — 그 안에서 순위를 다시 매긴다`}
                  className={`pill-item !px-2.5 !py-0.5 !text-[11px] ${market === o.key ? 'pill-item-active' : ''}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="종목명·티커 검색"
                aria-label="종목 검색"
                className="input-field !py-1 !pl-8 !pr-7 !text-xs"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white" aria-label="검색어 지우기">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
        {rows.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="label-mono shrink-0">정렬</span>
            <div className="glass-pill inline-flex min-w-0 flex-wrap p-0.5" role="radiogroup" aria-label="순위 정렬 기준">
              {SORTS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={sortKey === o.key}
                  onClick={() => setSortKey(o.key)}
                  title={o.key === 'total' ? '종합 점수 순' : `${PART_LABEL[o.key]} 점수 순`}
                  className={`pill-item !px-2.5 !py-0.5 !text-[11px] ${sortKey === o.key ? 'pill-item-active' : ''}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onKeyDown} role="listbox" aria-label="배당 점수 순위">
        <button
          ref={(el) => {
            if (el) rowRefs.current.set(SUMMARY, el);
          }}
          type="button"
          role="option"
          aria-selected={selected === SUMMARY}
          onClick={() => setSelected(SUMMARY)}
          className={`flex w-full items-center gap-3 border-b border-white/[0.06] px-4 py-3 text-left transition-colors ${
            selected === SUMMARY ? 'bg-mint-400/[0.08] shadow-[inset_3px_0_0_rgb(var(--c-mint-400))]' : 'hover:bg-white/[0.03]'
          }`}
        >
          <CardIcon icon={IconPodium} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-zinc-100">{data ? `${Number(data.month.slice(5))}월` : ''} 요약</span>
            <span className="label-mono mt-0.5 block truncate">눈여겨볼 변화 · 기록 누락 · 배점</span>
          </span>
          {changes.length > 0 && <span className="num shrink-0 text-xs text-amber-300">{changes.length}</span>}
        </button>
        {shown.length > 0 && (
          <div aria-hidden className="label-mono sticky top-0 z-10 flex items-center gap-3 border-b border-white/[0.06] bg-ink-900/95 px-4 py-1.5 backdrop-blur">
            <span className="w-9 shrink-0 text-center">순위</span>
            <span className="min-w-0 flex-1">종목 · 배당</span>
            <span className="w-10 shrink-0 text-center">지난달</span>
            <span className="w-12 shrink-0 text-right" title={sortKey === 'total' ? undefined : `${PART_LABEL[sortKey]} 점수 (배점 ${partPoints(sortKey, rows[0].parts, data!.weights).max.toFixed(0)}점 만점)`}>
              {sortKey === 'total' ? '점수' : `${PART_SHORT[sortKey]}/${partPoints(sortKey, rows[0].parts, data!.weights).max.toFixed(0)}`}
            </span>
          </div>
        )}
        {shown.map(({ row: r, rank, prev }) => {
          const active = r.asset_id === selected;
          const first = tickerFirst(r.asset);
          const st = STATUS_META[r.metrics.status];
          const byPart = sortKey !== 'total';
          const fill = byPart ? r.parts[sortKey] * 100 : r.score;
          const value = byPart ? partPoints(sortKey, r.parts, data!.weights).got : r.score;
          return (
            <button
              key={r.asset_id}
              ref={(el) => {
                if (el) rowRefs.current.set(r.asset_id, el);
                else rowRefs.current.delete(r.asset_id);
              }}
              type="button"
              role="option"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(r.asset_id)}
              className={`flex w-full scroll-mt-8 items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 text-left transition-colors ${
                active ? 'bg-mint-400/[0.08] shadow-[inset_3px_0_0_rgb(var(--c-mint-400))]' : 'hover:bg-white/[0.03]'
              }`}
            >
              <span className="flex w-9 shrink-0 justify-center">
                <span className={`num inline-flex h-6 min-w-[30px] items-center justify-center rounded-full px-2 text-[13px] font-semibold ${rank <= 3 ? 'bg-mint-400 text-ink-950' : 'bg-white/[0.07] text-zinc-200'}`}>{rank}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className={first ? 'shrink-0 text-[15px] font-semibold tracking-tight text-white' : 'truncate text-[14px] text-zinc-100'}>{assetPrimary(r.asset)}</span>
                  <span className={`truncate text-[11px] text-zinc-500 ${first ? '' : 'font-mono'}`}>{assetSecondary(r.asset)}</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className={`badge !px-1.5 !py-0 text-[10px] ${st.cls}`}>{st.label}</span>
                  {r.missing_count > 0 && <span className="text-[10px] text-amber-300">기록 누락 {r.missing_count}</span>}
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <span className="block h-full rounded-full bg-mint-400/70" style={{ width: `${fill}%` }} />
                  </span>
                </span>
              </span>
              <span className="flex w-10 shrink-0 justify-center">
                <RankChange rank={rank} prev={prev} />
              </span>
              <span className="num w-12 shrink-0 text-right text-[15px] text-white" title={byPart ? `종합 ${r.score.toFixed(1)}점 · ${r.rank}위` : undefined}>
                {value.toFixed(1)}
              </span>
            </button>
          );
        })}
        {rows.length === 0 && !loading && <p className="px-4 py-10 text-center text-sm text-zinc-400">배당을 주는 보유 종목이 없습니다.</p>}
        {rows.length > 0 && shown.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-zinc-400">{query ? `"${query}" 검색 결과가 없습니다${market !== 'all' ? ` (${marketLabel} 종목 중)` : ''}.` : `${marketLabel} 종목이 없습니다.`}</p>
        )}
      </div>
    </>
  );

  const summary = data && (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-white/[0.07] p-4 sm:p-5">
        <h2 className="section-title text-lg">{monthLabel(data.month)} 배당 점수</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          보유 종목을 매달 1일 0시 기준으로 매긴 순위입니다. {data.current ? '이번 달 점수는 처음 볼 때 계산해 저장합니다.' : ''} 지난 달 중 앱이 그달에 계산하지 못한 달은 지금 데이터로 거슬러 계산한 <b className="font-medium text-zinc-300">추정</b>입니다. 규칙으로 계산한 참고 지표이며 투자 권유가 아닙니다.
        </p>
      </div>
      <div className="border-b border-white/[0.07] p-4 sm:p-5">
        <p className="label-mono mb-1.5">눈여겨볼 변화 · 지난달 대비</p>
        {changes.length === 0 ? (
          <p className="py-3 text-xs text-zinc-500">지난달과 비교해 크게 바뀐 종목이 없습니다.</p>
        ) : (
          <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
            {changes.map((c, i) => (
              <button key={i} type="button" onClick={() => setSelected(c.row.asset_id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/[0.03]">
                <span className="truncate text-[13px] text-zinc-100">
                  {assetPrimary(c.row.asset)} <span className="text-[11px] text-zinc-500">{c.row.rank}위 · {c.row.score.toFixed(1)}점</span>
                </span>
                <span className={`shrink-0 text-[12px] ${c.tone}`}>{c.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {data.current && (
        <div className="border-b border-white/[0.07] p-4 sm:p-5">
          <p className="label-mono mb-1.5">내 배당 기록에 없는 회차 · 최근 12개월 (시장 배당락일에 보유 중이었던 회차)</p>
          {missingAll.length === 0 ? <p className="py-3 text-xs text-zinc-500">빠진 회차가 없습니다.</p> : <MissingList items={missingAll} onRecord={setRecord} />}
        </div>
      )}
      <div className="p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="label-mono">배점</p>
          <button type="button" className="text-xs text-mint-300 hover:underline" onClick={() => setSettings(true)}>
            바꾸기
          </button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-300">
          {PART_KEYS.map((k) => (
            <span key={k} className="num">
              {PART_LABEL[k]} <span className="text-white">{data.weights[k]}</span>
            </span>
          ))}
        </div>
        {data.no_dividend.length > 0 && (
          <p className="mt-4 text-[11px] text-zinc-500">배당이 없어 순위에서 뺀 보유 종목: {data.no_dividend.map((a) => assetPrimary(a)).join(', ')}</p>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <PageActions lead={lead}>
        {data && (
          <select value={data.month} onChange={(e) => setMonth(e.target.value)} className="input-field !w-auto !py-1.5 text-sm" aria-label="기준 달">
            {data.months.map((m, i) => (
              <option key={m} value={m}>
                {monthLabel(m)}
                {i === 0 ? ' (이번 달)' : ''}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn-icon !h-9 !w-9" onClick={recompute} disabled={busy || !data} aria-label="다시 계산" title="이 달 점수를 지금 데이터로 다시 계산">
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        </button>
        <button type="button" className="btn-ghost !py-1.5" onClick={() => setSettings(true)} disabled={!data}>
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">배점</span>
        </button>
      </PageActions>

      {error && <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {notice && <div className="mb-4 rounded-2xl border border-mint-400/30 bg-mint-400/10 px-4 py-2.5 text-sm text-mint-100">{notice}</div>}

      {loading ? (
        <div className="surface flex h-[calc(100vh_-_var(--app-header-h,56px)_-_3rem)] min-h-[520px] items-center justify-center text-sm text-zinc-500">
          처음에는 보유 종목의 배당 이력과 주가를 받아 지난 12개월 점수를 계산합니다…
        </div>
      ) : data ? (
        <SplitView
          onSplitChange={setSplit}
          showDetail={selected != null}
          onBack={() => setSelected(null)}
          listWidth={400}
          list={list}
          detail={
            selected === SUMMARY ? (
              summary
            ) : selectedRow ? (
              <ScoreDetail
                key={`${selectedRow.asset_id}-${data.month}`}
                row={selectedRow}
                total={rows.length}
                weights={data.weights}
                missing={data.current ? missingAll.filter((m) => m.asset_id === selectedRow.asset_id) : []}
                onRecord={setRecord}
              />
            ) : (
              <p className="py-16 text-center text-sm text-zinc-400">왼쪽에서 종목을 고르세요.</p>
            )
          }
        />
      ) : null}

      {settings && data && (
        <ScoreSettings
          initial={data.weights}
          onClose={() => setSettings(false)}
          onSaved={() => {
            setSettings(false);
            setNotice('배점을 바꿨습니다. 지난 달 순위도 같은 기준으로 다시 매겼습니다.');
            load(data.month);
          }}
        />
      )}
      {record && (
        <RecordMissingModal
          item={record}
          onClose={() => setRecord(null)}
          onSaved={(msg) => {
            setRecord(null);
            setNotice(msg);
            if (data) load(data.month);
          }}
        />
      )}
    </div>
  );
}
