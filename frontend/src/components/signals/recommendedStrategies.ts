import type { ProfileKind, SignalRule } from '../../types/models';

// 추천 전략 프리셋 (프론트 전용). 조건(켜짐·기준값·충족 방식)만 바꾸고 수량·분할·쿨다운 등 운용 설정은 건드리지 않는다.

export interface RecommendedStrategy {
  id: string;
  label: string;
  /** 프로필 이름 등에 붙이는 짧은 이름 */
  short: string;
  kind: ProfileKind;
  summary: string;
  patch: Partial<SignalRule>;
}

// 추천 적용 시 먼저 모두 끄는 "조건" 켜짐 키 (매도 수익/위험, 매수 신호, 반등 확인)
// 제외(유지): min_sell_qty_*, partial_*, buy_cooldown_*, buy_max_weight_*, buy_qty_*, fx_historical, tax_harvest_*, rebound_ma_enabled
export const CONDITION_ENABLE_KEYS = [
  // 매도 - 수익 실현
  'take_profit_enabled', 'trailing_enabled', 'annualized_enabled', 'drift_enabled', 'yield_compression_enabled',
  'vol_overheat_enabled', 'rsi_sell_enabled', 'mfi_sell_enabled', 'per_sell_enabled', 'pbr_sell_enabled',
  'per_avg_sell_enabled', 'pbr_avg_sell_enabled', 'above_ma_enabled', 'high_yield_enabled', 'dividend_payback_enabled',
  // 매도 - 위험 관리
  'stop_loss_enabled', 'vol_stop_enabled', 'weight_enabled', 'time_stop_enabled', 'short_drop_enabled',
  'dividend_cut_enabled', 'crash_enabled',
  // 매수 신호
  'buy_dip_enabled', 'low_yield_enabled', 'last_buy_dip_enabled', 'yield_expansion_enabled', 'vol_oversold_enabled',
  'below_ma_enabled', 'from_high_enabled', 'rsi_buy_enabled', 'mfi_buy_enabled', 'per_buy_enabled', 'pbr_buy_enabled',
  'per_avg_buy_enabled', 'pbr_avg_buy_enabled',
  // 매수 확인
  'rebound_confirm_enabled',
] as const satisfies readonly (keyof SignalRule)[];

export const RECOMMENDED_STRATEGIES: RecommendedStrategy[] = [
  {
    id: 'general',
    label: '일반 (개별 주식·일반 ETF)',
    short: '일반',
    kind: 'standard',
    summary: '가격 신호와 지표 확인이 2개 이상 겹칠 때만 매수, 과열·고평가가 겹칠 때 분할 익절, 위험은 하나만 걸려도 알림',
    patch: {
      last_buy_dip_enabled: true, last_buy_dip_pct: -10,
      below_ma_enabled: true, below_ma_mode: 'rebound', below_ma_pct: -5,
      from_high_enabled: true, from_high_mode: 'rebound', from_high_pct: -20,
      rsi_buy_enabled: true, rsi_buy_level: 30,
      per_avg_buy_enabled: true, per_avg_buy_pct: 20,
      buy_mode: 'count', buy_min_count: 2,
      trailing_enabled: true, trailing_activate_pct: 20, trailing_drop_pct: -10,
      rsi_sell_enabled: true, rsi_sell_level: 75,
      per_avg_sell_enabled: true, per_avg_sell_pct: 30,
      vol_overheat_enabled: true, vol_overheat_sigma: 1.5,
      sell_profit_min_count: 2,
      vol_stop_enabled: true, vol_stop_k: 1,
      short_drop_enabled: true, short_drop_days: 20, short_drop_pct: -15,
      dividend_cut_enabled: true, dividend_cut_pct: 10,
      sell_risk_min_count: 1,
    },
  },
  {
    id: 'dividend-hold',
    label: '배당 장기보유',
    short: '배당 장기보유',
    kind: 'dividend',
    summary: '배당수익률 확대·저점 반등·저PBR 중 하나만 보여도 매수를 검토하고, 수익률 압축이나 배당 삭감·대폭락 때만 매도를 알립니다.',
    patch: {
      yield_expansion_enabled: true, yield_expansion_pct: 20,
      from_high_enabled: true, from_high_mode: 'rebound', from_high_pct: -20,
      rsi_buy_enabled: true, rsi_buy_level: 30,
      pbr_avg_buy_enabled: true, pbr_avg_buy_pct: 20,
      buy_mode: 'any', buy_min_count: 0,
      yield_compression_enabled: true, yield_compression_pct: 20,
      sell_profit_min_count: 1,
      dividend_cut_enabled: true, dividend_cut_pct: 10,
      crash_enabled: true, crash_pct: -40,
      sell_risk_min_count: 1,
    },
  },
  {
    id: 'growth-short',
    label: '성장주 단기',
    short: '성장주 단기',
    kind: 'standard',
    summary: '과매도 지표와 이평선 회복·고점 대비 반등이 2개 이상 겹칠 때 매수, 과열 지표나 고점 하락 시 빠르게 익절·손절을 검토합니다.',
    patch: {
      rsi_buy_enabled: true, rsi_buy_level: 30,
      mfi_buy_enabled: true, mfi_buy_level: 20,
      below_ma_enabled: true, below_ma_mode: 'reclaim', below_ma_pct: -5, below_ma_reclaim_days: 10,
      from_high_enabled: true, from_high_mode: 'rebound', from_high_pct: -20,
      buy_mode: 'count', buy_min_count: 2,
      rsi_sell_enabled: true, rsi_sell_level: 70,
      mfi_sell_enabled: true, mfi_sell_level: 80,
      trailing_enabled: true, trailing_activate_pct: 15, trailing_drop_pct: -8,
      sell_profit_min_count: 1,
      vol_stop_enabled: true, vol_stop_k: 1,
      short_drop_enabled: true, short_drop_days: 20, short_drop_pct: -15,
      sell_risk_min_count: 1,
    },
  },
  {
    id: 'covered-call-income',
    label: '커버드콜·인컴 ETF',
    short: '커버드콜·인컴',
    kind: 'dividend',
    summary: '분배금 중심 ETF용: 분배율이 높아지면 매수, 낮아지면 익절을 검토하고 단기 급락이나 장기 정체(시간 손절)만 위험으로 봅니다.',
    patch: {
      yield_expansion_enabled: true, yield_expansion_pct: 20,
      buy_mode: 'any', buy_min_count: 0,
      yield_compression_enabled: true, yield_compression_pct: 20,
      sell_profit_min_count: 1,
      short_drop_enabled: true, short_drop_days: 20, short_drop_pct: -15,
      time_stop_enabled: true, time_stop_days: 365, time_stop_max_return_pct: 0,
      sell_risk_min_count: 1,
    },
  },
  {
    // CONY·TSLY 같은 YieldMax, 팔란티어·테슬라 커버드콜처럼 한 종목에 기대는 고분배 상품.
    // 분배금 대부분이 원금 반환이라 주가가 깎이므로 분배금 포함 총수익률로 판단하고,
    // 주가가 빠질수록 분배율이 높아 보이는 착시를 피하려고 배당수익률 기준 매수는 쓰지 않는다.
    id: 'single-stock-option-income',
    label: '고분배 옵션 인컴 (개별 종목 커버드콜)',
    short: '고분배 옵션 인컴',
    kind: 'dividend',
    summary:
      'CONY 같은 YieldMax, 팔란티어·테슬라 커버드콜처럼 한 종목에 기대 분배율이 매우 높은 상품용: 분배금 포함 총수익률이 손절선 아래로 가거나 6개월째 손실이면 정리를, 원금의 절반을 분배금으로 돌려받으면 이익 실현을 검토합니다. 주가가 빠질수록 분배율이 높아 보이는 착시 때문에 배당수익률 기준 매수는 끄고 200일선 회복·과매도 반등이 확인될 때만, 비중 10% 안에서 매수합니다.',
    patch: {
      take_profit_enabled: true, take_profit_pct: 25,
      sell_profit_min_count: 1,
      stop_loss_enabled: true, stop_loss_pct: -20,
      time_stop_enabled: true, time_stop_days: 180, time_stop_max_return_pct: 0,
      dividend_payback_enabled: true, dividend_payback_pct: 50, dividend_payback_min_return_pct: 0,
      short_drop_enabled: true, short_drop_days: 20, short_drop_pct: -20,
      sell_risk_min_count: 1,
      below_ma_enabled: true, below_ma_mode: 'reclaim', below_ma_pct: -5, below_ma_reclaim_days: 10,
      rsi_buy_enabled: true, rsi_buy_level: 30,
      buy_mode: 'any', buy_min_count: 0,
      rebound_confirm_enabled: true,
      // 운용 설정이지만 이 상품군은 비중 관리가 핵심이라 함께 정한다
      buy_max_weight_enabled: true, buy_max_weight_pct: 10,
    },
  },
  {
    id: 'index-accumulate',
    label: '지수 ETF 적립',
    short: '지수 적립',
    kind: 'standard',
    summary: 'S&P 500·나스닥 100·코스피 200 같은 시장 지수 ETF용: 고점 대비 하락 후 반등·200일선 근처 반등·과매도·마지막 매수가 대비 하락 중 하나만 보여도 추가 매수를 검토하고, 매도는 큰 폭락만 알립니다.',
    patch: {
      from_high_enabled: true, from_high_mode: 'rebound', from_high_pct: -10,
      below_ma_enabled: true, below_ma_mode: 'rebound', below_ma_pct: -5,
      rsi_buy_enabled: true, rsi_buy_level: 30,
      last_buy_dip_enabled: true, last_buy_dip_pct: -7,
      buy_mode: 'any', buy_min_count: 0,
      sell_profit_min_count: 1,
      crash_enabled: true, crash_pct: -35,
      sell_risk_min_count: 1,
    },
  },
];

export const INCOME_STRATEGY = RECOMMENDED_STRATEGIES.find((r) => r.id === 'covered-call-income')!;
export const INCOME_PROFILE_NAME = '커버드콜·인컴 ETF';
export const INCOME_PROFILE_DESC = '커버드콜·월배당 등 분배금 중심 ETF용 (배당수익률 압축·확대, 단기 급락, 시간 손절)';

// 조건 켜짐 키를 모두 끈 뒤 patch 를 덮어쓴다. 운용 설정(수량·분할·쿨다운 등)은 그대로 둔다.
export function applyRecommended(rule: SignalRule, patch: Partial<SignalRule>): SignalRule {
  const next: SignalRule = { ...rule };
  const flags = next as unknown as Record<string, boolean | undefined>;
  CONDITION_ENABLE_KEYS.forEach((k) => (flags[k] = false));
  return { ...next, ...patch, sell_mode: 'group' };
}
