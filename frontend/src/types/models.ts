export type MarketType = 'Domestic' | 'International';

// 계좌 유형: 연금저축/IRP/DC 는 중도 인출이 제한되는 계좌로 분류된다 (utils/accountType.ts 참고)
export type AccountType = 'General' | 'ISA' | 'Pension' | 'IRP' | 'DC';

export interface PricePoint {
  time: number; // unix seconds
  close: number;
}

export interface MonthlySnapshotSummary {
  year: number;
  month: number;
  account_id: number;
  currency: string;
  total_value: number;
  asset_count: number;
  estimated?: boolean;
}

export interface PriceHistory {
  symbol: string;
  currency: string;
  range: string;
  interval: string;
  gmtoffset?: number;
  points: PricePoint[];
}

export interface TickerInfo {
  symbol: string;
  name: string;
  type: string;
  sector: string;
  currency: string;
  exchange: string;
  price: number;
  market_cap: number;
  description: string;
}

export interface Account {
  id: number;
  name: string;
  broker: string;
  account_number: string;
  market_type: MarketType;
  account_type?: AccountType;
  currency: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: number;
  ticker: string;
  name: string;
  type: 'Stock' | 'ETF';
  sector: string;
  created_at: string;
  updated_at: string;
  holdings?: Holding[];
}

export interface Holding {
  id: number;
  account_id: number;
  asset_id: number;
  quantity: number;
  average_price: number;
  created_at: string;
  updated_at: string;
  account?: Account;
  asset?: Asset;
}

export interface HoldingWithDetails extends Holding {
  account_name: string;
  ticker: string;
  asset_name: string;
  asset_type: string;
  sector: string;
  total_cost: number;
}

export interface Transaction {
  id: number;
  account_id: number;
  asset_id: number;
  type: 'Buy' | 'Sell';
  date: string;
  price: number;
  quantity: number;
  fee: number;
  notes: string;
  created_at: string;
  updated_at: string;
  account?: Account;
  asset?: Asset;
}

export interface Dividend {
  id: number;
  account_id: number;
  asset_id: number;
  date: string;
  amount: number;
  currency: string;
  tax: number;
  is_received: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
  account?: Account;
  asset?: Asset;
}

export interface MonthlyDividend {
  year: number;
  month: number;
  total: number;
  count: number;
  label: string;
}

export interface DividendStats {
  total_dividends: number;
  total_tax: number;
  net_dividends: number;
  received_count: number;
  pending_count: number;
  average_dividend: number;
}

export interface RealizedPnL {
  id: number;
  transaction_id: number;
  account_id: number;
  asset_id: number;
  date: string;
  quantity: number;
  buy_avg_price: number;
  sell_price: number;
  fee: number;
  profit: number;
  profit_percent: number;
  currency: string;
  notes: string;
  created_at: string;
  account?: Account;
  asset?: Asset;
}

// ==========================================
// 매매 신호
// ==========================================
// any: 1개 이상, all: 모두, count: sell_min_count / buy_min_count 개 이상
// group: (매도 전용) 수익 실현 / 위험 관리 묶음별로 sell_profit_min_count / sell_risk_min_count 를 판정
export type SignalMode = 'any' | 'all' | 'count' | 'group';
export type BelowMaMode = 'below' | 'rebound' | 'reclaim';
export type FromHighMode = 'below' | 'rebound';
export type BuyQtyMode = 'amount' | 'target_weight' | 'lower_avg';
export type SignalAction = 'SELL' | 'BUY' | 'HOLD' | 'CONFLICT' | 'NO_PRICE';

export interface SignalRule {
  id?: number;
  asset_id: number; // 0 = 기본 전략
  take_profit_enabled: boolean;
  take_profit_pct: number;
  stop_loss_enabled: boolean;
  stop_loss_pct: number; // <= 0
  weight_enabled: boolean;
  target_weight_pct: number;
  weight_band_pct: number;
  dividend_payback_enabled: boolean;
  dividend_payback_pct: number;
  dividend_payback_min_return_pct: number;
  low_yield_enabled: boolean;
  low_yield_pct: number;
  buy_dip_enabled: boolean;
  buy_dip_pct: number; // <= 0
  high_yield_enabled: boolean;
  high_yield_pct: number;
  // 2단계 (구 백엔드에서는 없을 수 있음)
  from_high_enabled?: boolean;
  from_high_pct?: number; // <= 0
  below_ma_enabled?: boolean;
  below_ma_pct?: number; // <= 0 (200일 이평 대비)
  above_ma_enabled?: boolean;
  above_ma_pct?: number; // >= 0
  dividend_cut_enabled?: boolean;
  dividend_cut_pct?: number; // >= 0
  tax_harvest_enabled?: boolean;
  tax_harvest_from_month?: number; // 1~12
  fx_historical?: boolean;
  crash_enabled?: boolean;
  crash_pct?: number; // <= 0 (큰 폭락 경고)
  min_sell_qty_enabled?: boolean; // 보유 수량이 기준 이하이면 매도 검토 제외
  min_sell_qty?: number; // >= 0 (주)
  // 배당수익률 압축 · 변동성 대비 과열/과매도 (구 백엔드에서는 없을 수 있음)
  yield_compression_enabled?: boolean;
  yield_compression_pct?: number; // > 0 (24개월 평균 대비 낮아진 비율)
  vol_overheat_enabled?: boolean;
  vol_overheat_sigma?: number; // > 0 (+σ 이상이면 과열)
  vol_oversold_enabled?: boolean;
  vol_oversold_sigma?: number; // > 0 (양수로 입력, −σ 이하로 적용)
  // 수익 실현 (구 백엔드에서는 없을 수 있음)
  trailing_enabled?: boolean;
  trailing_activate_pct?: number; // >= 0 (추적 익절 활성 수익률)
  trailing_drop_pct?: number; // < 0 (최고가 대비 되돌림)
  annualized_enabled?: boolean;
  annualized_pct?: number; // >= 0
  annualized_min_days?: number; // 1~3650
  annualized_min_return_pct?: number; // >= 0
  drift_enabled?: boolean;
  drift_pct?: number; // > 0 (원금 비중 대비 %p)
  partial_enabled?: boolean;
  partial_pct?: number; // 1~100 (보유 수량의 %)
  // 매수 규칙 · 변동성 손절 (구 백엔드에서는 없을 수 있음)
  last_buy_dip_enabled?: boolean; // 기본 false
  last_buy_dip_pct?: number; // < 0 (마지막 매수가 대비)
  buy_cooldown_enabled?: boolean; // 기본 true
  buy_cooldown_days?: number; // 정수 1~365
  buy_max_weight_enabled?: boolean; // 기본 true
  buy_max_weight_pct?: number; // (0,100]
  buy_qty_enabled?: boolean; // 기본 true
  buy_qty_mode?: BuyQtyMode;
  buy_qty_amount_krw?: number; // > 0
  buy_qty_lower_avg_pct?: number; // (0,50]
  vol_stop_enabled?: boolean; // 기본 false
  vol_stop_k?: number; // (0,5]
  // 반등 확인 (매수 확인 조건, 개수에 포함되지 않음)
  rebound_confirm_enabled?: boolean; // 기본 false
  rebound_from_low_pct?: number; // (0,100], 기본 5
  rebound_lookback_days?: number; // 정수 5~120 (거래일), 기본 20
  rebound_ma_enabled?: boolean; // 20일 이평선 위면 인정, 기본 true
  // 배당수익률 확대 (매수 신호)
  yield_expansion_enabled?: boolean; // 기본 false
  yield_expansion_pct?: number; // > 0, 기본 20
  // 시간 손절 (위험 관리)
  time_stop_enabled?: boolean; // 기본 false
  time_stop_days?: number; // 정수 30~3650, 기본 365
  time_stop_max_return_pct?: number; // 유한한 수, 기본 0
  // 단기 급락 (위험 관리)
  short_drop_enabled?: boolean; // 기본 false
  short_drop_days?: number; // 정수 5~120 (거래일), 기본 20
  short_drop_pct?: number; // < 0, 기본 -15
  // 장기 이평 하회 / 52주 고점 대비 하락의 반등 방식 (구 백엔드에서는 없을 수 있음)
  below_ma_mode?: BelowMaMode; // 기본 'rebound'
  below_ma_lookback_days?: number; // 정수 10~250 (거래일), 기본 60
  below_ma_max_above_pct?: number; // 0~50, 기본 3
  below_ma_reclaim_days?: number; // 정수 1~60, 기본 10
  from_high_mode?: FromHighMode; // 기본 'rebound'
  from_high_lookback_days?: number; // 정수 10~250, 기본 60
  from_high_rebound_pct?: number; // (0,100], 기본 5
  from_high_still_below_pct?: number; // <= 0, 기본 -10
  sell_mode: SignalMode;
  buy_mode: SignalMode;
  sell_min_count?: number;
  buy_min_count?: number;
  sell_profit_min_count?: number; // sell_mode === 'group' 일 때 수익 실현 묶음 기준 개수
  sell_risk_min_count?: number; // sell_mode === 'group' 일 때 위험 관리 묶음 기준 개수
  created_at?: string;
  updated_at?: string;
}

export type ProfileKind = 'standard' | 'dividend';

export interface SignalProfile {
  id: number;
  key: string;
  name: string;
  description: string;
  kind: ProfileKind;
  built_in: boolean;
  sort_order: number;
  asset_count: number;
  rule: SignalRule;
  created_at?: string;
  updated_at?: string;
}

export interface ProfileAssignment {
  asset_id: number;
  profile_id: number;
}

export interface SignalProfilesResponse {
  profiles: SignalProfile[];
  assignments: ProfileAssignment[];
}

export interface CreateProfileRequest {
  name: string;
  description?: string;
  kind: ProfileKind;
  copy_from_profile_id?: number;
}

export interface UpdateProfileRequest {
  name?: string;
  description?: string;
  kind?: ProfileKind;
  rule?: SignalRule;
}

export interface CandidateReason {
  code: string;
  label: string;
  met: boolean;
  detail: string;
}

export interface ProfileCandidate {
  asset_id: number;
  ticker: string;
  name: string;
  score: number;
  max_score: number;
  is_candidate: boolean;
  reasons: CandidateReason[];
  profile_id: number;
  profile_name: string;
  has_override: boolean;
}

export interface SignalRulesResponse {
  default: SignalRule;
  overrides: SignalRule[];
}

export interface SignalCheck {
  code: string;
  label: string;
  met: boolean;
  value: number;
  threshold: number;
  unit: string;
}

export interface SignalAccount {
  account_id: number;
  account_name: string;
  broker: string;
  account_type: AccountType;
  restricted: boolean;
  quantity: number;
  avg_price: number;
  market_value_krw: number;
}

export interface SignalItem {
  asset_id: number;
  ticker: string;
  name: string;
  currency: string;
  action: SignalAction;
  rule_source: 'default' | 'asset' | 'profile';
  profile_id?: number;
  profile_key?: string;
  profile_name?: string;
  profile_kind?: ProfileKind;
  sell_disabled?: boolean;
  sell_excluded_small_qty?: boolean; // 보유 수량이 기준 이하라 매도 검토에서 제외됨
  min_sell_qty?: number;
  // 변동성 · 배당수익률 압축
  volatility_pct?: number; // 연환산 변동성 %
  ma200_sigma?: number; // 200일선 괴리 (연 변동성 단위)
  dividend_yield_avg_pct?: number; // 최근 24개월 평균 배당수익률 %
  dividend_yield_vs_avg_pct?: number; // 현재 배당수익률의 평균 대비 %
  dividend_yield_points?: number; // 계산에 쓴 개월 수
  dividend_yield_source?: 'market' | 'records';
  // 수익 흐름 (매수 이후 최고가 · 보유 기간 · 연환산 · 원금 비중)
  peak_price?: number;
  peak_date?: string; // YYYY-MM-DD
  peak_gain_pct?: number;
  from_peak_pct?: number;
  holding_days?: number;
  annualized_return_pct?: number;
  cost_weight_pct?: number;
  // 매도 수량 제안 (수익 실현 신호일 때만)
  suggested_sell_qty?: number;
  suggested_sell_krw?: number;
  suggested_sell_kind?: 'partial' | 'rebalance';
  // 마지막 매수 · 매수 제외 · 매수 수량 제안
  last_buy_date?: string; // YYYY-MM-DD
  last_buy_price?: number;
  from_last_buy_pct?: number;
  days_since_last_buy?: number;
  buy_excluded_reason?: 'cooldown' | 'max_weight' | 'no_rebound';
  // 반등 확인 · 단기 흐름
  recent_low_price?: number;
  from_recent_low_pct?: number;
  ma20?: number;
  rebound_confirmed?: boolean;
  rebound_lookback_days?: number;
  short_change_pct?: number;
  short_change_days?: number;
  buy_max_weight_pct?: number;
  buy_cooldown_days?: number;
  suggested_buy_qty?: number;
  suggested_buy_krw?: number;
  suggested_buy_kind?: BuyQtyMode;
  restricted_only: boolean;
  quantity: number;
  avg_price: number;
  current_price: number;
  market_value_krw: number;
  cost_krw: number;
  total_return_krw: number;
  dividends_krw: number;
  dividends_12m_krw: number;
  unrealized_pct: number;
  total_return_pct: number;
  dividend_payback_pct: number;
  current_yield_pct: number;
  yield_on_cost_pct: number;
  weight_pct: number;
  from_avg_pct: number;
  // 추세 (현지 통화, 0 = 없음)
  high_52w?: number;
  low_52w?: number;
  ma200?: number;
  from_high_pct?: number;
  from_low_pct?: number;
  vs_ma200_pct?: number;
  // 반등 방식 매수 신호 보조 지표
  ma200_min_dev_pct?: number;
  ma20_rising?: boolean;
  ma200_reclaim_days_ago?: number;
  from_high_deepest_pct?: number;
  from_low_rebound_pct?: number;
  price_history_ok?: boolean;
  // 배당 추세
  dps_12m?: number;
  dps_prev_12m?: number;
  dividend_change_pct?: number;
  dividend_trend_ok?: boolean;
  // 환율 반영 수익률
  cost_krw_fx?: number;
  total_return_pct_fx?: number;
  fx_effect_krw?: number;
  fx_coverage_pct?: number;
  return_basis?: 'fx' | 'current';
  tax_hint?: SignalTaxHint | null;
  sell_checks: SignalCheck[];
  buy_checks: SignalCheck[];
  accounts: SignalAccount[];
}

export interface SignalTaxHint {
  kind: 'harvest_gain' | 'harvest_loss';
  amount_krw: number;
  message: string;
}

export interface SignalTaxSummary {
  year: number;
  realized_gain_krw: number;
  realized_loss_krw: number;
  net_krw: number;
  exemption_krw: number;
  remaining_krw: number;
  estimated_tax_krw: number;
  harvest_window: boolean;
  count: number;
}

export interface SignalReport {
  generated_at: string;
  usd_krw: number;
  summary: { sell: number; buy: number; hold: number; conflict: number; no_price: number };
  items: SignalItem[];
  tax?: SignalTaxSummary | null;
}

// ==========================================
// Signal alerts
// ==========================================
export interface SignalEvent {
  id: number;
  asset_id: number;
  ticker: string;
  name: string;
  from_action: SignalAction | '';
  to_action: SignalAction | 'SUGGEST';
  kind?: 'signal' | 'suggestion';
  suggested_profile_id?: number;
  met_codes: string; // 쉼표로 구분
  message: string;
  total_return_pct: number;
  current_price: number;
  currency: string;
  created_at: string;
  read_at: string | null;
}

export interface SignalEventsResponse {
  events: SignalEvent[];
  unread_count: number;
}

export type NotifyIntervalMinutes = 15 | 30 | 60 | 180 | 360;

export interface NotificationSetting {
  enabled: boolean;
  interval_minutes: NotifyIntervalMinutes;
  os_notify: boolean;
  notify_sell: boolean;
  notify_buy: boolean;
  notify_conflict: boolean;
  updated_at?: string;
}

// 일별 총자산 추이
export interface DailyAssetPoint {
  date: string; // YYYY-MM-DD
  total_krw: number;
  cost_krw: number;
  liquid_krw: number;
  restricted_krw: number;
  dividends_cum_krw: number;
  usd_krw: number;
  estimated: boolean;
}

export interface DailyAssetSeries {
  range: string;
  interval: string;
  points: DailyAssetPoint[];
  first_date: string;
  last_real_date: string;
  real_count: number;
  estimated_count: number;
}

export interface DailyCaptureResult {
  snapshot: Record<string, any>;
  backfill_started: boolean;
}
