/**
 * 직접 환전 수수료 — 원화·외화 따로 계좌에서 원화예수금을 외화예수금(달러)으로 바꿀 때 (또는 반대로).
 * 수수료 = 기본 수수료 × (1 − 우대율). 정규 시간(평일 09:00~15:30, 한국 시간)과 그 외(밤·주말)의 우대율이 다르다.
 * 공휴일은 모른다 (평일이면 정규 시간으로 본다). 서버 models/fx_fee.go 와 같은 규칙.
 */

export interface FxRuleInput {
  fx_spread_pct: number;
  fx_day_disc_pct: number;
  fx_off_disc_pct: number;
}

export const NO_FX_RULE: FxRuleInput = { fx_spread_pct: 0, fx_day_disc_pct: 0, fx_off_disc_pct: 0 };

/** 알려진 증권사 기준 (계좌 화면의 '기준 넣기') — 토스증권: 기본 1%, 정규 시간 95% 우대, 그 외 50% 우대 */
export const FX_PRESETS: Record<string, FxRuleInput> = {
  토스증권: { fx_spread_pct: 1, fx_day_disc_pct: 95, fx_off_disc_pct: 50 },
};

export interface FxRule {
  spread: number;
  dayDisc: number;
  offDisc: number;
}

type RuleSource = { fx_spread_pct?: number; fx_day_disc_pct?: number; fx_off_disc_pct?: number } | null | undefined;

/** 계좌(또는 오늘 화면의 살 계좌)의 직접 환전 수수료 — 기본 수수료가 없으면 null (모름) */
export function fxRuleOf(x: RuleSource): FxRule | null {
  const spread = x?.fx_spread_pct ?? 0;
  if (!(spread > 0)) return null;
  return { spread, dayDisc: x?.fx_day_disc_pct ?? 0, offDisc: x?.fx_off_disc_pct ?? 0 };
}

/** 정규 시간 / 그 외 시간 수수료 (%) */
export const feeDay = (r: FxRule) => r.spread * (1 - r.dayDisc / 100);
export const feeOff = (r: FxRule) => r.spread * (1 - r.offDisc / 100);

/** 그 시각이 정규 환전 시간(평일 09:00~15:30, 한국 시간)인지 — 기기 시간대와 상관없이 */
export function fxDayHours(d: Date = new Date()): boolean {
  const k = new Date(d.getTime() + 9 * 3600_000);
  const wd = k.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  const m = k.getUTCHours() * 60 + k.getUTCMinutes();
  return m >= 9 * 60 && m < 15 * 60 + 30;
}

/** 지금(그 시각) 환전 수수료와 우대율 */
export function fxFeeAt(r: FxRule, d: Date = new Date()) {
  const day = fxDayHours(d);
  return { day, pct: day ? feeDay(r) : feeOff(r), disc: day ? r.dayDisc : r.offDisc };
}

/** 달러 usd 를 사려면 드는 원화 (수수료 포함, 원 단위 올림) */
export const krwForUSD = (usd: number, fx: number, feePct: number) => Math.ceil(usd * fx * (1 + feePct / 100));

/** 수수료율 표시: 0.05% · 0.5% · 1% */
export const pctText = (v: number) => `${Number(v.toFixed(3))}%`;
