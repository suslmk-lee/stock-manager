import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Loader2, RotateCcw, Trash2, Layers, Coins, Lock, Sparkles } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { ProfileAssignment, ProfileKind, SignalItem, SignalProfile } from '../../types/models';
import ProfileAssignmentTable, { AssignFilter } from './ProfileAssignmentTable';
import { DEFAULT_SECTION, ProfileRuleEditor, SectionId } from './SignalRuleEditor';
import ProfileChip, { kindLabel } from './ProfileChip';
import { INCOME_PROFILE_DESC, INCOME_PROFILE_NAME, INCOME_STRATEGY, RECOMMENDED_STRATEGIES, applyRecommended, RecommendedStrategy } from './recommendedStrategies';

const INCOME_DISMISS_KEY = 'stock-manager:income-profile-suggestion-dismissed';

// 프로필을 만든 뒤 추천 전략의 조건을 적용한다 (복사 원본의 운용 설정은 유지)
async function createWithStrategy(
  req: { name: string; description?: string; kind: ProfileKind; copy_from_profile_id?: number },
  strategy: RecommendedStrategy,
): Promise<SignalProfile> {
  const created = await apiClient.CreateSignalProfile(req);
  const updated = await apiClient.UpdateSignalProfile(created.id, { rule: applyRecommended(created.rule, strategy.patch) });
  return updated ?? created;
}

interface ProfileManagerProps {
  items: SignalItem[]; // 보유 종목 (신호 리포트)
  initialProfileId?: number;
  onClose: (changed: boolean) => void;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : typeof err === 'string' && err ? err : fallback;
}

function KindToggle({ value, onChange }: { value: ProfileKind; onChange: (k: ProfileKind) => void }) {
  return (
    <div className="glass-pill inline-flex p-0.5" role="group" aria-label="프로필 유형">
      {(['standard', 'dividend'] as ProfileKind[]).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`pill-item !px-3 !py-1 !text-xs ${value === k ? `pill-item-active ${k === 'dividend' ? '!text-sky-300' : ''}` : ''}`}
        >
          {kindLabel(k)}
        </button>
      ))}
    </div>
  );
}

function NewProfileForm({ profiles, onCreated, onCancel }: { profiles: SignalProfile[]; onCreated: (p: SignalProfile) => void; onCancel: () => void }) {
  const defaultProfile = profiles.find((p) => p.key === 'default');
  const dividendProfile = profiles.find((p) => p.key === 'dividend');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ProfileKind>('standard');
  const [copyFrom, setCopyFrom] = useState<number>(defaultProfile?.id ?? 0);
  // 시작 설정: 'copy' = 기존 프로필 복사, 그 외 = 추천 전략 id
  const [start, setStart] = useState<string>('copy');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeKind = (k: ProfileKind) => {
    setKind(k);
    // 유형에 어울리는 기본 복사 원본으로 맞춰 준다
    const target = k === 'dividend' ? dividendProfile : defaultProfile;
    if (target) setCopyFrom(target.id);
  };

  const changeStart = (id: string) => {
    setStart(id);
    const strat = RECOMMENDED_STRATEGIES.find((r) => r.id === id);
    if (strat) changeKind(strat.kind);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError('프로필 이름을 입력하세요');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const req = {
        name: name.trim(),
        description: description.trim() || undefined,
        kind,
        copy_from_profile_id: copyFrom || undefined,
      };
      const strat = RECOMMENDED_STRATEGIES.find((r) => r.id === start);
      const created = strat ? await createWithStrategy(req, strat) : await apiClient.CreateSignalProfile(req);
      onCreated(created);
    } catch (err) {
      setError(errMsg(err, '프로필을 만들지 못했습니다.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h3 className="section-title">새 프로필</h3>
        <p className="mt-0.5 text-xs text-zinc-500">기존 프로필의 규칙을 복사해서 시작합니다. 만든 뒤 규칙을 자유롭게 바꿀 수 있습니다.</p>
      </div>
      <div>
        <label className="field-label" htmlFor="np-name">이름</label>
        <input id="np-name" className="input-field" value={name} maxLength={30} placeholder="예: 월배당 ETF" autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="field-label" htmlFor="np-desc">설명 (선택)</label>
        <input id="np-desc" className="input-field" value={description} maxLength={80} placeholder="이 프로필을 어떤 종목에 쓰는지" onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <span className="field-label">유형</span>
        <KindToggle value={kind} onChange={changeKind} />
        <p className="mt-1.5 text-xs text-zinc-500">{kind === 'dividend' ? '배당형: 카드에 배당 회수율을 우선 표시하고 장기보유 관점으로 보여 줍니다.' : '일반형: 수익률 중심의 일반 카드로 표시합니다.'}</p>
      </div>
      <div>
        <label className="field-label" htmlFor="np-start">시작 설정</label>
        <select id="np-start" className="input-field" value={start} onChange={(e) => changeStart(e.target.value)}>
          <option value="copy">기존 프로필 복사</option>
          {RECOMMENDED_STRATEGIES.map((r) => (
            <option key={r.id} value={r.id}>추천: {r.label}</option>
          ))}
        </select>
        {start !== 'copy' && <p className="mt-1.5 text-xs text-zinc-500">{RECOMMENDED_STRATEGIES.find((r) => r.id === start)?.summary} 수량·쿨다운 등 운용 설정은 아래 원본에서 가져옵니다.</p>}
      </div>
      <div>
        <label className="field-label" htmlFor="np-copy">{start === 'copy' ? '규칙 복사 원본' : '운용 설정 복사 원본'}</label>
        <select id="np-copy" className="input-field" value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value))}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {error && <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>취소</button>
        <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          프로필 만들기
        </button>
      </div>
    </div>
  );
}

export default function ProfileManager({ items, initialProfileId, onClose }: ProfileManagerProps) {
  const [profiles, setProfiles] = useState<SignalProfile[]>([]);
  const [assignments, setAssignments] = useState<ProfileAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(initialProfileId ?? null);
  const [creating, setCreating] = useState(false);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null);
  const [ruleNonce, setRuleNonce] = useState(0);
  // 프로필을 바꿔도 보고 있던 규칙 섹션을 유지한다
  const [ruleSection, setRuleSection] = useState<SectionId>(DEFAULT_SECTION);
  const [mode, setMode] = useState<'edit' | 'assign'>('edit');
  const [incomeDismissed, setIncomeDismissed] = useState(() => {
    try {
      return localStorage.getItem(INCOME_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [incomeBusy, setIncomeBusy] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [assignFilter, setAssignFilter] = useState<AssignFilter>('all');
  // 이름/설명/유형 편집 (사용자 정의 프로필)
  const [meta, setMeta] = useState({ name: '', description: '', kind: 'standard' as ProfileKind });
  const detailRef = useRef<HTMLElement>(null);
  const changedRef = useRef(false);
  changedRef.current = changed;

  const load = useCallback(async (keepSelection = true) => {
    try {
      const r = await apiClient.GetSignalProfiles();
      const list = [...(r.profiles ?? [])].sort((a, b) => Number(b.built_in) - Number(a.built_in) || a.sort_order - b.sort_order || a.id - b.id);
      setProfiles(list);
      setAssignments(r.assignments ?? []);
      setLoadError(null);
      setSelectedId((cur) => (keepSelection && cur && list.some((p) => p.id === cur) ? cur : list[0]?.id ?? null));
    } catch (err) {
      console.error('Failed to load profiles:', err);
      setLoadError(errMsg(err, '전략 프로필을 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(changedRef.current);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    detailRef.current?.scrollTo(0, 0);
  }, [selectedId, creating]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const defaultProfile = profiles.find((p) => p.key === 'default');
  const dividendBuiltIn = profiles.find((p) => p.key === 'dividend');
  const hasIncomeProfile = profiles.some((p) => p.name === INCOME_PROFILE_NAME);

  const dismissIncome = () => {
    setIncomeDismissed(true);
    try {
      localStorage.setItem(INCOME_DISMISS_KEY, '1');
    } catch {
      /* 저장할 수 없으면 이번 세션에서만 숨긴다 */
    }
  };

  const createIncomeProfile = async () => {
    try {
      setIncomeBusy(true);
      setIncomeError(null);
      const created = await createWithStrategy(
        { name: INCOME_PROFILE_NAME, description: INCOME_PROFILE_DESC, kind: 'dividend', copy_from_profile_id: dividendBuiltIn?.id },
        INCOME_STRATEGY,
      );
      setChanged(true);
      setCreating(false);
      setMode('edit');
      await load();
      setSelectedId(created.id);
    } catch (err) {
      setIncomeError(errMsg(err, '커버드콜·인컴 ETF 프로필을 만들지 못했습니다.'));
    } finally {
      setIncomeBusy(false);
    }
  };

  useEffect(() => {
    if (selected) setMeta({ name: selected.name, description: selected.description ?? '', kind: selected.kind });
    setConfirm(null);
    setActionError(null);
  }, [selected?.id, selected?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const profileIdOf = useCallback(
    (assetId: number) => assignments.find((a) => a.asset_id === assetId)?.profile_id ?? defaultProfile?.id ?? 0,
    [assignments, defaultProfile?.id],
  );

  const memberCount = useMemo(() => (selected ? items.filter((i) => profileIdOf(i.asset_id) === selected.id).length : 0), [items, selected, profileIdOf]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    try {
      setBusy(true);
      setActionError(null);
      await fn();
      setChanged(true);
    } catch (err) {
      setActionError(errMsg(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  // 종목 배정 표에서 호출: 낙관적으로 반영하고 실패하면 해당 종목만 이전 값으로 되돌린다
  const assignAssets = useCallback(
    async (profileId: number, assetIds: number[]) => {
      const idSet = new Set(assetIds);
      const prev = assignments.filter((a) => idSet.has(a.asset_id));
      setAssignments((cur) => [...cur.filter((a) => !idSet.has(a.asset_id)), ...assetIds.map((asset_id) => ({ asset_id, profile_id: profileId }))]);
      try {
        const r = await apiClient.AssignSignalProfile(profileId, assetIds);
        if (r?.assignments) setAssignments(r.assignments);
        setChanged(true);
        await load(); // 프로필별 종목 수 갱신
      } catch (err) {
        setAssignments((cur) => [...cur.filter((a) => !idSet.has(a.asset_id)), ...prev]);
        throw err;
      }
    },
    [assignments, load],
  );

  const saveMeta = () =>
    run(async () => {
      if (!selected) return;
      if (!meta.name.trim()) throw new Error('프로필 이름을 입력하세요');
      await apiClient.UpdateSignalProfile(selected.id, { name: meta.name.trim(), description: meta.description.trim(), kind: meta.kind });
      await load();
    }, '프로필 정보를 저장하지 못했습니다.');

  const doReset = () =>
    run(async () => {
      if (!selected) return;
      await apiClient.ResetSignalProfile(selected.id);
      setRuleNonce((n) => n + 1);
      setConfirm(null);
      await load();
    }, '공장 초기화에 실패했습니다.');

  const doDelete = () =>
    run(async () => {
      if (!selected) return;
      await apiClient.DeleteSignalProfile(selected.id);
      setConfirm(null);
      await load(false);
    }, '프로필을 삭제하지 못했습니다.');

  const metaDirty = !!selected && !selected.built_in && (meta.name !== selected.name || meta.description !== (selected.description ?? '') || meta.kind !== selected.kind);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4" onClick={() => onClose(changed)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="전략 프로필"
        className="surface flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="section-title !text-lg">전략 프로필</h2>
            <p className="label-mono mt-0.5">종목 성격별로 매매 규칙을 묶어 관리합니다</p>
          </div>
          <button type="button" onClick={() => onClose(changed)} className="btn-icon" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-rose-200">{loadError}</p>
            <button type="button" className="btn-ghost" onClick={() => load()}>다시 시도</button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* 프로필 목록 */}
            <aside className="shrink-0 border-b border-white/[0.07] md:w-64 md:border-b-0 md:border-r">
              <ul className="flex gap-2 overflow-x-auto p-3 md:max-h-full md:flex-col md:overflow-y-auto md:overflow-x-visible md:p-3">
                {profiles.map((p) => {
                  const active = !creating && p.id === selectedId;
                  return (
                    <li key={p.id} className="shrink-0 md:shrink">
                      <button
                        type="button"
                        onClick={() => {
                          setCreating(false);
                          setSelectedId(p.id);
                        }}
                        aria-current={active}
                        className={`surface-inset w-44 p-3 text-left transition-colors md:w-full ${
                          active ? (p.kind === 'dividend' ? '!border-sky-400/50 !bg-sky-400/[0.08]' : '!border-mint-400/50 !bg-mint-400/[0.08]') : 'hover:!border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {p.kind === 'dividend' ? <Coins className="h-3.5 w-3.5 shrink-0 text-sky-300" /> : <Layers className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                          <span className={`truncate text-sm font-medium ${active ? 'text-white' : 'text-zinc-200'}`}>{p.name}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {p.built_in && (
                            <span className="badge border border-white/10 bg-white/[0.05] !py-px text-zinc-400">
                              <Lock className="h-2.5 w-2.5" />
                              기본 제공
                            </span>
                          )}
                          <span className="label-mono">종목 {p.asset_count}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
                <li className="shrink-0 md:shrink">
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className={`flex w-44 items-center justify-center gap-1.5 rounded-2xl border border-dashed px-3 py-3 text-sm transition-colors md:w-full ${
                      creating ? 'border-mint-400/50 text-mint-300' : 'border-white/15 text-zinc-400 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    <Plus className="h-4 w-4" />
                    새 프로필
                  </button>
                </li>
              </ul>
              {!hasIncomeProfile && !incomeDismissed && (
                <div className="m-3 mt-0 rounded-2xl border border-sky-400/25 bg-sky-400/[0.06] p-3 text-xs leading-relaxed text-zinc-300">
                  <p className="flex items-start gap-1.5">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
                    <span>'{INCOME_PROFILE_NAME}' 전용 프로필이 없습니다. 분배금 중심 ETF는 배당수익률 압축·확대 기준이 더 맞습니다.</span>
                  </p>
                  {incomeError && <p className="mt-1.5 text-rose-300">{incomeError}</p>}
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="btn-primary !px-3 !py-1 !text-xs" disabled={incomeBusy || !dividendBuiltIn} onClick={createIncomeProfile}>
                      {incomeBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      추천 설정으로 만들기
                    </button>
                    <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" disabled={incomeBusy} onClick={dismissIncome}>닫기</button>
                  </div>
                </div>
              )}
            </aside>

            {/* 상세 */}
            <section ref={detailRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              {!creating && (
                <div className="glass-pill mb-5 inline-flex p-0.5" role="group" aria-label="보기 전환">
                  {([['edit', '전략 편집'], ['assign', '종목 배정']] as const).map(([m, label]) => (
                    <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={`pill-item !px-4 !py-1.5 !text-sm ${mode === m ? 'pill-item-active' : ''}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {!creating && mode === 'assign' ? (
                <ProfileAssignmentTable items={items} profiles={profiles} profileIdOf={profileIdOf} initialFilter={assignFilter} onAssign={assignAssets} />
              ) : creating ? (
                <NewProfileForm
                  profiles={profiles}
                  onCancel={() => setCreating(false)}
                  onCreated={async (p) => {
                    setChanged(true);
                    setCreating(false);
                    setSelectedId(p.id);
                    await load();
                    setSelectedId(p.id);
                  }}
                />
              ) : selected ? (
                <div className="space-y-6">
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <ProfileChip name={selected.name} kind={selected.kind} />
                        <span className="badge border border-white/10 bg-white/[0.05] text-zinc-400">{kindLabel(selected.kind)}</span>
                        {selected.built_in && (
                          <span className="badge border border-white/10 bg-white/[0.05] text-zinc-400">
                            <Lock className="h-3 w-3" />
                            기본 제공
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {selected.built_in ? (
                          <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => setConfirm(confirm === 'reset' ? null : 'reset')}>
                            <RotateCcw className="h-3.5 w-3.5" />
                            공장 초기화
                          </button>
                        ) : (
                          <button type="button" className="btn-danger !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => setConfirm(confirm === 'delete' ? null : 'delete')}>
                            <Trash2 className="h-3.5 w-3.5" />
                            삭제
                          </button>
                        )}
                      </div>
                    </div>

                    {confirm === 'reset' && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3">
                        <p className="text-sm text-amber-100">이 프로필의 규칙을 출고 시 값으로 되돌립니다. 소속 종목은 그대로 유지됩니다.</p>
                        <div className="flex gap-2">
                          <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => setConfirm(null)}>취소</button>
                          <button type="button" className="btn-primary !px-3 !py-1 !text-xs" disabled={busy} onClick={doReset}>초기화</button>
                        </div>
                      </div>
                    )}
                    {confirm === 'delete' && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3">
                        <p className="text-sm text-rose-100">
                          '{selected.name}' 프로필을 삭제합니다. 소속 종목 {selected.asset_count}개는 '기본' 프로필로 돌아갑니다.
                        </p>
                        <div className="flex gap-2">
                          <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => setConfirm(null)}>취소</button>
                          <button type="button" className="btn-danger !px-3 !py-1 !text-xs" disabled={busy} onClick={doDelete}>삭제</button>
                        </div>
                      </div>
                    )}

                    {selected.built_in ? (
                      <p className="mt-3 text-sm leading-relaxed text-zinc-400">{selected.description || '기본 제공 프로필입니다. 이름과 설명은 바꿀 수 없고 규칙만 수정할 수 있습니다.'}</p>
                    ) : (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="field-label" htmlFor="pm-name">이름</label>
                          <input id="pm-name" className="input-field" value={meta.name} maxLength={30} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
                        </div>
                        <div>
                          <span className="field-label">유형</span>
                          <KindToggle value={meta.kind} onChange={(k) => setMeta((m) => ({ ...m, kind: k }))} />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="field-label" htmlFor="pm-desc">설명</label>
                          <input id="pm-desc" className="input-field" value={meta.description} maxLength={80} placeholder="설명 없음" onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} />
                        </div>
                        {metaDirty && (
                          <div className="flex justify-end sm:col-span-2">
                            <button type="button" className="btn-primary !py-1.5" disabled={busy} onClick={saveMeta}>
                              이름·설명 저장
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {actionError && <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{actionError}</div>}
                  </div>

                  <p className="-mt-3 flex flex-wrap items-center gap-x-2 text-sm text-zinc-400">
                    소속 종목 <span className="num text-zinc-200">{memberCount}</span>개 ·
                    <button
                      type="button"
                      className="text-mint-300 transition-colors hover:text-mint-200"
                      onClick={() => {
                        setAssignFilter(selected.id);
                        setMode('assign');
                      }}
                    >
                      종목 배정에서 관리 →
                    </button>
                  </p>

                  <section aria-label="전략 규칙">
                    <h3 className="label-mono mb-2.5">전략 규칙</h3>
                    <ProfileRuleEditor
                      key={`${selected.id}-${ruleNonce}`}
                      profile={selected}
                      section={ruleSection}
                      onSectionChange={setRuleSection}
                      onSaved={() => {
                        setChanged(true);
                        load();
                      }}
                    />
                  </section>
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-zinc-500">프로필을 선택하세요.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
