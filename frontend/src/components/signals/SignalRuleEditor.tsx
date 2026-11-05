import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { apiClient } from '../../api/client';
import { SignalMode, SignalProfile, SignalRule } from '../../types/models';

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
  | 'dividend_cut_pct'
  | 'crash_pct'
  | 'min_sell_qty'
  | 'trailing_activate_pct'
  | 'trailing_drop_pct'
  | 'annualized_pct'
  | 'annualized_min_days'
  | 'annualized_min_return_pct'
  | 'drift_pct'
  | 'partial_pct'
  | 'yield_compression_pct'
  | 'vol_overheat_sigma'
  | 'vol_oversold_sigma';

type EnableKey =
  | 'from_high_enabled'
  | 'below_ma_enabled'
  | 'above_ma_enabled'
  | 'dividend_cut_enabled'
  | 'crash_enabled'
  | 'min_sell_qty_enabled'
  | 'trailing_enabled'
  | 'annualized_enabled'
  | 'drift_enabled'
  | 'partial_enabled'
  | 'tax_harvest_enabled'
  | 'fx_historical'
  | 'take_profit_enabled'
  | 'stop_loss_enabled'
  | 'weight_enabled'
  | 'dividend_payback_enabled'
  | 'low_yield_enabled'
  | 'buy_dip_enabled'
  | 'high_yield_enabled'
  | 'yield_compression_enabled'
  | 'vol_overheat_enabled'
  | 'vol_oversold_enabled';

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

// 수익 실현 조건
const SELL_PROFIT_RULES: RuleDef[] = [
  { enabled: 'take_profit_enabled', label: '목표 수익률 도달', desc: '실질 수익률이 목표 이상이면 이익 실현을 검토합니다.', fields: [{ key: 'take_profit_pct', label: '목표', suffix: '%' }] },
  {
    enabled: 'trailing_enabled',
    label: '고점 대비 되돌림 (추적 익절)',
    desc: '수익률이 활성 기준을 넘은 뒤 매수 이후 최고가에서 기준만큼 떨어지면 매도를 검토합니다. 오르는 동안에는 신호를 내지 않습니다.',
    fields: [
      { key: 'trailing_activate_pct', label: '활성 수익률', suffix: '%' },
      { key: 'trailing_drop_pct', label: '고점 대비', suffix: '%' },
    ],
  },
  {
    enabled: 'annualized_enabled',
    label: '연환산 수익률',
    desc: '보유 기간으로 환산한 연 수익률이 기준 이상이면 매도를 검토합니다. 짧은 기간의 일시적 급등을 거르기 위해 최소 보유 일수와 최소 수익률을 함께 봅니다.',
    fields: [
      { key: 'annualized_pct', label: '연 수익률', suffix: '%' },
      { key: 'annualized_min_days', label: '최소 보유', suffix: '일' },
      { key: 'annualized_min_return_pct', label: '최소 수익률', suffix: '%' },
    ],
  },
  {
    enabled: 'drift_enabled',
    label: '비중 쏠림',
    desc: '시세 상승으로 현재 비중이 투자 원금 비중보다 기준 이상 커지면 일부 매도(리밸런싱)를 검토합니다.',
    fields: [{ key: 'drift_pct', label: '원금 비중 대비', suffix: '%p' }],
  },
  {
    enabled: 'yield_compression_enabled',
    label: '배당수익률 압축',
    desc: '현재 배당수익률이 이 종목의 최근 24개월 평균보다 기준 이상 낮으면, 배당보다 주가가 앞서 오른 것으로 보고 매도(일부 익절)를 검토합니다. 배당 이력이 6개월 이상 있어야 계산합니다.',
    fields: [{ key: 'yield_compression_pct', label: '평균 대비', suffix: '% 낮음' }],
  },
  {
    enabled: 'vol_overheat_enabled',
    label: '변동성 대비 과열',
    desc: '200일 이동평균선과의 괴리를 종목 자신의 연 변동성으로 나눠 판단합니다. 변동성이 큰 기술주와 잔잔한 ETF를 같은 잣대(σ)로 비교할 수 있어, 고정 %를 쓰는 장기 이평 과열 조건을 대신해 쓸 수 있습니다.',
    fields: [{ key: 'vol_overheat_sigma', label: '200일선 대비', suffix: 'σ 이상' }],
  },
];

// 위험 관리 조건
const SELL_RISK_RULES: RuleDef[] = [
  { enabled: 'stop_loss_enabled', label: '손절 기준', desc: '실질 수익률이 기준 이하로 내려가면 손절을 검토합니다.', fields: [{ key: 'stop_loss_pct', label: '기준', suffix: '%' }] },
  { enabled: 'crash_enabled', label: '큰 폭락 경고', desc: '실질 수익률이 기준 이하로 폭락하면 경고합니다. 손절 대신 쓰는 장기보유용 안전장치입니다.', fields: [{ key: 'crash_pct', label: '기준', suffix: '%' }] },
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

// 매도 제외 조건: 충족되면 위 매도 조건이 맞아도 매도 검토에서 뺀다
const SELL_EXCLUDE_RULES: RuleDef[] = [
  {
    enabled: 'min_sell_qty_enabled',
    label: '소량 보유 매도 제외',
    desc: '보유 수량(모든 계좌 합계)이 기준 이하이면 매도 조건을 충족해도 매도 검토에서 제외합니다. 소수점 수량도 포함됩니다.',
    fields: [{ key: 'min_sell_qty', label: '기준', suffix: '주 이하' }],
  },
];

// 매도 수량 제안
const SELL_QTY_RULES: RuleDef[] = [
  {
    enabled: 'partial_enabled',
    label: '분할 익절',
    desc: '수익 실현 신호일 때 전량 대신 일부 매도 수량을 제안합니다. 비중 쏠림이면 원금 비중으로 되돌리는 수량을 제안합니다. 손절·위험 신호는 전량 검토로 표시합니다.',
    fields: [{ key: 'partial_pct', label: '보유 수량의', suffix: '%' }],
  },
];

const BUY_RULES: RuleDef[] = [
  { enabled: 'buy_dip_enabled', label: '평단 대비 하락', desc: '현재가가 평단보다 기준 이상 낮으면 추가 매수를 검토합니다.', fields: [{ key: 'buy_dip_pct', label: '기준', suffix: '%' }] },
  { enabled: 'high_yield_enabled', label: '배당수익률 상승', desc: '현재가 기준 배당수익률이 기준 이상이면 매수를 검토합니다.', fields: [{ key: 'high_yield_pct', label: '기준', suffix: '%' }] },
  { enabled: 'from_high_enabled', label: '52주 고점 대비 하락', desc: '현재가가 52주 최고가보다 기준 이상 낮으면 매수를 검토합니다.', fields: [{ key: 'from_high_pct', label: '기준', suffix: '%' }] },
  { enabled: 'below_ma_enabled', label: '장기 이평 하회', desc: '현재가가 200일 이동평균선보다 기준 이상 낮으면 매수를 검토합니다.', fields: [{ key: 'below_ma_pct', label: '기준', suffix: '%' }] },
  {
    enabled: 'vol_oversold_enabled',
    label: '변동성 대비 과매도',
    desc: '200일 이동평균선과의 괴리를 종목 자신의 연 변동성으로 나눠 판단합니다. 양수로 입력하며 −σ 이하(예: 1.5 → −1.5σ)일 때 매수를 검토합니다. 고정 %를 쓰는 장기 이평 하회 조건을 대신해 쓸 수 있습니다.',
    fields: [{ key: 'vol_oversold_sigma', label: '200일선 대비', suffix: 'σ 이하' }],
  },
];

const NUM_KEYS: NumKey[] = [
  'take_profit_pct', 'stop_loss_pct', 'target_weight_pct', 'weight_band_pct', 'dividend_payback_pct',
  'dividend_payback_min_return_pct', 'low_yield_pct', 'buy_dip_pct', 'high_yield_pct',
  'from_high_pct', 'below_ma_pct', 'above_ma_pct', 'dividend_cut_pct', 'crash_pct', 'min_sell_qty',
  'trailing_activate_pct', 'trailing_drop_pct', 'annualized_pct', 'annualized_min_days', 'annualized_min_return_pct', 'drift_pct', 'partial_pct',
  'yield_compression_pct', 'vol_overheat_sigma', 'vol_oversold_sigma',
];
const ENABLE_KEYS: EnableKey[] = [
  'take_profit_enabled', 'stop_loss_enabled', 'weight_enabled', 'dividend_payback_enabled',
  'low_yield_enabled', 'buy_dip_enabled', 'high_yield_enabled',
  'from_high_enabled', 'below_ma_enabled', 'above_ma_enabled', 'dividend_cut_enabled', 'crash_enabled',
  'tax_harvest_enabled', 'fx_historical', 'min_sell_qty_enabled',
  'trailing_enabled', 'annualized_enabled', 'drift_enabled', 'partial_enabled',
  'yield_compression_enabled', 'vol_overheat_enabled', 'vol_oversold_enabled',
];

// 2단계 필드 기본값 (구 백엔드가 내려주지 않을 때 균형 값으로 채움)
const NEW_NUM_DEFAULTS: Partial<Record<NumKey, number>> = { from_high_pct: -20, below_ma_pct: -5, above_ma_pct: 25, dividend_cut_pct: 10, crash_pct: -40, min_sell_qty: 1,
  trailing_activate_pct: 20, trailing_drop_pct: -10, annualized_pct: 25, annualized_min_days: 90, annualized_min_return_pct: 15, drift_pct: 7, partial_pct: 33,
  yield_compression_pct: 20, vol_overheat_sigma: 1.5, vol_oversold_sigma: 1.5,
};
const NEW_FLAG_DEFAULTS: Partial<Record<EnableKey, boolean>> = {
  from_high_enabled: false, below_ma_enabled: false, above_ma_enabled: false, dividend_cut_enabled: false, crash_enabled: false,
  tax_harvest_enabled: true, fx_historical: true, min_sell_qty_enabled: true,
  trailing_enabled: true, annualized_enabled: false, drift_enabled: false, partial_enabled: true,
  yield_compression_enabled: false, vol_overheat_enabled: false, vol_oversold_enabled: false,
};
const DEFAULT_HARVEST_MONTH = 11;

const PRESETS: { id: string; label: string; values: Partial<Record<NumKey, number>> }[] = [
  { id: 'conservative', label: '보수적', values: { take_profit_pct: 20, stop_loss_pct: -10, buy_dip_pct: -15, dividend_payback_pct: 30, dividend_payback_min_return_pct: 5, low_yield_pct: 3, high_yield_pct: 6, from_high_pct: -25, below_ma_pct: -8, above_ma_pct: 20, dividend_cut_pct: 5, crash_pct: -30, trailing_activate_pct: 15, trailing_drop_pct: -7, annualized_pct: 20, annualized_min_days: 60, annualized_min_return_pct: 10, drift_pct: 5, partial_pct: 50, yield_compression_pct: 15, vol_overheat_sigma: 1.2, vol_oversold_sigma: 1.2 } },
  { id: 'balanced', label: '균형', values: { take_profit_pct: 30, stop_loss_pct: -20, buy_dip_pct: -10, dividend_payback_pct: 50, dividend_payback_min_return_pct: 10, low_yield_pct: 2, high_yield_pct: 5, from_high_pct: -20, below_ma_pct: -5, above_ma_pct: 25, dividend_cut_pct: 10, crash_pct: -40, trailing_activate_pct: 20, trailing_drop_pct: -10, annualized_pct: 25, annualized_min_days: 90, annualized_min_return_pct: 15, drift_pct: 7, partial_pct: 33, yield_compression_pct: 20, vol_overheat_sigma: 1.5, vol_oversold_sigma: 1.5 } },
  { id: 'aggressive', label: '공격적', values: { take_profit_pct: 50, stop_loss_pct: -30, buy_dip_pct: -7, dividend_payback_pct: 80, dividend_payback_min_return_pct: 20, low_yield_pct: 1.5, high_yield_pct: 4, from_high_pct: -15, below_ma_pct: -3, above_ma_pct: 35, dividend_cut_pct: 20, crash_pct: -50, trailing_activate_pct: 30, trailing_drop_pct: -15, annualized_pct: 35, annualized_min_days: 120, annualized_min_return_pct: 25, drift_pct: 10, partial_pct: 25, yield_compression_pct: 30, vol_overheat_sigma: 2, vol_oversold_sigma: 2 } },
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
    if ((k === 'stop_loss_pct' || k === 'buy_dip_pct' || k === 'from_high_pct' || k === 'below_ma_pct' || k === 'crash_pct') && n > 0) errs[k] = '0 이하로 입력하세요';
    else if (k === 'trailing_drop_pct' && n >= 0) errs[k] = '0보다 작게 입력하세요 (예: -10)';
    else if (k === 'drift_pct' && n <= 0) errs[k] = '0보다 크게 입력하세요';
    else if ((k === 'yield_compression_pct' || k === 'vol_overheat_sigma' || k === 'vol_oversold_sigma') && (n <= 0 || n > (k === 'yield_compression_pct' ? 100 : 10))) errs[k] = k === 'yield_compression_pct' ? '0보다 크고 100 이하로 입력하세요' : '0보다 크고 10 이하로 입력하세요';
    else if (k === 'partial_pct' && (n < 1 || n > 100)) errs[k] = '1~100 사이로 입력하세요';
    else if (k === 'annualized_min_days' && (!Number.isInteger(n) || n < 1 || n > 3650)) errs[k] = '1~3650 사이 정수로 입력하세요';
    else if ((k === 'above_ma_pct' || k === 'dividend_cut_pct' || k === 'weight_band_pct' || k === 'min_sell_qty' || k === 'trailing_activate_pct' || k === 'annualized_pct' || k === 'annualized_min_return_pct') && n < 0) errs[k] = '0 이상으로 입력하세요';
    else if (k === 'target_weight_pct' && (n < 0 || n > 100)) errs[k] = '0~100 사이로 입력하세요';
  });
  return errs;
}

export function ModeToggle({ value, onChange, label }: { value: SignalMode; onChange: (m: SignalMode) => void; label: string }) {
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


function useRuleDraft(initial: SignalRule) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const errors = useMemo(() => validate(draft), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  const setNum = (k: NumKey, v: string) => setDraft((d) => ({ ...d, nums: { ...d.nums, [k]: v } }));
  const setFlag = (k: EnableKey, v: boolean) => setDraft((d) => ({ ...d, flags: { ...d.flags, [k]: v } }));
  const applyPreset = (values: Partial<Record<NumKey, number>>) => {
    setDraft((d) => {
      const nums = { ...d.nums };
      (Object.keys(values) as NumKey[]).forEach((k) => (nums[k] = String(values[k])));
      return { ...d, nums };
    });
  };
  return { draft, setDraft, errors, hasErrors, setNum, setFlag, applyPreset };
}
type RuleDraft = ReturnType<typeof useRuleDraft>;

function buildRule(base: SignalRule, d: Draft): SignalRule {
  const rule: SignalRule = { ...base, sell_mode: d.sell_mode, buy_mode: d.buy_mode };
  NUM_KEYS.forEach((k) => (rule[k] = Number(d.nums[k])));
  ENABLE_KEYS.forEach((k) => (rule[k] = d.flags[k]));
  const month = Math.round(Number(d.month));
  rule.tax_harvest_from_month = month >= 1 && month <= 12 ? month : DEFAULT_HARVEST_MONTH;
  return rule;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : typeof err === 'string' && err ? err : fallback;
}

// 규칙 입력 폼 본문 (프로필 편집 / 종목 편집 공용)
function RuleFields({ rd, readOnly, touched, showNote, readOnlyHint }: { rd: RuleDraft; readOnly: boolean; touched: boolean; showNote: boolean; readOnlyHint?: string }) {
  const { draft, errors, setDraft, setNum, setFlag, applyPreset } = rd;

  const renderRule = (def: RuleDef) => {
    const on = draft.flags[def.enabled];
    return (
      <div key={def.enabled} className="surface-inset p-3.5">
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <Switch checked={on} onChange={(v) => setFlag(def.enabled, v)} label={def.label} disabled={readOnly} />
          </div>
          <div className={`min-w-0 flex-1 ${def.fields.length > 2 ? '' : 'sm:flex sm:items-start sm:justify-between sm:gap-4'}`}>
            <div className="min-w-0 sm:flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={`text-sm font-medium ${on ? 'text-white' : 'text-zinc-400'}`}>{def.label}</span>
                {def.note && showNote && <span className="badge border border-amber-400/25 bg-amber-400/10 text-amber-200">{def.note}</span>}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{def.desc}</p>
            </div>
            <div className={`mt-2.5 flex flex-wrap gap-x-4 gap-y-2 transition-opacity ${def.fields.length > 2 ? '' : 'sm:mt-0 sm:shrink-0'} ${on ? '' : 'opacity-50'}`}>
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
    <div className="space-y-5">
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

      {readOnly && readOnlyHint && <p className="text-xs text-zinc-500">{readOnlyHint}</p>}

      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="label-mono !text-rose-300">매도 조건</h3>
          <ModeToggle value={draft.sell_mode} onChange={(m) => !readOnly && setDraft((d) => ({ ...d, sell_mode: m }))} label="매도 조건 충족 방식" />
        </div>
        <p className="label-mono !text-mint-300">수익 실현</p>
        {SELL_PROFIT_RULES.map(renderRule)}
        <p className="label-mono !mt-4 !text-rose-300">위험 관리</p>
        {SELL_RISK_RULES.map(renderRule)}
        <p className="label-mono !mt-4">매도 제외</p>
        {SELL_EXCLUDE_RULES.map(renderRule)}
        <p className="label-mono !mt-4">매도 수량</p>
        {SELL_QTY_RULES.map(renderRule)}
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
    </div>
  );
}

interface ProfileRuleEditorProps {
  profile: SignalProfile;
  onSaved: (p: SignalProfile) => void;
}

// 프로필의 규칙을 편집하는 인라인 편집기 (ProfileManager 오른쪽 패널에 들어간다). profile 이 바뀌면 key 로 다시 마운트할 것.
export function ProfileRuleEditor({ profile, onSaved }: ProfileRuleEditorProps) {
  const rd = useRuleDraft(profile.rule);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (!savedAt) return;
    const t = window.setTimeout(() => setSavedAt(0), 2200);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const handleSave = async () => {
    setTouched(true);
    setSubmitError(null);
    if (rd.hasErrors) return;
    try {
      setSaving(true);
      const saved = await apiClient.UpdateSignalProfile(profile.id, { rule: buildRule(profile.rule, rd.draft) });
      setSavedAt(Date.now());
      onSaved(saved);
    } catch (err) {
      setSubmitError(errorMessage(err, '전략 저장에 실패했습니다.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <RuleFields rd={rd} readOnly={false} touched={touched} showNote />
      {submitError && <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{submitError}</div>}
      <div className="mt-5 flex items-center justify-end gap-3">
        {touched && rd.hasErrors && <span className="mr-auto text-xs text-rose-300">입력값을 확인하세요</span>}
        {savedAt > 0 && <span className="text-xs text-mint-300">저장했습니다</span>}
        <button type="button" onClick={handleSave} disabled={saving || (touched && rd.hasErrors)} className="btn-primary">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          전략 저장
        </button>
      </div>
    </div>
  );
}

interface SignalRuleEditorProps {
  assetId: number;
  assetName: string;
  profiles: SignalProfile[];
  currentProfileId?: number; // 현재 이 종목이 속한 프로필
  assetRule?: SignalRule | null; // 이미 개별 전략이 있으면 전달
  onClose: () => void;
  onSaved: () => void;
}

// 종목별 전략 설정: 프로필 따르기 / 이 종목만 개별 전략
export default function SignalRuleEditor({ assetId, assetName, profiles, currentProfileId, assetRule, onClose, onSaved }: SignalRuleEditorProps) {
  const fallbackProfile = profiles.find((p) => p.key === 'default') ?? profiles[0];
  const [choice, setChoice] = useState<'profile' | 'own'>(assetRule ? 'own' : 'profile');
  const [profileId, setProfileId] = useState<number>(currentProfileId ?? fallbackProfile?.id ?? 0);
  const selected = profiles.find((p) => p.id === profileId) ?? fallbackProfile;
  const emptyRule = {} as SignalRule;
  const rd = useRuleDraft(assetRule ?? selected?.rule ?? emptyRule);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const readOnly = choice === 'profile';

  const pickChoice = (c: 'profile' | 'own') => {
    setChoice(c);
    // 개별 전략으로 전환하면 기존 개별 전략, 없으면 선택된 프로필 값에서 시작
    rd.setDraft(toDraft(c === 'own' ? assetRule ?? selected?.rule ?? emptyRule : selected?.rule ?? emptyRule));
  };

  const pickProfile = (id: number) => {
    setProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (p) rd.setDraft(toDraft(p.rule));
  };

  const handleSave = async () => {
    setTouched(true);
    setSubmitError(null);
    if (!readOnly && rd.hasErrors) return;
    try {
      setSaving(true);
      if (choice === 'profile') {
        if (assetRule) await apiClient.DeleteAssetSignalRule(assetId);
        if (profileId && profileId !== currentProfileId) await apiClient.AssignSignalProfile(profileId, [assetId]);
      } else {
        const base: SignalRule = { ...(assetRule ?? selected?.rule ?? emptyRule), asset_id: assetId };
        if (!assetRule) delete base.id;
        await apiClient.SaveAssetSignalRule(assetId, buildRule(base, rd.draft));
      }
      onSaved();
    } catch (err) {
      setSubmitError(errorMessage(err, '전략 저장에 실패했습니다.'));
    } finally {
      setSaving(false);
    }
  };

  const choices: { value: 'profile' | 'own'; title: string; desc: string }[] = [
    { value: 'profile', title: '프로필 따르기', desc: '선택한 전략 프로필의 규칙을 그대로 사용합니다.' },
    { value: 'own', title: '이 종목만 개별 전략', desc: '이 종목에만 적용되는 규칙을 만듭니다. 시작 값은 프로필 값입니다.' },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="종목별 전략 설정"
        className="surface flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="section-title !text-lg">종목별 전략 설정</h2>
            <p className="label-mono mt-0.5 truncate">{assetName}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div role="radiogroup" aria-label="전략 적용 방식" className="grid gap-2.5 sm:grid-cols-2">
            {choices.map((c) => {
              const active = choice === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => pickChoice(c.value)}
                  className={`surface-inset p-3.5 text-left transition-colors ${active ? '!border-mint-400/50 !bg-mint-400/[0.08]' : 'hover:!border-white/20'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? 'border-mint-400' : 'border-white/25'}`}>
                      {active && <span className="h-2 w-2 rounded-full bg-mint-400" />}
                    </span>
                    <span className={`text-sm font-medium ${active ? 'text-white' : 'text-zinc-300'}`}>{c.title}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{c.desc}</p>
                </button>
              );
            })}
          </div>

          {choice === 'profile' && (
            <div>
              <label className="field-label" htmlFor="asset-profile-select">전략 프로필</label>
              <select id="asset-profile-select" className="input-field" value={profileId} onChange={(e) => pickProfile(Number(e.target.value))}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.built_in ? ' (기본 제공)' : ''}
                    {p.kind === 'dividend' ? ' · 배당형' : ''}
                  </option>
                ))}
              </select>
              {selected?.description && <p className="mt-1.5 text-xs text-zinc-500">{selected.description}</p>}
              {assetRule && <p className="mt-1.5 text-xs text-amber-200">저장하면 이 종목의 기존 개별 전략은 삭제됩니다.</p>}
            </div>
          )}

          <RuleFields
            rd={rd}
            readOnly={readOnly}
            touched={touched}
            showNote={false}
            readOnlyHint={`선택한 프로필(${selected?.name ?? ''})의 규칙입니다. 값을 바꾸려면 프로필 관리에서 수정하거나 '이 종목만 개별 전략'을 선택하세요.`}
          />

          {submitError && (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{submitError}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-4 sm:px-6">
          {touched && rd.hasErrors && !readOnly && <span className="mr-auto text-xs text-rose-300">입력값을 확인하세요</span>}
          <button type="button" onClick={onClose} className="btn-ghost">취소</button>
          <button type="button" onClick={handleSave} disabled={saving || (!readOnly && touched && rd.hasErrors)} className="btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            저장
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
