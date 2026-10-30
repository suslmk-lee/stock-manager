import { useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { apiClient } from '../../api/client';
import { SignalMode, SignalRule } from '../../types/models';

type NumKey =
  | 'take_profit_pct'
  | 'stop_loss_pct'
  | 'target_weight_pct'
  | 'weight_band_pct'
  | 'dividend_payback_pct'
  | 'dividend_payback_min_return_pct'
  | 'low_yield_pct'
  | 'buy_dip_pct'
  | 'high_yield_pct'
  | 'from_high_pct'
  | 'below_ma_pct'
  | 'above_ma_pct'
  | 'dividend_cut_pct';

type EnableKey =
  | 'from_high_enabled'
  | 'below_ma_enabled'
  | 'above_ma_enabled'
  | 'dividend_cut_enabled'
  | 'tax_harvest_enabled'
  | 'fx_historical'
  | 'take_profit_enabled'
  | 'stop_loss_enabled'
  | 'weight_enabled'
  | 'dividend_payback_enabled'
  | 'low_yield_enabled'
  | 'buy_dip_enabled'
  | 'high_yield_enabled';

interface FieldDef {
  key: NumKey;
  label: string;
  suffix: string;
}

interface RuleDef {
  enabled: EnableKey;
  label: string;
  desc: string;
  fields: FieldDef[];
  note?: string;
}

const SELL_RULES: RuleDef[] = [
  { enabled: 'take_profit_enabled', label: '목표 수익률 도달', desc: '실질 수익률이 목표 이상이면 이익 실현을 검토합니다.', fields: [{ key: 'take_profit_pct', label: '목표', suffix: '%' }] },
  { enabled: 'stop_loss_enabled', label: '손절 기준', desc: '실질 수익률이 기준 이하로 내려가면 손절을 검토합니다.', fields: [{ key: 'stop_loss_pct', label: '기준', suffix: '%' }] },
  {
    enabled: 'weight_enabled',
    label: '목표 비중 이탈',
    desc: '포트폴리오 내 비중이 목표 + 허용 범위를 넘으면 매도, 목표 - 허용 범위 아래면 매수 조건이 됩니다.',
    fields: [
      { key: 'target_weight_pct', label: '목표 비중', suffix: '%' },
      { key: 'weight_band_pct', label: '허용 범위', suffix: '%p' },
    ],
    note: '종목별 전략에서만 의미 있음',
  },
  {
    enabled: 'dividend_payback_enabled',
    label: '배당 회수율 달성',
    desc: '누적 배당이 투자 원금의 일정 비율을 회수하고, 최소 수익률도 넘으면 매도를 검토합니다.',
    fields: [
      { key: 'dividend_payback_pct', label: '회수율', suffix: '%' },
      { key: 'dividend_payback_min_return_pct', label: '최소 수익률', suffix: '%' },
    ],
  },
  { enabled: 'low_yield_enabled', label: '배당수익률 하락', desc: '현재가 기준 배당수익률이 기준 이하이면 매도를 검토합니다.', fields: [{ key: 'low_yield_pct', label: '기준', suffix: '%' }] },
  { enabled: 'above_ma_enabled', label: '장기 이평 과열', desc: '현재가가 200일 이동평균선보다 기준 이상 높으면 과열로 보고 매도를 검토합니다.', fields: [{ key: 'above_ma_pct', label: '괴리율', suffix: '%' }] },
  { enabled: 'dividend_cut_enabled', label: '배당 삭감', desc: '주당배당금이 직전 12개월 대비 기준(%) 이상 줄면 매도를 검토합니다.', fields: [{ key: 'dividend_cut_pct', label: '감소율', suffix: '%' }] },
];

const BUY_RULES: RuleDef[] = [
  { enabled: 'buy_dip_enabled', label: '평단 대비 하락', desc: '현재가가 평단보다 기준 이상 낮으면 추가 매수를 검토합니다.', fields: [{ key: 'buy_dip_pct', label: '기준', suffix: '%' }] },
  { enabled: 'high_yield_enabled', label: '배당수익률 상승', desc: '현재가 기준 배당수익률이 기준 이상이면 매수를 검토합니다.', fields: [{ key: 'high_yield_pct', label: '기준', suffix: '%' }] },
  { enabled: 'from_high_enabled', label: '52주 고점 대비 하락', desc: '현재가가 52주 최고가보다 기준 이상 낮으면 매수를 검토합니다.', fields: [{ key: 'from_high_pct', label: '기준', suffix: '%' }] },
  { enabled: 'below_ma_enabled', label: '장기 이평 하회', desc: '현재가가 200일 이동평균선보다 기준 이상 낮으면 매수를 검토합니다.', fields: [{ key: 'below_ma_pct', label: '기준', suffix: '%' }] },
];

const NUM_KEYS: NumKey[] = [
  'take_profit_pct', 'stop_loss_pct', 'target_weight_pct', 'weight_band_pct', 'dividend_payback_pct',
  'dividend_payback_min_return_pct', 'low_yield_pct', 'buy_dip_pct', 'high_yield_pct',
  'from_high_pct', 'below_ma_pct', 'above_ma_pct', 'dividend_cut_pct',
];
const ENABLE_KEYS: EnableKey[] = [
  'take_profit_enabled', 'stop_loss_enabled', 'weight_enabled', 'dividend_payback_enabled',
  'low_yield_enabled', 'buy_dip_enabled', 'high_yield_enabled',
  'from_high_enabled', 'below_ma_enabled', 'above_ma_enabled', 'dividend_cut_enabled',
  'tax_harvest_enabled', 'fx_historical',
];

// 2단계 필드 기본값 (구 백엔드가 내려주지 않을 때 균형 값으로 채움)
const NEW_NUM_DEFAULTS: Partial<Record<NumKey, number>> = { from_high_pct: -20, below_ma_pct: -5, above_ma_pct: 25, dividend_cut_pct: 10 };
const NEW_FLAG_DEFAULTS: Partial<Record<EnableKey, boolean>> = {
  from_high_enabled: false, below_ma_enabled: false, above_ma_enabled: false, dividend_cut_enabled: false,
  tax_harvest_enabled: true, fx_historical: true,
};
const DEFAULT_HARVEST_MONTH = 11;

const PRESETS: { id: string; label: string; values: Partial<Record<NumKey, number>> }[] = [
  { id: 'conservative', label: '보수적', values: { take_profit_pct: 20, stop_loss_pct: -10, buy_dip_pct: -15, dividend_payback_pct: 30, dividend_payback_min_return_pct: 5, low_yield_pct: 3, high_yield_pct: 6, from_high_pct: -25, below_ma_pct: -8, above_ma_pct: 20, dividend_cut_pct: 5 } },
  { id: 'balanced', label: '균형', values: { take_profit_pct: 30, stop_loss_pct: -20, buy_dip_pct: -10, dividend_payback_pct: 50, dividend_payback_min_return_pct: 10, low_yield_pct: 2, high_yield_pct: 5, from_high_pct: -20, below_ma_pct: -5, above_ma_pct: 25, dividend_cut_pct: 10 } },
  { id: 'aggressive', label: '공격적', values: { take_profit_pct: 50, stop_loss_pct: -30, buy_dip_pct: -7, dividend_payback_pct: 80, dividend_payback_min_return_pct: 20, low_yield_pct: 1.5, high_yield_pct: 4, from_high_pct: -15, below_ma_pct: -3, above_ma_pct: 35, dividend_cut_pct: 20 } },
];

interface Draft {
  nums: Record<NumKey, string>;
  flags: Record<EnableKey, boolean>;
  month: string;
  sell_mode: SignalMode;
  buy_mode: SignalMode;
}

function toDraft(rule: SignalRule): Draft {
  const nums = {} as Record<NumKey, string>;
  NUM_KEYS.forEach((k) => (nums[k] = String(rule[k] ?? NEW_NUM_DEFAULTS[k] ?? 0)));
  const flags = {} as Record<EnableKey, boolean>;
  ENABLE_KEYS.forEach((k) => (flags[k] = rule[k] ?? NEW_FLAG_DEFAULTS[k] ?? false));
  return {
    nums,
    flags,
    month: String(rule.tax_harvest_from_month || DEFAULT_HARVEST_MONTH),
    sell_mode: rule.sell_mode || 'any',
    buy_mode: rule.buy_mode || 'any',
  };
}

function validate(d: Draft): Partial<Record<NumKey, string>> {
  const errs: Partial<Record<NumKey, string>> = {};
  NUM_KEYS.forEach((k) => {
    const raw = d.nums[k].trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) {
      errs[k] = '숫자를 입력하세요';
      return;
    }
    if ((k === 'stop_loss_pct' || k === 'buy_dip_pct' || k === 'from_high_pct' || k === 'below_ma_pct') && n > 0) errs[k] = '0 이하로 입력하세요';
    else if ((k === 'above_ma_pct' || k === 'dividend_cut_pct' || k === 'weight_band_pct') && n < 0) errs[k] = '0 이상으로 입력하세요';
    else if (k === 'target_weight_pct' && (n < 0 || n > 100)) errs[k] = '0~100 사이로 입력하세요';
  });
  return errs;
}

function ModeToggle({ value, onChange, label }: { value: SignalMode; onChange: (m: SignalMode) => void; label: string }) {
  return (
    <div className="glass-pill flex p-0.5" role="group" aria-label={label}>
      {([['any', '하나 이상 충족'], ['all', '모두 충족']] as [SignalMode, string][]).map(([v, text]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`pill-item !px-3 !py-1 !text-xs ${value === v ? 'pill-item-active' : ''}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
        checked ? 'border-mint-400/60 bg-mint-400/30' : 'border-white/15 bg-white/[0.06]'
      }`}
    >
      <span
        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all ${
          checked ? 'left-[18px] bg-mint-300' : 'left-0.5 bg-zinc-400'
        }`}
      />
    </button>
  );
}

interface SignalRuleEditorProps {
  mode: 'default' | 'asset';
  assetId?: number;
  assetName?: string;
  defaultRule: SignalRule;
  assetRule?: SignalRule | null; // 이미 개별 전략이 있으면 전달
  onClose: () => void;
  onSaved: () => void;
}

export default function SignalRuleEditor({ mode, assetId, assetName, defaultRule, assetRule, onClose, onSaved }: SignalRuleEditorProps) {
  const isAsset = mode === 'asset';
  const [useDefault, setUseDefault] = useState(isAsset ? !assetRule : false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(isAsset ? assetRule ?? defaultRule : defaultRule));
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const errors = useMemo(() => validate(draft), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  const readOnly = isAsset && useDefault;

  const setNum = (k: NumKey, v: string) => setDraft((d) => ({ ...d, nums: { ...d.nums, [k]: v } }));
  const setFlag = (k: EnableKey, v: boolean) => setDraft((d) => ({ ...d, flags: { ...d.flags, [k]: v } }));

  const applyPreset = (values: Partial<Record<NumKey, number>>) => {
    setDraft((d) => {
      const nums = { ...d.nums };
      (Object.keys(values) as NumKey[]).forEach((k) => (nums[k] = String(values[k])));
      return { ...d, nums };
    });
  };

  const toggleUseDefault = (v: boolean) => {
    setUseDefault(v);
    // 개별 전략으로 전환하면 (기존 개별 전략이 없을 때) 현재 기본 전략 값에서 시작
    if (!v) setDraft(toDraft(assetRule ?? defaultRule));
    else setDraft(toDraft(defaultRule));
  };

  const buildRule = (): SignalRule => {
    const base: SignalRule = {
      ...(isAsset ? assetRule ?? defaultRule : defaultRule),
      asset_id: isAsset ? assetId ?? 0 : 0,
      sell_mode: draft.sell_mode,
      buy_mode: draft.buy_mode,
    };
    if (isAsset && !assetRule) delete base.id;
    NUM_KEYS.forEach((k) => (base[k] = Number(draft.nums[k])));
    ENABLE_KEYS.forEach((k) => (base[k] = draft.flags[k]));
    const month = Math.round(Number(draft.month));
    base.tax_harvest_from_month = month >= 1 && month <= 12 ? month : DEFAULT_HARVEST_MONTH;
    return base;
  };

  const handleSave = async () => {
    setTouched(true);
    setSubmitError(null);
    if (!readOnly && hasErrors) return;
    try {
      setSaving(true);
      if (!isAsset) {
        await apiClient.SaveDefaultSignalRule(buildRule());
      } else if (useDefault) {
        if (assetRule) await apiClient.DeleteAssetSignalRule(assetId!);
      } else {
        await apiClient.SaveAssetSignalRule(assetId!, buildRule());
      }
      onSaved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : typeof err === 'string' && err ? err : '전략 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const renderRule = (def: RuleDef) => {
    const on = draft.flags[def.enabled];
    return (
      <div key={def.enabled} className="surface-inset p-3.5">
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <Switch checked={on} onChange={(v) => setFlag(def.enabled, v)} label={def.label} disabled={readOnly} />
          </div>
          <div className="min-w-0 flex-1 sm:flex sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 sm:flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={`text-sm font-medium ${on ? 'text-white' : 'text-zinc-400'}`}>{def.label}</span>
                {def.note && mode === 'default' && <span className="badge border border-amber-400/25 bg-amber-400/10 text-amber-200">{def.note}</span>}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{def.desc}</p>
            </div>
            <div className={`mt-2.5 flex flex-wrap gap-x-4 gap-y-2 transition-opacity sm:mt-0 sm:shrink-0 ${on ? '' : 'opacity-50'}`}>
              {def.fields.map((f) => {
                const err = (touched || draft.nums[f.key] !== '') && errors[f.key];
                return (
                  <div key={f.key}>
                    <label className="field-label !mb-1" htmlFor={`rule-${f.key}`}>{f.label}</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id={`rule-${f.key}`}
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={draft.nums[f.key]}
                        disabled={readOnly}
                        onChange={(e) => setNum(f.key, e.target.value)}
                        className={`input-field num !w-24 !py-1.5 text-right ${err ? '!border-rose-400/60' : ''}`}
                      />
                      <span className="label-mono !text-zinc-400">{f.suffix}</span>
                    </div>
                    {err && <p className="mt-1 text-[11px] text-rose-300">{err}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isAsset ? '종목별 전략 설정' : '기본 전략 설정'}
        className="surface flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="section-title !text-lg">{isAsset ? '종목별 전략 설정' : '기본 전략 설정'}</h2>
            <p className="label-mono mt-0.5 truncate">
              {isAsset ? assetName : '개별 전략이 없는 모든 종목에 적용'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {isAsset && (
            <div className="surface-inset flex items-center justify-between gap-3 p-3.5">
              <div>
                <div className="text-sm font-medium text-white">기본 전략 사용</div>
                <p className="mt-0.5 text-xs text-zinc-500">끄면 이 종목에만 적용되는 개별 전략을 만듭니다. 시작 값은 현재 기본 전략입니다.</p>
              </div>
              <Switch checked={useDefault} onChange={toggleUseDefault} label="기본 전략 사용" />
            </div>
          )}

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="label-mono">프리셋</span>
              <div className="glass-pill flex p-0.5" role="group" aria-label="프리셋">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" onClick={() => applyPreset(p.values)} className="pill-item !px-3 !py-1 !text-xs">
                    {p.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-zinc-600">기준 값만 채우며 켜짐 상태는 유지됩니다</span>
            </div>
          )}

          {readOnly && (
            <p className="text-xs text-zinc-500">현재 기본 전략이 적용 중입니다. 아래는 기본 전략 값이며 수정하려면 위 스위치를 끄세요.</p>
          )}

          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="label-mono !text-rose-300">매도 조건</h3>
              <ModeToggle value={draft.sell_mode} onChange={(m) => !readOnly && setDraft((d) => ({ ...d, sell_mode: m }))} label="매도 조건 충족 방식" />
            </div>
            {SELL_RULES.map(renderRule)}
          </section>

          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="label-mono !text-mint-300">매수 조건</h3>
              <ModeToggle value={draft.buy_mode} onChange={(m) => !readOnly && setDraft((d) => ({ ...d, buy_mode: m }))} label="매수 조건 충족 방식" />
            </div>
            {BUY_RULES.map(renderRule)}
          </section>

          <section className="space-y-2.5">
            <h3 className="label-mono">기타</h3>
            <div className="surface-inset p-3.5">
              <div className="flex items-start gap-3">
                <div className="pt-0.5">
                  <Switch checked={draft.flags.fx_historical} onChange={(v) => setFlag('fx_historical', v)} label="매수 시점 환율로 수익률 계산" disabled={readOnly} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`text-sm font-medium ${draft.flags.fx_historical ? 'text-white' : 'text-zinc-400'}`}>매수 시점 환율로 수익률 계산</span>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">해외 종목의 원화 수익률을 매수 당시 환율 기준으로 계산합니다. 거래 기록이 없는 수량은 현재 환율을 사용합니다.</p>
                </div>
              </div>
            </div>
            <div className="surface-inset p-3.5">
              <div className="flex items-start gap-3">
                <div className="pt-0.5">
                  <Switch checked={draft.flags.tax_harvest_enabled} onChange={(v) => setFlag('tax_harvest_enabled', v)} label="연말 절세 힌트" disabled={readOnly} />
                </div>
                <div className="min-w-0 flex-1 sm:flex sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 sm:flex-1">
                    <span className={`text-sm font-medium ${draft.flags.tax_harvest_enabled ? 'text-white' : 'text-zinc-400'}`}>연말 절세 힌트</span>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">해외주식 양도세 기본공제 활용을 위한 이익 실현 / 손실 상계 힌트를 표시합니다.</p>
                  </div>
                  <div className={`mt-2.5 flex items-center gap-1.5 transition-opacity sm:mt-0 sm:shrink-0 ${draft.flags.tax_harvest_enabled ? '' : 'opacity-50'}`}>
                    <select
                      aria-label="절세 힌트 시작 월"
                      value={draft.month}
                      disabled={readOnly}
                      onChange={(e) => setDraft((d) => ({ ...d, month: e.target.value }))}
                      className="input-field num !w-20 !py-1.5"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>{m}월</option>
                      ))}
                    </select>
                    <span className="label-mono !text-zinc-400">부터</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {submitError && (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{submitError}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-4 sm:px-6">
          {touched && hasErrors && !readOnly && <span className="mr-auto text-xs text-rose-300">입력값을 확인하세요</span>}
          <button type="button" onClick={onClose} className="btn-ghost">취소</button>
          <button type="button" onClick={handleSave} disabled={saving || (!readOnly && touched && hasErrors)} className="btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
