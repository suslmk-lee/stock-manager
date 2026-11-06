import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Coins, Info, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { PageActions } from '../components/shell/PageSlots';
import SplitView from '../components/shell/SplitView';
import { useAlerts } from '../components/alerts/AlertsProvider';
import SignalHistory from '../components/alerts/SignalHistory';
import { apiClient } from '../api/client';
import { SignalItem, SignalProfile, SignalReport, SignalRule, SignalRulesResponse } from '../types/models';
import ProfileManager from '../components/signals/ProfileManager';
import SignalList, { sortItems, type SortKey, type SortState } from '../components/signals/SignalList';
import SignalDetail, { type DetailTab } from '../components/signals/SignalDetail';
import { type FilterValue } from '../components/signals/SignalCard';
import TaxPill from '../components/signals/TaxPill';

// 이미 처리한 포커스 요청 (페이지를 다시 열어도 재실행하지 않도록)
let handledFocusNonce = 0;

interface SignalsDashboardProps {
  focusAssetId?: number;
  focusNonce?: number;
}

const SORT_STORE_KEY = 'sm-signal-sort';
const SORT_KEYS: SortKey[] = ['default', 'name', 'action', 'return', 'weight'];
const loadSort = (): SortState => {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_STORE_KEY) ?? 'null');
    if (v && SORT_KEYS.includes(v.key)) return { key: v.key, desc: !!v.desc };
  } catch {
    // 저장값이 없거나 깨졌으면 기본 순서
  }
  return { key: 'default', desc: false };
};

const matchesQuery = (i: SignalItem, q: string) => {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  return i.name.toLowerCase().includes(s) || i.ticker.toLowerCase().includes(s);
};

export default function SignalsDashboard({ focusAssetId, focusNonce }: SignalsDashboardProps = {}) {
  const { openSettings, openCandidates, profilesVersion } = useAlerts();
  const [report, setReport] = useState<SignalReport | null>(null);
  const [rules, setRules] = useState<SignalRulesResponse | null>(null);
  const [profiles, setProfiles] = useState<SignalProfile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterValue>('all');
  const [profileFilter, setProfileFilter] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(loadSort);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [split, setSplit] = useState<boolean | null>(null); // null = 아직 화면 폭을 재지 않음
  const [flashId, setFlashId] = useState<number | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  const changeSort = (s: SortState) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_STORE_KEY, JSON.stringify(s));
    } catch {
      // 저장하지 못해도 이번 화면에는 적용된다
    }
  };

  const load = useCallback(async (initial = false) => {
    try {
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      const [r, ru, pr] = await Promise.all([
        apiClient.GetSignals(),
        apiClient.GetSignalRules().catch(() => null),
        apiClient.GetSignalProfiles().catch(() => null),
      ]);
      setReport(r);
      setRules(ru);
      setProfiles(pr ? [...(pr.profiles ?? [])].sort((a, b) => Number(b.built_in) - Number(a.built_in) || a.sort_order - b.sort_order || a.id - b.id) : null);
      setProfileFilter((cur) => (cur !== 'all' && pr && !(pr.profiles ?? []).some((p) => p.id === cur) ? 'all' : cur));
    } catch (err) {
      console.error('Failed to load signals:', err);
      // Wails 는 Go 오류를 문자열로 reject 한다
      const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      setError(detail ? `매매 신호를 불러오지 못했습니다: ${detail}` : '매매 신호를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  // 알림 등 다른 곳에서 프로필 지정이 바뀌면 다시 불러온다
  const seenVersionRef = useRef(profilesVersion);
  useEffect(() => {
    if (seenVersionRef.current === profilesVersion) return;
    seenVersionRef.current = profilesVersion;
    load(false);
  }, [profilesVersion, load]);

  const items = useMemo(() => report?.items ?? [], [report]);

  // 프로필·검색으로 좁힌 범위. 필터 버튼의 개수도 이 범위 기준이다.
  const scoped = useMemo(
    () => items.filter((i) => (profileFilter === 'all' || i.profile_id === profileFilter) && matchesQuery(i, query)),
    [items, profileFilter, query],
  );
  const counts = useMemo(() => {
    const c: Record<FilterValue, number> = { all: scoped.length, SELL: 0, BUY: 0, CONFLICT: 0, HOLD: 0 };
    for (const i of scoped) if (i.action !== 'NO_PRICE') c[i.action] += 1;
    return c;
  }, [scoped]);
  const visible = useMemo(
    () => sortItems(scoped.filter((i) => filter === 'all' || i.action === filter), sort),
    [scoped, filter, sort],
  );
  const selected = visible.find((i) => i.asset_id === selectedId) ?? null;

  // 넓은 화면은 항상 무언가를 보여 주고(첫 종목), 좁은 화면은 사용자가 고를 때만 상세로 간다
  useEffect(() => {
    if (split === null) return;
    if (visible.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const present = selectedId != null && visible.some((i) => i.asset_id === selectedId);
    if (split && !present) setSelectedId(visible[0].asset_id);
    if (!split && selectedId != null && !present) setSelectedId(null);
  }, [split, visible, selectedId]);

  // 알림에서 넘어온 종목을 골라 보여 주고 목록에서 잠깐 강조한다
  useEffect(() => {
    if (!report || !focusAssetId || !focusNonce || focusNonce === handledFocusNonce) return;
    if (!report.items.some((i) => i.asset_id === focusAssetId)) return;
    if (!visible.some((i) => i.asset_id === focusAssetId)) {
      if (filter !== 'all' || profileFilter !== 'all' || query) {
        setFilter('all'); // 필터를 풀고 난 뒤 다시 실행된다
        setProfileFilter('all');
        setQuery('');
      }
      return;
    }
    handledFocusNonce = focusNonce;
    setSelectedId(focusAssetId);
    setTab('overview');
    setFlashId(focusAssetId);
  }, [report, focusAssetId, focusNonce, visible, filter, profileFilter, query]);

  useEffect(() => {
    if (flashId == null) return;
    const t = window.setTimeout(() => setFlashId(null), 2800);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const ruleFor = (item: SignalItem): SignalRule | undefined =>
    rules?.overrides?.find((o) => o.asset_id === item.asset_id) ?? profiles?.find((p) => p.id === item.profile_id)?.rule ?? rules?.default;

  const tax = report?.tax;
  const basisNote = items.some((i) => i.return_basis === 'fx')
    ? '수익률은 배당·실현손익 포함, 매수 시점 환율 원화 기준(거래 기록이 없는 수량은 현재 환율).'
    : '수익률은 배당·실현손익 포함, 현재 환율 원화 기준.';

  const lead = (
    <>
      <span className="text-zinc-500" title={`설정한 규칙에 따른 알림이며 투자 권유가 아닙니다.\n${basisNote}`} aria-label="안내">
        <Info className="h-4 w-4" />
      </span>
      {tax && <TaxPill tax={tax} />}
    </>
  );

  return (
    <div>
      <PageActions lead={lead}>
        {/* 1024px 미만에서는 아이콘만 (이름은 툴팁) */}
        <button type="button" className="btn-ghost" onClick={openSettings} title="알림 설정">
          <Bell className="h-4 w-4" />
          <span className="hidden lg:inline">알림 설정</span>
        </button>
        <button type="button" className="btn-ghost" onClick={() => openCandidates()} title="배당 종목 정리">
          <Coins className="h-4 w-4 text-sky-300" />
          <span className="hidden lg:inline">배당 종목 정리</span>
        </button>
        <button type="button" className="btn-ghost" disabled={!profiles} onClick={() => setManagerOpen(true)} title="전략 프로필">
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden lg:inline">전략 프로필</span>
        </button>
        <button type="button" className="btn-icon !h-9 !w-9" onClick={() => load(false)} disabled={refreshing} aria-label="새로고침" title="새로고침">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </PageActions>

      {error && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-rose-200">
          <span className="text-sm">{error}</span>
          <button type="button" className="btn-ghost !py-1 !text-xs" onClick={() => load(true)}>
            다시 시도
          </button>
        </div>
      )}

      {loading ? (
        <div className="surface h-[calc(100vh-var(--app-header-h,56px)-3rem)] min-h-[520px] animate-pulse" />
      ) : report ? (
        items.length === 0 ? (
          <div className="surface py-16 text-center">
            <p className="text-sm text-zinc-400">보유 중인 종목이 없어 계산할 신호가 없습니다.</p>
            <p className="label-mono mt-1">주식/ETF 메뉴에서 종목과 매수 내역을 등록해 보세요</p>
          </div>
        ) : (
          <SplitView
            onSplitChange={setSplit}
            showDetail={selected != null}
            onBack={() => setSelectedId(null)}
            list={
              <SignalList
                items={visible}
                counts={counts}
                filter={filter}
                onFilter={setFilter}
                query={query}
                onQuery={setQuery}
                profiles={profiles}
                profileFilter={profileFilter}
                onProfileFilter={setProfileFilter}
                sort={sort}
                onSort={changeSort}
                selectedId={selectedId}
                onSelect={setSelectedId}
                flashId={flashId}
                noPriceCount={report.summary?.no_price ?? 0}
                emptyText={query ? '검색과 일치하는 종목이 없습니다.' : '해당하는 신호가 없습니다.'}
              />
            }
            detail={
              selected ? (
                <SignalDetail
                  item={selected}
                  rule={ruleFor(selected)}
                  assetRule={rules?.overrides?.find((o) => o.asset_id === selected.asset_id) ?? null}
                  profiles={profiles}
                  tab={tab}
                  onTab={setTab}
                  onRuleSaved={() => {
                    setTab('overview');
                    load(false);
                  }}
                />
              ) : (
                <p className="py-16 text-center text-sm text-zinc-400">왼쪽 목록에서 종목을 고르세요.</p>
              )
            }
          />
        )
      ) : null}

      <SignalHistory />

      {managerOpen && (
        <ProfileManager
          items={items}
          onClose={(changed) => {
            setManagerOpen(false);
            if (changed) load(false);
          }}
        />
      )}
    </div>
  );
}
