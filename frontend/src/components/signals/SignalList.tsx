import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Lock, Search, X } from 'lucide-react';
import type { SignalAction, SignalItem, SignalProfile } from '../../types/models';
import { ACTION_META, FILTERS, type FilterValue, fmtNum, fmtSignedPct, signTone } from './SignalCard';
import { assetPrimary, assetSecondary } from '../../utils/assetLabel';

export type SortKey = 'default' | 'name' | 'action' | 'return' | 'weight';
export interface SortState {
  key: SortKey;
  desc: boolean;
}

const ACTION_ORDER: Record<SignalAction, number> = { SELL: 0, CONFLICT: 1, BUY: 2, HOLD: 3, NO_PRICE: 4 };
const SHORT_LABEL: Record<SignalAction, string> = { SELL: '매도', BUY: '매수', CONFLICT: '충돌', HOLD: '관망', NO_PRICE: '시세 없음' };

/** 규칙이 쓰는 수익률 기준(매수 시점 환율 / 현재 환율)과 같은 값 */
export const returnOf = (i: SignalItem) => (i.return_basis === 'fx' && i.total_return_pct_fx !== undefined ? i.total_return_pct_fx : i.total_return_pct);

export function sortItems(items: SignalItem[], sort: SortState): SignalItem[] {
  if (sort.key === 'default') return items;
  const dir = sort.desc ? -1 : 1;
  const cmp: Record<Exclude<SortKey, 'default'>, (a: SignalItem, b: SignalItem) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    action: (a, b) => ACTION_ORDER[a.action] - ACTION_ORDER[b.action],
    return: (a, b) => returnOf(a) - returnOf(b),
    weight: (a, b) => a.weight_pct - b.weight_pct,
  };
  const f = cmp[sort.key];
  return [...items].sort((a, b) => f(a, b) * dir || a.name.localeCompare(b.name, 'ko'));
}

const filterTone: Record<FilterValue, string> = { all: '', SELL: 'text-rose-300', BUY: 'text-mint-300', CONFLICT: 'text-amber-300', HOLD: 'text-zinc-300' };

function MiniRange({ item }: { item: SignalItem }) {
  if (!item.price_history_ok || !item.high_52w || !item.low_52w || item.high_52w <= item.low_52w) return null;
  const pos = Math.max(0, Math.min(100, ((item.current_price - item.low_52w) / (item.high_52w - item.low_52w)) * 100));
  return (
    <span className="relative inline-block h-1 w-10 shrink-0 rounded-full bg-white/[0.08]" title={`52주 범위에서 ${fmtNum(pos, 0)}% 위치`}>
      <span className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 rounded-full bg-sky-300" style={{ left: `${pos}%` }} />
    </span>
  );
}

function MetCount({ met, total, tone }: { met: number; total: number; tone: 'sell' | 'buy' }) {
  if (total === 0) return <span className="text-zinc-700">–</span>;
  const on = met > 0 ? (tone === 'sell' ? 'text-rose-300' : 'text-mint-300') : 'text-zinc-600';
  return (
    <span className={on}>
      {met}/{total}
    </span>
  );
}

interface SignalListProps {
  items: SignalItem[];
  counts: Record<FilterValue, number>;
  filter: FilterValue;
  onFilter: (f: FilterValue) => void;
  query: string;
  onQuery: (q: string) => void;
  profiles: SignalProfile[] | null;
  profileFilter: number | 'all';
  onProfileFilter: (p: number | 'all') => void;
  sort: SortState;
  onSort: (s: SortState) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  flashId?: number | null;
  noPriceCount?: number;
  emptyText: string;
}

/** 매매 신호 종목 표 (정렬, 필터, ↑↓ 키 이동) */
export default function SignalList({
  items,
  counts,
  filter,
  onFilter,
  query,
  onQuery,
  profiles,
  profileFilter,
  onProfileFilter,
  sort,
  onSort,
  selectedId,
  onSelect,
  flashId,
  noPriceCount = 0,
  emptyText,
}: SignalListProps) {
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    if (selectedId == null) return;
    rowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (items.length === 0) return;
    e.preventDefault();
    const idx = items.findIndex((i) => i.asset_id === selectedId);
    const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
    onSelect(items[next].asset_id);
    rowRefs.current.get(items[next].asset_id)?.focus();
  };

  const header = (key: Exclude<SortKey, 'default'>, label: string, align: 'left' | 'right' = 'right') => {
    const active = sort.key === key;
    const Icon = sort.desc ? ArrowDown : ArrowUp;
    // 숫자 열은 큰 값부터, 이름은 가나다순부터 시작하고 세 번째 누르면 기본 순서로 돌아간다
    const firstDesc = key !== 'name';
    const next = (): SortState => {
      if (!active) return { key, desc: firstDesc };
      if (sort.desc === firstDesc) return { key, desc: !firstDesc };
      return { key: 'default', desc: false };
    };
    return (
      <button
        type="button"
        onClick={() => onSort(next())}
        className={`inline-flex items-center gap-0.5 transition-colors hover:text-zinc-200 ${active ? 'text-zinc-200' : ''} ${align === 'right' ? 'justify-self-end' : ''}`}
        aria-label={`${label} 기준 정렬`}
      >
        {label}
        {active && <Icon className="h-3 w-3" />}
      </button>
    );
  };

  return (
    <>
      <div className="shrink-0 space-y-2.5 border-b border-white/[0.07] p-3 sm:p-4">
        <div className="glass-pill flex w-full overflow-x-auto p-1 scrollbar-hide" role="group" aria-label="신호 필터">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onFilter(f.value)}
              className={`pill-item flex-1 !px-2.5 ${filter === f.value ? 'pill-item-active' : ''}`}
              aria-pressed={filter === f.value}
            >
              {f.label} <span className={`num font-semibold ${filterTone[f.value]}`}>{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="종목명·티커 검색"
              aria-label="종목 검색"
              className="input-field !py-1.5 !pl-8 !pr-8 text-sm"
            />
            {query && (
              <button type="button" onClick={() => onQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white" aria-label="검색어 지우기">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {profiles && profiles.length > 0 && (
            <select
              aria-label="전략 프로필 필터"
              className="input-field !w-auto max-w-[45%] !py-1.5 text-xs"
              value={profileFilter}
              onChange={(e) => onProfileFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <option value="all">프로필: 전체</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_72px_62px_50px_60px] items-center gap-2 border-b border-white/[0.07] px-4 py-2 font-mono text-[10.5px] tracking-wide text-zinc-500">
        {header('name', '종목', 'left')}
        {header('action', '신호')}
        {header('return', '수익률')}
        {header('weight', '비중')}
        <span className="justify-self-end" title="충족한 조건 수 (매도 · 매수)">
          충족
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onKeyDown} role="listbox" aria-label="종목 목록">
        {items.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-400">{emptyText}</p>
        ) : (
          items.map((item) => {
            const active = item.asset_id === selectedId;
            const meta = ACTION_META[item.action];
            const sellMet = item.sell_checks.filter((c) => c.met).length;
            const buyMet = item.buy_checks.filter((c) => c.met).length;
            const ret = returnOf(item);
            return (
              <button
                key={item.asset_id}
                id={`signal-row-${item.asset_id}`}
                ref={(el) => {
                  if (el) rowRefs.current.set(item.asset_id, el);
                  else rowRefs.current.delete(item.asset_id);
                }}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={active || (selectedId == null && item === items[0]) ? 0 : -1}
                onClick={() => onSelect(item.asset_id)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_72px_62px_50px_60px] items-center gap-2 border-b border-white/[0.04] px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-mint-400/60 ${
                  active ? 'bg-mint-400/[0.08] shadow-[inset_3px_0_0_rgb(var(--c-mint-400))]' : 'hover:bg-white/[0.03]'
                } ${flashId === item.asset_id ? 'focus-flash' : ''}`}
              >
                <span className="min-w-0">
                  <span className={`flex items-center gap-1.5 truncate text-[13px] ${active ? 'font-medium text-white' : 'text-zinc-100'}`}>
                    <span className="truncate">{assetPrimary(item)}</span>
                    {item.restricted_only && <Lock className="h-3 w-3 shrink-0 text-amber-300" aria-label="연금·IRP" />}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="truncate font-mono text-[10.5px] text-zinc-500">{assetSecondary(item)}</span>
                    <MiniRange item={item} />
                  </span>
                </span>
                <span className="justify-self-end">
                  <span className={`badge whitespace-nowrap ${meta.badge}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {SHORT_LABEL[item.action]}
                  </span>
                </span>
                <span className={`num justify-self-end text-[13px] ${item.action === 'NO_PRICE' ? 'text-zinc-600' : signTone(ret)}`}>
                  {item.action === 'NO_PRICE' ? '—' : fmtSignedPct(ret)}
                </span>
                <span className="num justify-self-end text-[13px] text-zinc-300">{fmtNum(item.weight_pct, 1)}%</span>
                <span className="num justify-self-end whitespace-nowrap font-mono text-[11px]" title="충족한 조건 수 (매도 · 매수)">
                  <MetCount met={sellMet} total={item.sell_checks.length} tone="sell" />
                  <span className="text-zinc-700">·</span>
                  <MetCount met={buyMet} total={item.buy_checks.length} tone="buy" />
                </span>
              </button>
            );
          })
        )}
        {noPriceCount > 0 && filter !== 'all' && (
          <p className="label-mono px-4 py-3">시세를 가져오지 못한 종목 {noPriceCount}개는 전체 보기에서만 표시됩니다.</p>
        )}
      </div>
    </>
  );
}
