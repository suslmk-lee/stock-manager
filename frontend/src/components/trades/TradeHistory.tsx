import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { Transaction } from '../../types/models';
import { assetPrimary, assetSecondary } from '../../utils/assetLabel';
import { ccyOfTicker, fmtCcy, loadFxRates, toKRW, type FxRates } from '../../utils/fx';

/**
 * 매매 기록 — 거래 내역.
 * 위: 최근 12개월 월별 매수·매도 막대 (막대를 누르면 그 달만 본다)
 * 아래: 종목별 묶음(기본, 누르면 그 종목 거래가 펼쳐짐) 또는 날짜순 목록
 */
interface TradeHistoryProps {
  transactions: Transaction[];
  /** 거래 한 건을 눌렀을 때 (상세·수정 창) */
  onOpen: (tx: Transaction) => void;
}

type View = 'asset' | 'date';
const VIEW_KEY = 'sm-trade-history-view';
const SHOW_STEP = 20; // 펼친 종목에서 한 번에 보여 줄 거래 수

// 종목 통화 (.KS·.KQ 원화, .T 엔화 … 그 밖은 달러)
const cur = (tx: Transaction) => ccyOfTicker(tx.asset?.ticker);
const money = (v: number, ccy: string) => fmtCcy(v, ccy);
const qtyText = (q: number) => `${q.toLocaleString('ko-KR', { maximumFractionDigits: 6 })}주`;
/** 거래 금액 (매수는 수수료 포함 지불액, 매도는 수수료 뺀 수령액) */
const amountOf = (tx: Transaction) => tx.price * tx.quantity + (tx.type === 'Buy' ? tx.fee : -tx.fee);
const monthKey = (d: string) => d.slice(0, 7);
const shortDate = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const W = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (d: string) => {
  const t = new Date(`${d.slice(0, 10)}T00:00:00`);
  return `${t.getMonth() + 1}.${t.getDate()} ${W[t.getDay()]}`;
};
const won = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만` : `${Math.round(v).toLocaleString('ko-KR')}`);

function SidePill({ buy, children }: { buy: boolean; children?: ReactNode }) {
  return (
    <span className={`badge shrink-0 !py-0 ${buy ? 'bg-mint-400/15 text-mint-300' : 'bg-rose-500/10 text-rose-300'}`}>{children ?? (buy ? '매수' : '매도')}</span>
  );
}

// ───────────────────────── 월별 막대 ─────────────────────────

function MonthlyBars({ txs, rates, month, onMonth }: { txs: Transaction[]; rates: FxRates; month: string | null; onMonth: (m: string | null) => void }) {
  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }, []);
  const data = useMemo(() => {
    const m = new Map(months.map((k) => [k, { buy: 0, sell: 0, n: 0 }]));
    for (const tx of txs) {
      const row = m.get(monthKey(tx.date));
      if (!row) continue;
      const krw = toKRW(amountOf(tx), cur(tx), rates);
      if (tx.type === 'Buy') row.buy += krw;
      else row.sell += krw;
      row.n += 1;
    }
    return months.map((k) => ({ key: k, ...m.get(k)! }));
  }, [txs, months, rates]);
  const max = Math.max(1, ...data.map((d) => Math.max(d.buy, d.sell)));
  const sel = data.find((d) => d.key === month);

  return (
    <section className="surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="section-title">월별 매매</h3>
          <span className="label-mono">최근 12개월 · 원화 환산</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          {sel ? (
            <>
              <span>
                {Number(sel.key.slice(5))}월 {sel.n}건 · 매수 <b className="font-medium text-mint-300">₩{won(sel.buy)}</b> · 매도 <b className="font-medium text-rose-300">₩{won(sel.sell)}</b>
              </span>
              <button type="button" onClick={() => onMonth(null)} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-zinc-300 hover:text-white">
                <X className="h-3 w-3" />
                전체 보기
              </button>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-sm bg-mint-400" />
                매수
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-sm bg-rose-400" />
                매도
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-end gap-1 sm:gap-2" role="group" aria-label="월별 매매 막대 (누르면 그 달만 보기)">
        {data.map((d) => {
          const on = d.key === month;
          const m = Number(d.key.slice(5));
          const label = m === 1 ? `${d.key.slice(2, 4)}.1` : `${m}월`;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onMonth(on ? null : d.key)}
              disabled={d.n === 0}
              aria-pressed={on}
              title={`${d.key.slice(0, 4)}년 ${m}월 · ${d.n}건\n매수 ₩${Math.round(d.buy).toLocaleString('ko-KR')} · 매도 ₩${Math.round(d.sell).toLocaleString('ko-KR')}`}
              className={`flex flex-1 flex-col items-center rounded-xl px-0.5 pb-1.5 pt-2 transition-colors disabled:cursor-default ${on ? 'bg-mint-400/15' : 'enabled:hover:bg-white/[0.04]'}`}
            >
              <span className="flex h-24 items-end justify-center gap-[3px]">
                <span className="w-2.5 rounded-t-[3px] bg-mint-400 sm:w-3" style={{ height: d.buy ? Math.max(3, (d.buy / max) * 96) : 0 }} />
                <span className="w-2.5 rounded-t-[3px] bg-rose-400 sm:w-3" style={{ height: d.sell ? Math.max(3, (d.sell / max) * 96) : 0 }} />
              </span>
              <span className={`mt-1.5 text-[11px] ${on ? 'font-semibold text-mint-300' : d.n ? 'text-zinc-400' : 'text-zinc-600'}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ───────────────────────── 거래 한 줄 ─────────────────────────

function TradeRow({ tx, onOpen, showAsset }: { tx: Transaction; onOpen: (tx: Transaction) => void; showAsset: boolean }) {
  const buy = tx.type === 'Buy';
  const ccy = cur(tx);
  return (
    <button type="button" onClick={() => onOpen(tx)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.04]">
      <span className="num w-12 shrink-0 text-[12.5px] text-zinc-400">{showAsset ? shortDate(tx.date) : dayLabel(tx.date)}</span>
      <SidePill buy={buy} />
      {showAsset ? (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 text-[13.5px] font-medium text-white">{assetPrimary(tx.asset, `#${tx.asset_id}`)}</span>
          <span className="truncate text-xs text-zinc-500">{assetSecondary(tx.asset)}</span>
          {tx.plan_id != null && <span className="badge shrink-0 !py-0 border border-white/10 bg-white/[0.05] text-[10px] text-zinc-300">모으기</span>}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {tx.plan_id != null && <span className="badge shrink-0 !py-0 border border-white/10 bg-white/[0.05] text-[10px] text-zinc-300">모으기</span>}
          {/* 모으기 자동 기록의 기본 메모는 배지와 겹치므로 숨긴다 */}
          {tx.notes && !(tx.plan_id != null && tx.notes === '주식 모으기 자동 기록') && <span className="truncate text-xs text-zinc-500">{tx.notes}</span>}
        </span>
      )}
      <span className="num hidden shrink-0 text-xs text-zinc-500 sm:inline">
        {qtyText(tx.quantity)} × {money(tx.price, ccy)}
        {tx.fee > 0 ? ` · 수수료 ${money(tx.fee, ccy)}` : ''}
      </span>
      <span className={`num w-24 shrink-0 text-right text-[13.5px] font-semibold ${buy ? 'text-mint-300' : 'text-rose-300'}`}>{money(amountOf(tx), ccy)}</span>
    </button>
  );
}

// ───────────────────────── 종목별 묶음 ─────────────────────────

interface Group {
  assetId: number;
  txs: Transaction[]; // 최근부터
  buyN: number;
  sellN: number;
  buySum: number;
  sellSum: number;
  netQty: number;
  hasPlan: boolean;
}

function groupByAsset(txs: Transaction[]): Group[] {
  const m = new Map<number, Group>();
  for (const tx of txs) {
    let g = m.get(tx.asset_id);
    if (!g) {
      g = { assetId: tx.asset_id, txs: [], buyN: 0, sellN: 0, buySum: 0, sellSum: 0, netQty: 0, hasPlan: false };
      m.set(tx.asset_id, g);
    }
    g.txs.push(tx);
    if (tx.type === 'Buy') {
      g.buyN += 1;
      g.buySum += amountOf(tx);
      g.netQty += tx.quantity;
    } else {
      g.sellN += 1;
      g.sellSum += amountOf(tx);
      g.netQty -= tx.quantity;
    }
    if (tx.plan_id != null) g.hasPlan = true;
  }
  return [...m.values()]; // txs 가 이미 최근순이라 그룹도 최근 거래 순
}

function AssetGroup({ g, open, onToggle, onOpen }: { g: Group; open: boolean; onToggle: () => void; onOpen: (tx: Transaction) => void }) {
  const [limit, setLimit] = useState(SHOW_STEP);
  const head = g.txs[0];
  const ccy = cur(head);
  const net = Math.round(g.netQty * 1e6) / 1e6;
  return (
    <div className={`border-b border-white/[0.05] last:border-b-0 ${open ? 'bg-mint-400/[0.04]' : ''}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]">
        <ChevronRight className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14.5px] font-semibold text-white">{assetPrimary(head.asset, `#${g.assetId}`)}</span>
            {g.hasPlan && <span className="badge shrink-0 !py-0 border border-white/10 bg-white/[0.05] text-[10px] text-zinc-300">모으기</span>}
          </span>
          <span className="block truncate text-xs text-zinc-500">{assetSecondary(head.asset)}</span>
        </span>
        <span className="hidden w-32 shrink-0 gap-1 md:flex">
          {g.buyN > 0 && <SidePill buy>매수 {g.buyN}</SidePill>}
          {g.sellN > 0 && <SidePill buy={false}>매도 {g.sellN}</SidePill>}
        </span>
        <span className="num hidden w-28 shrink-0 text-right text-[12.5px] text-zinc-300 sm:block">
          순매수 {net > 0 ? '+' : ''}
          {qtyText(net)}
        </span>
        <span className="num hidden w-16 shrink-0 text-right text-xs text-zinc-500 lg:block">{shortDate(head.date)}</span>
        <span className="num flex w-28 shrink-0 flex-col items-end">
          {g.buyN > 0 && <span className="text-[13.5px] font-semibold text-mint-300">{money(g.buySum, ccy)}</span>}
          {g.sellN > 0 && <span className={`${g.buyN ? 'text-xs' : 'text-[13.5px] font-semibold'} text-rose-300`}>{money(g.sellSum, ccy)}</span>}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/[0.05] pb-1.5 pl-7">
          {g.txs.slice(0, limit).map((tx) => (
            <TradeRow key={tx.id} tx={tx} onOpen={onOpen} showAsset={false} />
          ))}
          {g.txs.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + SHOW_STEP * 5)} className="px-4 py-2 text-xs text-mint-300 hover:underline">
              {g.txs.length - limit}건 더 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 전체 ─────────────────────────

export default function TradeHistory({ transactions, onOpen }: TradeHistoryProps) {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'date' ? 'date' : 'asset';
    } catch {
      return 'asset';
    }
  });
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  // 거래 통화별 원화 환율 (달러는 앱 환율, 엔화 등은 그 통화 환율)
  const [rates, setRates] = useState<FxRates>({ KRW: 1, USD: 1400 });
  const [showPlan, setShowPlan] = useState(false);
  const ccyKey = useMemo(() => Array.from(new Set(transactions.map(cur))).sort().join(','), [transactions]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .GetUSDToKRW()
      .then((v: unknown) => loadFxRates(ccyKey.split(','), typeof v === 'number' && v > 0 ? v : 1400))
      .then((r) => !cancelled && setRates(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ccyKey]);

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // 기억하지 못해도 지금 화면에는 적용된다
    }
  };

  const sorted = useMemo(
    () =>
      [...transactions].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id,
      ),
    [transactions],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((tx) => {
      if (month && monthKey(tx.date) !== month) return false;
      if (!q) return true;
      return `${tx.asset?.ticker ?? ''} ${tx.asset?.name ?? ''} ${tx.notes ?? ''}`.toLowerCase().includes(q);
    });
  }, [sorted, query, month]);
  const groups = useMemo(() => groupByAsset(filtered), [filtered]);
  // 날짜순에서는 주식 모으기 회차를 기본으로 숨긴다 (매일 쌓이면 목록이 넘친다. 종목별에서는 종목 아래에 묶여 있다)
  const planCount = useMemo(() => filtered.filter((tx) => tx.plan_id != null).length, [filtered]);
  const dateRows = useMemo(() => (showPlan ? filtered : filtered.filter((tx) => tx.plan_id == null)), [filtered, showPlan]);

  // 검색·달을 고르면 결과가 적을 때 바로 펼친다
  const autoOpen = (query.trim() !== '' || month !== null) && groups.length <= 3;
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (transactions.length === 0) {
    return (
      <div className="py-12 text-center text-zinc-400">
        <p>거래 내역이 없습니다.</p>
        <p className="mt-1 text-sm text-zinc-500">'거래 기록' 버튼으로 매수/매도를 등록하세요.</p>
      </div>
    );
  }

  // 날짜순: 달이 바뀌는 곳에 달 이름
  let lastMonth = '';
  return (
    <div className="space-y-4">
      <MonthlyBars txs={sorted} rates={rates} month={month} onMonth={setMonth} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="glass-pill inline-flex p-1" role="group" aria-label="보기">
          {(['asset', 'date'] as View[]).map((v) => (
            <button key={v} type="button" onClick={() => changeView(v)} aria-pressed={view === v} className={`pill-item !px-3 !py-1 text-sm ${view === v ? 'pill-item-active' : ''}`}>
              {v === 'asset' ? '종목별' : '날짜순'}
            </button>
          ))}
        </div>
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="종목·메모 검색" aria-label="거래 검색" className="input-field !py-1.5 !pl-8 text-sm" />
        </div>
        {view === 'date' && planCount > 0 && (
          <button type="button" onClick={() => setShowPlan((v) => !v)} aria-pressed={showPlan} className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${showPlan ? 'border-mint-400/40 bg-mint-400/10 text-mint-300' : 'border-white/10 text-zinc-400 hover:text-zinc-200'}`}>
            모으기 회차 {showPlan ? '숨기기' : `보기 ${planCount}`}
          </button>
        )}
        <span className="label-mono">
          {month ? `${Number(month.slice(5))}월 · ` : ''}
          {view === 'asset' ? `종목 ${groups.length}개 · ` : ''}
          {view === 'date' ? dateRows.length : filtered.length}건
        </span>
      </div>

      <div className="surface overflow-hidden !p-0">
        {(view === 'date' ? dateRows : filtered).length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500">조건에 맞는 거래가 없습니다.</p>
        ) : view === 'asset' ? (
          groups.map((g) => <AssetGroup key={g.assetId} g={g} open={autoOpen || open.has(g.assetId)} onToggle={() => toggle(g.assetId)} onOpen={onOpen} />)
        ) : (
          dateRows.map((tx) => {
            const mk = monthKey(tx.date);
            const header = mk !== lastMonth;
            lastMonth = mk;
            return (
              <div key={tx.id}>
                {header && (
                  <p className="label-mono border-b border-white/[0.05] bg-white/[0.02] px-4 py-1.5">
                    {mk.slice(0, 4)}년 {Number(mk.slice(5))}월
                  </p>
                )}
                <TradeRow tx={tx} onOpen={onOpen} showAsset />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
