import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Loader2, Search, Sparkles } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { ProfileCandidate, SignalAction, SignalItem, SignalProfile } from '../../types/models';

// 대시보드 신호 배지와 같은 색 (SignalsDashboard ACTION_META 와 동일하게 유지)
const ACTION_BADGE: Record<SignalAction, { label: string; badge: string }> = {
  SELL: { label: '매도 검토', badge: 'border border-rose-400/30 bg-rose-500/10 text-rose-200' },
  BUY: { label: '매수 검토', badge: 'border border-mint-400/30 bg-mint-400/10 text-mint-300' },
  CONFLICT: { label: '신호 충돌', badge: 'border border-amber-400/30 bg-amber-400/10 text-amber-200' },
  HOLD: { label: '관망', badge: 'border border-white/10 bg-white/[0.05] text-zinc-300' },
  NO_PRICE: { label: '시세 없음', badge: 'border border-white/10 bg-white/[0.04] text-zinc-500' },
};

// 필터: 전체 | 프로필 id | 개별 전략
export type AssignFilter = 'all' | 'override' | number;

type SortKey = 'name' | 'yield' | 'profile';

interface Props {
  items: SignalItem[];
  profiles: SignalProfile[];
  profileIdOf: (assetId: number) => number;
  initialFilter: AssignFilter;
  // 배정 적용 (낙관적 갱신/롤백/변경 표시는 부모가 처리). 실패 시 throw.
  onAssign: (profileId: number, assetIds: number[]) => Promise<void>;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : typeof err === 'string' && err ? err : fallback;
}

export default function ProfileAssignmentTable({ items, profiles, profileIdOf, initialFilter, onAssign }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AssignFilter>(initialFilter);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<number>(0);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<ProfileCandidate[]>([]);
  const [candLoading, setCandLoading] = useState(true);
  const [candError, setCandError] = useState<string | null>(null);
  const [confirmRec, setConfirmRec] = useState(false);

  useEffect(() => setFilter(initialFilter), [initialFilter]);

  useEffect(() => {
    let alive = true;
    apiClient
      .GetProfileCandidates()
      .then((r) => alive && setCandidates(r.candidates ?? []))
      .catch((err) => {
        console.error('Failed to load candidates:', err);
        if (alive) setCandError(errMsg(err, '추천 정보를 불러오지 못했습니다.'));
      })
      .finally(() => alive && setCandLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const dividendProfile = profiles.find((p) => p.key === 'dividend');
  const candById = useMemo(() => new Map(candidates.map((c) => [c.asset_id, c])), [candidates]);
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  // 현재 배정 기준 프로필별 종목 수
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    items.forEach((i) => {
      const pid = profileIdOf(i.asset_id);
      m.set(pid, (m.get(pid) ?? 0) + 1);
    });
    return m;
  }, [items, profileIdOf]);
  const overrideCount = useMemo(() => items.filter((i) => i.rule_source === 'asset').length, [items]);

  // 추천대로 일괄 적용 대상: 후보이면서 아직 배당 프로필이 아닌 보유 종목
  const heldIds = useMemo(() => new Set(items.map((i) => i.asset_id)), [items]);
  const recCandidates = useMemo(() => candidates.filter((c) => c.is_candidate && heldIds.has(c.asset_id)), [candidates, heldIds]);
  const recTargets = useMemo(
    () => recCandidates.filter((c) => profileIdOf(c.asset_id) !== dividendProfile?.id).map((c) => c.asset_id),
    [recCandidates, profileIdOf, dividendProfile?.id],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((i) => {
      if (q && !i.name.toLowerCase().includes(q) && !i.ticker.toLowerCase().includes(q)) return false;
      if (filter === 'override') return i.rule_source === 'asset';
      if (filter !== 'all') return profileIdOf(i.asset_id) === filter;
      return true;
    });
    const sign = sort.dir === 'asc' ? 1 : -1;
    const pname = (i: SignalItem) => profileById.get(profileIdOf(i.asset_id))?.name ?? '';
    return list.sort((a, b) => {
      let r = 0;
      if (sort.key === 'name') r = a.name.localeCompare(b.name, 'ko');
      else if (sort.key === 'yield') r = (a.current_yield_pct ?? 0) - (b.current_yield_pct ?? 0);
      else r = pname(a).localeCompare(pname(b), 'ko');
      return r * sign || a.name.localeCompare(b.name, 'ko');
    });
  }, [items, query, filter, sort, profileIdOf, profileById]);

  const checkedRows = rows.filter((r) => checked.has(r.asset_id));
  const allChecked = rows.length > 0 && checkedRows.length === rows.length;

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'yield' ? 'desc' : 'asc' }));

  const toggleAll = () =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (allChecked) rows.forEach((r) => next.delete(r.asset_id));
      else rows.forEach((r) => next.add(r.asset_id));
      return next;
    });
  const toggleOne = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const assignOne = async (assetId: number, profileId: number) => {
    setError(null);
    setMessage(null);
    setSavingIds((s) => new Set(s).add(assetId));
    try {
      await onAssign(profileId, [assetId]);
    } catch (err) {
      setError(errMsg(err, '프로필을 지정하지 못했습니다. 이전 값으로 되돌렸습니다.'));
    } finally {
      setSavingIds((s) => {
        const next = new Set(s);
        next.delete(assetId);
        return next;
      });
    }
  };

  const assignBulk = async (profileId: number, ids: number[], done: string) => {
    if (ids.length === 0) return;
    setError(null);
    setMessage(null);
    setBulkBusy(true);
    try {
      await onAssign(profileId, ids);
      setMessage(done);
      return true;
    } catch (err) {
      setError(errMsg(err, '프로필을 지정하지 못했습니다. 이전 값으로 되돌렸습니다.'));
      return false;
    } finally {
      setBulkBusy(false);
    }
  };

  const applyBulk = async () => {
    const target = profileById.get(bulkTarget);
    if (!target) return;
    const ids = checkedRows.map((r) => r.asset_id);
    if (await assignBulk(target.id, ids, `${ids.length}개 종목을 '${target.name}' 프로필로 지정했습니다.`)) setChecked(new Set());
  };

  const applyRecommend = async () => {
    if (!dividendProfile) return;
    setConfirmRec(false);
    await assignBulk(dividendProfile.id, recTargets, `추천 ${recTargets.length}개 종목을 '${dividendProfile.name}' 프로필로 지정했습니다.`);
  };

  // 컴포넌트가 아닌 렌더 함수로 둔다 (렌더마다 새 컴포넌트가 되어 포커스를 잃지 않도록)
  const sortHead = (k: SortKey, label: string, className = '') => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th className={`whitespace-nowrap px-3 py-2 font-medium ${className}`} key={k} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 transition-colors hover:text-white ${active ? 'text-white' : ''}`}>
          {label}
          <Icon className={`h-3 w-3 ${active ? '' : 'opacity-40'}`} />
        </button>
      </th>
    );
  };

  const pill = (active: boolean) => `pill-item !px-3 !py-1 !text-xs whitespace-nowrap ${active ? 'pill-item-active' : ''}`;

  if (items.length === 0) {
    return <p className="surface-inset px-4 py-10 text-center text-sm text-zinc-500">보유 중인 종목이 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {/* 추천 */}
      {!candError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-400/25 bg-sky-400/[0.06] px-4 py-2.5">
          {candLoading ? (
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              추천 계산 중…
            </span>
          ) : confirmRec ? (
            <>
              <p className="text-sm text-sky-100">
                추천 {recTargets.length}개 종목을 '{dividendProfile?.name}' 프로필로 지정합니다. 개별 전략이 있는 종목은 개별 전략이 우선합니다.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => setConfirmRec(false)}>취소</button>
                <button type="button" className="btn-primary !px-3 !py-1 !text-xs" disabled={bulkBusy} onClick={applyRecommend}>적용</button>
              </div>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm text-sky-100">
                <Sparkles className="h-4 w-4 text-sky-300" />
                배당 후보 추천 <span className="num font-medium">{recCandidates.length}</span>개
                {recCandidates.length > 0 && <span className="text-xs text-zinc-400">· 미적용 {recTargets.length}개</span>}
              </p>
              <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" disabled={bulkBusy || recTargets.length === 0 || !dividendProfile} onClick={() => setConfirmRec(true)}>
                추천대로 일괄 적용
              </button>
            </>
          )}
        </div>
      )}

      {/* 툴바 */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input className="input-field !pl-9" placeholder="종목명 또는 티커 검색" aria-label="종목 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="프로필 필터">
          <button type="button" className={pill(filter === 'all')} onClick={() => setFilter('all')}>
            전체 <span className="num">{items.length}</span>
          </button>
          {profiles.map((p) => (
            <button key={p.id} type="button" className={pill(filter === p.id)} onClick={() => setFilter(p.id)}>
              {p.name} <span className="num">{counts.get(p.id) ?? 0}</span>
            </button>
          ))}
          <button type="button" className={pill(filter === 'override')} onClick={() => setFilter('override')}>
            개별 전략 <span className="num">{overrideCount}</span>
          </button>
        </div>
      </div>

      {/* 일괄 지정 */}
      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-mint-400/25 bg-mint-400/[0.06] px-4 py-2">
          <span className="text-sm text-white">
            <span className="num">{checkedRows.length}</span>개 선택
          </span>
          <select aria-label="일괄 지정할 프로필" className="input-field !w-auto !py-1" value={bulkTarget} onChange={(e) => setBulkTarget(Number(e.target.value))}>
            <option value={0}>프로필 선택…</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button type="button" className="btn-primary !px-3 !py-1 !text-xs" disabled={bulkBusy || !bulkTarget || checkedRows.length === 0} onClick={applyBulk}>
            {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}로 일괄 지정
          </button>
          <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => setChecked(new Set())}>선택 해제</button>
        </div>
      )}

      {error && <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</div>}
      {message && !error && (
        <div className="flex items-center gap-1.5 text-xs text-mint-300">
          <Check className="h-3.5 w-3.5" />
          {message}
        </div>
      )}

      {/* 표 */}
      <div className="surface-inset max-h-[56vh] min-h-[16rem] overflow-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-900/95 text-xs text-zinc-400 backdrop-blur">
            <tr>
              <th className="w-9 px-3 py-2">
                <input type="checkbox" className="h-4 w-4 cursor-pointer accent-mint-400" checked={allChecked} onChange={toggleAll} aria-label="표시된 종목 전체 선택" disabled={rows.length === 0} />
              </th>
              {sortHead('name', '종목')}
              <th className="whitespace-nowrap px-3 py-2 font-medium">현재 신호</th>
              {sortHead('yield', '배당수익률', 'text-right [&>button]:flex-row-reverse')}
              <th className="whitespace-nowrap px-3 py-2 font-medium">추천</th>
              {sortHead('profile', '프로필')}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-500">조건에 맞는 종목이 없습니다.</td>
              </tr>
            ) : (
              rows.map((i) => {
                const pid = profileIdOf(i.asset_id);
                const cand = candById.get(i.asset_id);
                const meta = ACTION_BADGE[i.action] ?? ACTION_BADGE.HOLD;
                const saving = savingIds.has(i.asset_id);
                return (
                  <tr key={i.asset_id} className={`border-t border-white/[0.05] ${checked.has(i.asset_id) ? 'bg-mint-400/[0.05]' : 'hover:bg-white/[0.03]'}`}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-mint-400" checked={checked.has(i.asset_id)} onChange={() => toggleOne(i.asset_id)} aria-label={`${i.name} 선택`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex min-w-0 max-w-[12rem] items-baseline gap-2 2xl:max-w-[20rem]" title={`${i.name} (${i.ticker})`}>
                        <span className="truncate text-zinc-100">{i.name}</span>
                        <span className="label-mono shrink-0">{i.ticker}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`badge !text-[11px] ${meta.badge}`}>{meta.label}</span>
                    </td>
                    <td className="num px-3 py-1.5 text-right text-zinc-300">{i.current_yield_pct > 0 ? `${i.current_yield_pct.toFixed(1)}%` : '—'}</td>
                    <td className="px-3 py-1.5">
                      {cand?.is_candidate ? (
                        <span className="badge border border-sky-400/30 bg-sky-400/10 text-sky-200">
                          배당 장기보유 <span className="num">{cand.score}/{cand.max_score}</span>
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {/* 좁은 폭에서 넘치지 않게 개별 전략 표시는 선택 목록 아래로 */}
                      <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-2">
                        <select
                          aria-label={`${i.name} 프로필`}
                          className="input-field !w-auto min-w-[7rem] !py-1 !text-xs"
                          value={pid}
                          disabled={saving || bulkBusy}
                          onChange={(e) => assignOne(i.asset_id, Number(e.target.value))}
                        >
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
                        </div>
                        {i.rule_source === 'asset' && (
                          <span
                            className="badge whitespace-nowrap border border-amber-400/25 bg-amber-400/10 !text-[10px] text-amber-200"
                            title="이 종목에는 종목별 개별 전략이 설정되어 있어, 프로필 규칙보다 개별 전략이 우선 적용됩니다."
                          >
                            개별 전략
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-zinc-600">
        {rows.length}개 표시 · 프로필을 바꾸면 즉시 저장됩니다.
      </p>
    </div>
  );
}
