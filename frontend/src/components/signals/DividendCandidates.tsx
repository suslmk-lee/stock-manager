import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, EyeOff, Info } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { ProfileCandidate, SignalProfile } from '../../types/models';
import Chip from '../ui/Chip';
import ProfileChip from './ProfileChip';
import { PageActions } from '../shell/PageSlots';
import { useAlerts } from '../alerts/AlertsProvider';
import { assetPrimary, assetSecondary } from '../../utils/assetLabel';

interface DividendCandidatesProps {
  /** 알림에서 넘어온 종목: 강조하고 미리 선택한다 */
  highlightAssetId?: number;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : typeof err === 'string' && err ? err : fallback;
}

function ScoreDots({ score, max }: { score: number; max: number }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`점수 ${score} / ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < score ? 'bg-sky-400' : 'bg-white/[0.14]'}`} />
      ))}
      <span className="num ml-1 text-[11px] text-zinc-400">
        {score}/{max}
      </span>
    </span>
  );
}

// 배당 종목 정리 페이지 (사이드바 '배당 후보'): 배당 성향이 뚜렷한 보유 종목을 골라 프로필에 한꺼번에 지정한다.
export default function DividendCandidates({ highlightAssetId }: DividendCandidatesProps) {
  const { notifyProfilesChanged } = useAlerts();
  const [candidates, setCandidates] = useState<ProfileCandidate[]>([]);
  const [profiles, setProfiles] = useState<SignalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [targetId, setTargetId] = useState<number>(0);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([apiClient.GetProfileCandidates(), apiClient.GetSignalProfiles()]);
      const list = [...(c.candidates ?? [])].sort((a, b) => Number(b.is_candidate) - Number(a.is_candidate) || b.score - a.score || a.name.localeCompare(b.name, 'ko'));
      const profs = [...(p.profiles ?? [])].sort((a, b) => Number(b.built_in) - Number(a.built_in) || a.sort_order - b.sort_order);
      setCandidates(list);
      setProfiles(profs);
      setLoadError(null);
      const dividend = profs.find((x) => x.key === 'dividend');
      setTargetId((cur) => cur || dividend?.id || profs[0]?.id || 0);
      if (!initRef.current) {
        initRef.current = true;
        const pre = new Set<number>();
        list.forEach((x) => {
          if (x.is_candidate && x.profile_id !== dividend?.id && !x.has_override) pre.add(x.asset_id);
        });
        if (highlightAssetId && list.some((x) => x.asset_id === highlightAssetId)) pre.add(highlightAssetId);
        setSelected(pre);
      }
    } catch (err) {
      console.error('Failed to load candidates:', err);
      setLoadError(errMsg(err, '배당 종목 후보를 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, [highlightAssetId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading || !highlightAssetId) return;
    document.getElementById('cand-row-' + highlightAssetId)?.scrollIntoView({ block: 'center' });
  }, [loading, highlightAssetId]);

  const target = profiles.find((p) => p.id === targetId);
  // 이미 지정 대상 프로필에 있는 종목은 뒤로 보낸다
  const rows = useMemo(() => [...candidates].sort((a, b) => Number(a.profile_id === targetId) - Number(b.profile_id === targetId)), [candidates, targetId]);
  const selectable = useMemo(() => candidates.filter((c) => c.profile_id !== targetId), [candidates, targetId]);
  const selectedCount = useMemo(() => selectable.filter((c) => selected.has(c.asset_id)).length, [selectable, selected]);
  const candidateCount = useMemo(() => candidates.filter((c) => c.is_candidate).length, [candidates]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    const ids = selectable.filter((c) => selected.has(c.asset_id)).map((c) => c.asset_id);
    if (ids.length === 0 || !target) return;
    try {
      setApplying(true);
      setError(null);
      setMessage(null);
      await apiClient.AssignSignalProfile(target.id, ids);
      notifyProfilesChanged();
      setSelected(new Set());
      setMessage(`${ids.length}개 종목을 '${target.name}' 프로필로 지정했습니다.`);
      await load();
    } catch (err) {
      setError(errMsg(err, '프로필을 지정하지 못했습니다.'));
    } finally {
      setApplying(false);
    }
  };

  const dismiss = async (assetId: number) => {
    try {
      setError(null);
      await apiClient.DismissProfileSuggestion(assetId);
      setCandidates((prev) => prev.map((c) => (c.asset_id === assetId ? { ...c, is_candidate: false } : c)));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(assetId);
        return next;
      });
      notifyProfilesChanged();
    } catch (err) {
      setError(errMsg(err, '제안을 무시하지 못했습니다.'));
    }
  };

  const ready = !loading && !loadError;

  return (
    <>
      <PageActions lead={<span className="label-mono hidden sm:inline">배당 성향이 뚜렷한 보유 종목을 장기보유 프로필로 모아 보세요</span>}>
        {ready && (
          <>
            <label className="label-mono hidden sm:inline" htmlFor="cand-target">
              지정할 프로필
            </label>
            <select id="cand-target" className="input-field !w-auto !py-1.5 text-sm" value={targetId} onChange={(e) => setTargetId(Number(e.target.value))}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn-primary" disabled={applying || selectedCount === 0 || !target} onClick={apply}>
              {applying && <Loader2 className="h-4 w-4 animate-spin" />}
              {target ? `'${target.name}'로 지정` : '지정'}
              {selectedCount > 0 && <span className="num">({selectedCount})</span>}
            </button>
          </>
        )}
      </PageActions>

      {loading ? (
        <div className="surface flex h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : loadError ? (
        <div className="surface flex h-64 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-rose-200">{loadError}</p>
          <button type="button" className="btn-ghost" onClick={load}>
            다시 시도
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-1">
            <p className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Info className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              자동으로 바꾸지 않습니다 · 선택한 종목만 적용 · 후보 <span className="num text-zinc-200">{candidateCount}</span>개 / 보유 <span className="num text-zinc-200">{candidates.length}</span>개
            </p>
            <p className="text-xs" role="status">
              {error ? <span className="text-rose-300">{error}</span> : message ? <span className="text-mint-300">{message}</span> : <span className="text-zinc-500">선택 {selectedCount}개</span>}
            </p>
          </div>

          {candidates.length === 0 ? (
            <p className="surface py-12 text-center text-sm text-zinc-400">보유 중인 종목이 없습니다.</p>
          ) : (
            <ul className="grid gap-2.5 xl:grid-cols-2">
              {rows.map((c) => {
                const already = c.profile_id === targetId;
                const checked = !already && selected.has(c.asset_id);
                const hl = c.asset_id === highlightAssetId;
                return (
                  <li
                    key={c.asset_id}
                    id={'cand-row-' + c.asset_id}
                    className={`surface-inset p-3.5 transition-colors ${already ? 'opacity-60' : ''} ${hl ? '!border-sky-400/50 ring-1 ring-sky-400/30' : ''} ${checked ? '!bg-sky-400/[0.06]' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                        checked={checked}
                        disabled={already}
                        onChange={() => toggle(c.asset_id)}
                        aria-label={`${c.name} 선택`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            <span className="truncate text-sm font-medium text-white">{assetPrimary(c)}</span>
                            <span className="label-mono">{assetSecondary(c)}</span>
                            {already ? (
                              <span className="badge border border-white/10 bg-white/[0.05] text-zinc-400">적용 중</span>
                            ) : (
                              c.is_candidate && <span className="badge border border-sky-400/30 bg-sky-400/10 text-sky-200">후보</span>
                            )}
                          </div>
                          <ScoreDots score={c.score} max={c.max_score} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {c.reasons.map((r) =>
                            r.met ? (
                              <Chip key={r.code} check className="!border-sky-400/30 !bg-sky-400/10 !text-sky-200 [&_svg]:!text-sky-300">
                                <span title={r.detail}>{r.label}</span>
                              </Chip>
                            ) : (
                              <Chip key={r.code} className="!text-zinc-500">
                                <span title={r.detail}>{r.label}</span>
                              </Chip>
                            ),
                          )}
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="label-mono">현재</span>
                            <ProfileChip name={c.profile_name} kind={profiles.find((p) => p.id === c.profile_id)?.kind} />
                            {c.has_override && <span className="badge border border-amber-400/25 bg-amber-400/10 text-amber-200">개별 전략 있음</span>}
                          </div>
                          {c.is_candidate && !already && (
                            <button type="button" className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-200" onClick={() => dismiss(c.asset_id)}>
                              <EyeOff className="h-3.5 w-3.5" />
                              무시
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
