import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Minus, Sparkles } from 'lucide-react';
import { apiClient } from '../../api/client';
import { useAlerts } from '../alerts/AlertsProvider';
import type { Asset, SignalItem, SignalProfile, SignalRule } from '../../types/models';
import { applyRecommended } from './recommendedStrategies';
import { describeRule, listRuleConditions } from './SignalRuleEditor';
import { FitReason, adviseStrategy, suggestProfileDescription, suggestProfileName, tuneStrategy } from './strategyAdvice';

interface StrategyAdvisorProps {
  item: SignalItem;
  profiles: SignalProfile[] | null;
  /** 이 종목의 개별 전략 (있으면 프로필보다 우선 적용된다) */
  assetRule: SignalRule | null;
  /** 프로필을 저장했을 때 (신호를 다시 불러온다) */
  onSaved: () => void;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : typeof err === 'string' && err ? err : fallback;
}

function ReasonRow({ r }: { r: FitReason }) {
  if (!r.met && r.points < 0) return null; // 해당 없는 감점 요인은 숨긴다
  const penalty = r.points < 0;
  const icon = !r.met ? (
    <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
  ) : penalty ? (
    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
  ) : (
    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-300" />
  );
  return (
    <li className="flex gap-2 text-xs leading-relaxed">
      {icon}
      <span className={r.met ? (penalty ? 'text-amber-200' : 'text-zinc-200') : 'text-zinc-500'}>
        {r.label}
        {r.detail && <span className="text-zinc-500"> · {r.detail}</span>}
      </span>
    </li>
  );
}

/** 매매 신호 상세의 "전략 추천" 탭: 이 종목의 지금 지표로 맞는 전략을 고르고, 기준값을 맞춰 프로필로 저장한다 */
export default function StrategyAdvisor({ item, profiles, assetRule, onSaved }: StrategyAdvisorProps) {
  const { notifyProfilesChanged } = useAlerts();
  const [asset, setAsset] = useState<Asset | null | undefined>(undefined); // undefined = 불러오는 중
  const [chosenId, setChosenId] = useState<string | null>(null); // null = 가장 잘 맞는 전략
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [applyNow, setApplyNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; applied: boolean } | null>(null);

  // 종목 유형·섹터 (실패해도 이름·티커로 판단한다)
  useEffect(() => {
    let alive = true;
    apiClient
      .GetAllAssets()
      .then((list) => alive && setAsset(((list ?? []) as Asset[]).find((a) => a.id === item.asset_id) ?? null))
      .catch(() => alive && setAsset(null));
    return () => {
      alive = false;
    };
  }, [item.asset_id]);

  const advice = useMemo(() => (asset === undefined ? null : adviseStrategy(item, asset)), [item, asset]);
  const best = advice?.fits[0] ?? null;
  const chosen = advice?.fits.find((f) => f.strategy.id === chosenId) ?? best;
  // 운용 설정(수량·쿨다운 등)은 지금 따르는 프로필에서 가져온다
  const baseProfile = profiles?.find((p) => p.id === item.profile_id) ?? profiles?.find((p) => p.key === 'default') ?? null;
  const tuned = useMemo(() => (chosen ? tuneStrategy(chosen.strategy, item, baseProfile?.rule) : null), [chosen, item, baseProfile]);
  const preview = useMemo(() => {
    if (!tuned || !baseProfile) return null;
    const rule = applyRecommended(baseProfile.rule, tuned.patch);
    return { ...describeRule(rule), conditions: listRuleConditions(rule) };
  }, [tuned, baseProfile]);

  // 전략을 바꾸면 (직접 고치지 않은) 이름·설명도 따라 바꾼다
  const takenNames = useMemo(() => (profiles ?? []).map((p) => p.name), [profiles]);
  useEffect(() => {
    if (!chosen) return;
    if (!nameEdited) setName(suggestProfileName(item, chosen.strategy, takenNames));
    setDescription((d) => d || suggestProfileDescription(item));
    // takenNames 는 저장 직후 바뀌므로 이름 제안을 다시 만들지 않게 뺀다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.strategy.id, item.asset_id, nameEdited]);

  if (!advice || !chosen || !tuned) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> 종목 정보를 불러오는 중…
      </div>
    );
  }

  const save = async () => {
    if (!baseProfile) return;
    const nm = name.trim();
    if (!nm) {
      setError('프로필 이름을 입력하세요');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(null);
    let createdId: number | null = null;
    let ruleSaved = false;
    try {
      const created = await apiClient.CreateSignalProfile({
        name: nm,
        description: description.trim() || undefined,
        kind: chosen.strategy.kind,
        copy_from_profile_id: baseProfile.id,
      });
      createdId = created.id;
      await apiClient.UpdateSignalProfile(created.id, { rule: applyRecommended(created.rule, tuned.patch) });
      ruleSaved = true;
      if (applyNow) {
        if (assetRule) await apiClient.DeleteAssetSignalRule(item.asset_id);
        await apiClient.AssignSignalProfile(created.id, [item.asset_id]);
      }
      setSaved({ name: nm, applied: applyNow });
      // 다시 저장해도 이름이 겹치지 않게 다음 이름을 제안해 둔다
      setNameEdited(false);
      setName(suggestProfileName(item, chosen.strategy, [...takenNames, nm]));
      notifyProfilesChanged();
      onSaved();
    } catch (err) {
      if (createdId !== null && !ruleSaved) {
        // 규칙을 넣기 전에 실패하면 만든 프로필을 지워 반쪽짜리 프로필이 남지 않게 한다
        await apiClient.DeleteSignalProfile(createdId).catch(() => undefined);
        setError(errMsg(err, '프로필을 저장하지 못했습니다.'));
      } else if (ruleSaved) {
        notifyProfilesChanged();
        onSaved();
        setError(`프로필은 만들었지만 이 종목에 적용하지 못했습니다: ${errMsg(err, '알 수 없는 오류')}`);
      } else {
        setError(errMsg(err, '프로필을 저장하지 못했습니다.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const isBest = chosen.strategy.id === best?.strategy.id;

  return (
    <div className="flex flex-col gap-4">
      {/* 추천 결과 */}
      <section className="surface-inset p-4 sm:p-5" aria-label="추천 전략">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="label-mono flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-mint-300" />
              {isBest ? '이 종목에 가장 맞는 전략' : '직접 고른 전략'}
            </p>
            <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-white">{chosen.strategy.label}</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">{chosen.strategy.summary}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="num text-3xl font-light leading-none text-mint-300">{chosen.score}</p>
            <p className="label-mono mt-1.5">적합도</p>
          </div>
        </div>
        <ul className="mt-4 grid gap-x-6 gap-y-1.5 border-t border-white/[0.07] pt-3.5 sm:grid-cols-2" aria-label="판단 근거">
          {chosen.reasons.map((r) => (
            <ReasonRow key={r.label} r={r} />
          ))}
        </ul>
      </section>

      {/* 다른 전략 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-mono">다른 전략과 비교</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="전략 선택">
          {advice.fits.map((f, i) => {
            const active = f.strategy.id === chosen.strategy.id;
            return (
              <button
                key={f.strategy.id}
                type="button"
                aria-pressed={active}
                title={f.strategy.summary}
                onClick={() => setChosenId(i === 0 ? null : f.strategy.id)}
                className={`pill-item !px-3 !py-1 !text-xs whitespace-nowrap ${active ? 'pill-item-active' : ''}`}
              >
                {f.strategy.short}
                <span className={`num ml-1.5 ${active ? 'text-mint-300' : 'text-zinc-500'}`}>{f.score}</span>
                {i === 0 && <span className="ml-1 text-[10px] text-mint-300">추천</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 판단에 쓴 지표 */}
      <section aria-label="지금 지표">
        <h4 className="label-mono mb-2">판단에 쓴 지금 지표</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {advice.facts.map((f) => (
            <div key={f.label} className="surface-inset px-3 py-2.5">
              <p className="label-mono !text-[10px]">{f.label}</p>
              <p className="num mt-1 text-sm font-medium text-white">{f.value}</p>
              {f.hint && <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={f.hint}>{f.hint}</p>}
            </div>
          ))}
        </div>
        {advice.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {advice.warnings.map((w) => (
              <li key={w} className="flex gap-1.5 text-[11px] leading-relaxed text-amber-200/80">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 이 종목에 맞춘 조정 */}
      {tuned.tunings.length > 0 && (
        <section aria-label="이 종목에 맞춘 조정">
          <h4 className="label-mono mb-2">이 종목에 맞춘 조정</h4>
          <ul className="surface-inset divide-y divide-white/[0.06] px-3">
            {tuned.tunings.map((t) => (
              <li key={t.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-xs">
                <span className="text-zinc-200">{t.label}</span>
                <span className="num text-zinc-400">{t.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 규칙 미리보기: 켜지는 조건과 판단 방식 */}
      {preview && (
        <section aria-label="규칙 미리보기">
          <h4 className="label-mono mb-2">저장될 규칙</h4>
          <div className="space-y-3 rounded-2xl border border-mint-400/20 bg-mint-400/[0.06] px-4 py-3.5 text-xs leading-relaxed">
            {(
              [
                ['매도 · 수익 실현', preview.conditions.profit, 'text-rose-300'],
                ['매도 · 위험 관리', preview.conditions.risk, 'text-rose-300'],
                ['매수', preview.conditions.buy, 'text-mint-300'],
              ] as const
            ).map(([title, list, tone]) => (
              <div key={title} className="grid gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                <span className={`font-semibold ${tone}`}>{title}</span>
                {list.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {list.map((c) => (
                      <li key={c} className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-zinc-200">{c}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-zinc-500">없음</span>
                )}
              </div>
            ))}
            <div className="space-y-0.5 border-t border-white/[0.07] pt-2.5 text-zinc-400">
              <p><span className="mr-1.5 text-zinc-300">매도 검토</span>— {preview.sell}</p>
              <p><span className="mr-1.5 text-zinc-300">매수 검토</span>— {preview.buy}</p>
            </div>
          </div>
        </section>
      )}

      {/* 프로필로 저장 */}
      <section className="surface-inset space-y-3 p-4 sm:p-5" aria-label="프로필로 저장">
        <div>
          <h4 className="text-sm font-semibold text-white">프로필로 저장</h4>
          <p className="mt-0.5 text-xs text-zinc-500">
            위 조건으로 새 전략 프로필을 만듭니다. 수량·쿨다운 같은 운용 설정은 지금 따르는 프로필({baseProfile?.name ?? '기본'})에서 가져옵니다.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="adv-name">이름</label>
            <input
              id="adv-name"
              className="input-field"
              value={name}
              maxLength={30}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="adv-desc">설명 (선택)</label>
            <input id="adv-desc" className="input-field" value={description} maxLength={80} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-200">
          <input type="checkbox" className="mt-0.5 h-4 w-4 cursor-pointer accent-mint-400" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} />
          <span>
            저장한 뒤 이 종목에 바로 적용
            <span className="block text-xs text-zinc-500">
              지금: {assetRule ? '이 종목만 개별 전략' : item.profile_name ?? '기본'}
            </span>
          </span>
        </label>
        {applyNow && assetRule && (
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
            이 종목에는 개별 전략이 있어 프로필보다 먼저 적용됩니다. 저장하면 개별 전략을 지우고 새 프로필을 따르게 합니다.
          </p>
        )}
        {error && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>}
        {saved && (
          <div className="rounded-xl border border-mint-400/30 bg-mint-400/10 px-3 py-2 text-xs leading-relaxed text-mint-100">
            '{saved.name}' 프로필을 만들었{saved.applied ? '고 이 종목에 적용했' : ''}습니다.{' '}
            <a href="#profiles" className="underline underline-offset-2 hover:text-white">전략 프로필</a>에서 규칙을 더 다듬을 수 있습니다.
          </div>
        )}
        <div className="flex justify-end">
          <button type="button" className="btn-primary" disabled={saving || !baseProfile} onClick={save}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            프로필로 저장
          </button>
        </div>
        {!baseProfile && <p className="text-right text-xs text-zinc-500">전략 프로필을 불러오지 못해 저장할 수 없습니다.</p>}
      </section>
    </div>
  );
}
