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
  /** 예수금 행 (그 달 초 잔액) */
  cash?: boolean;
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
  /** 예수금 구성: USD = 원화·외화(달러) 따로, AFX = 따로 + 달러 모자라면 원화에서 자동 환전, KRW = 원화 하나 (미국 주식도 원화로 바로) */
  foreign_settle?: ForeignSettle;
  /** 자동 환전 수수료 (%) — KRW·AFX 일 때 환율에 얹는다 */
  fx_fee_pct?: number;
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
  /** 주식 모으기가 자동으로 남긴 회차 */
  plan_id?: number;
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
  // 기술 지표 (RSI · MFI) — 구 백엔드에서는 없을 수 있음
  rsi_period?: number; // 정수 2~50, 기본 14
  mfi_period?: number; // 정수 2~50, 기본 14
  osc_lookback_days?: number; // 정수 1~60, 기본 10 (과매도 반등 확인 기간)
  rsi_buy_enabled?: boolean; // 기본 false
  rsi_buy_level?: number; // 1~99, 기본 30
  rsi_sell_enabled?: boolean; // 기본 false
  rsi_sell_level?: number; // 1~99, 기본 70 (둘 다 켜면 매수 기준보다 커야 함)
  mfi_buy_enabled?: boolean; // 기본 false
  mfi_buy_level?: number; // 기본 20
  mfi_sell_enabled?: boolean; // 기본 false
  mfi_sell_level?: number; // 기본 80
  // 펀더멘털 (PER · PBR)
  per_buy_enabled?: boolean; // 기본 false
  per_buy_max?: number; // > 0, 기본 10
  per_sell_enabled?: boolean; // 기본 false
  per_sell_min?: number; // > 0, 기본 40
  pbr_buy_enabled?: boolean; // 기본 false
  pbr_buy_max?: number; // > 0, 기본 1
  pbr_sell_enabled?: boolean; // 기본 false
  pbr_sell_min?: number; // > 0, 기본 5
  // PER · PBR 을 종목 자신의 과거 평균과 비교 (구 백엔드에서는 없을 수 있음)
  valuation_window_months?: number; // 정수 12~60, 기본 36
  per_avg_buy_enabled?: boolean; // 기본 false
  per_avg_buy_pct?: number; // (0, 90], 기본 20
  per_avg_sell_enabled?: boolean; // 기본 false
  per_avg_sell_pct?: number; // (0, 500], 기본 30
  pbr_avg_buy_enabled?: boolean; // 기본 false
  pbr_avg_buy_pct?: number; // (0, 90], 기본 20
  pbr_avg_sell_enabled?: boolean; // 기본 false
  pbr_avg_sell_pct?: number; // (0, 500], 기본 30
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
  // 기술 지표 · 펀더멘털 (없으면 계산 불가)
  rsi?: number;
  rsi_min?: number; // 확인 기간 중 최저 RSI
  mfi?: number;
  mfi_min?: number;
  per?: number;
  forward_per?: number;
  pbr?: number;
  eps?: number;
  bps?: number;
  fundamentals_source?: 'yahoo' | 'naver';
  fundamentals_as_of?: string; // YYYY-MM-DD
  // 종목 자신의 과거 평균 대비 (없으면 계산 불가)
  per_avg?: number;
  per_vs_avg_pct?: number; // 현재 PER 의 평균 대비 %
  per_points?: number; // 평균에 쓴 월 수
  pbr_avg?: number;
  pbr_vs_avg_pct?: number;
  pbr_points?: number;
  valuation_source?: 'computed' | 'snapshots';
  valuation_window_months?: number;
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
  /** 예수금 (total·liquid·restricted 에 이미 포함) */
  cash_krw?: number;
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

// ── 주식 모으기 (정기 소액 매수) ──
export type PlanSchedule = 'daily' | 'weekly' | 'monthly';
export type PlanCondition = 'always' | 'return_below' | 'price_below';
export type PlanStatus = 'active' | 'paused';
export type PlanCurrency = 'KRW' | 'USD';

export interface AccumulationPlanRequest {
  account_id: number;
  asset_id: number;
  amount: number;
  amount_currency: PlanCurrency;
  /** 수량 단위 (카카오페이 0.001주, 금액에 맞춰 사는 곳 0.000001주) */
  qty_step: number;
  schedule: PlanSchedule;
  /** 매주: bit0=일 … bit6=토 */
  weekdays: number;
  month_day: number;
  condition: PlanCondition;
  condition_value: number;
  status: PlanStatus;
  started_on: string;
  /** 이 거래일부터 자동 기록 (YYYY-MM-DD) */
  auto_from: string;
  opening_rounds: number;
  opening_amount: number;
  opening_quantity: number;
  /** 등록할 때만: 지금까지 모은 수량을 보유에 더한다 */
  add_opening_to_holdings?: boolean;
  notes: string;
}

export interface AccumulationPlanView extends Omit<AccumulationPlanRequest, 'add_opening_to_holdings'> {
  id: number;
  processed_through: string;
  opening_tx_id?: number;
  created_at: string;
  updated_at: string;
  account?: Account;
  asset?: Asset;
  asset_currency: PlanCurrency;
  rounds: number;
  auto_rounds: number;
  invested: number;
  quantity: number;
  current_price: number;
  price_date?: string;
  value?: number;
  pnl?: number;
  pnl_pct?: number;
  holding_quantity: number;
  holding_avg_price: number;
  holding_return_pct?: number;
  condition_met?: boolean;
  last_fill_date?: string;
  next_date?: string;
  monthly_max: number;
  /** 지금 가격에서 수량 단위 하나를 사는 데 드는 금액 (금액 통화) */
  min_amount?: number;
}

export interface AccumulationFill {
  transaction_id: number;
  round: number;
  date: string;
  price: number;
  quantity: number;
  amount: number;
  fx?: number;
  edited: boolean;
}

export interface AccumulationRunResult {
  created: number;
  skipped: number;
  plans: number;
  errors?: string[];
}

// ── 예수금 ──
export type ForeignSettle = 'USD' | 'KRW' | 'AFX';
export type CashKind = 'deposit' | 'withdraw' | 'exchange' | 'interest' | 'adjust';
export type CashFlowKind = CashKind | 'buy' | 'sell' | 'dividend' | 'autofx';

export interface CashFlow {
  date: string;
  kind: CashFlowKind;
  currency: 'KRW' | 'USD';
  amount: number;
  balance: number;
  label: string;
  detail?: string;
  fx?: number;
  entry_id?: number;
  transaction_id?: number;
  plan_fill?: boolean;
  notes?: string;
}

export interface CashBalance {
  account_id: number;
  krw: number;
  usd: number;
  total_krw: number;
  last_adjusted?: string;
  /** 예수금 − 결제 전 매도 대금 (0 아래로 내려가지 않음) */
  withdrawable_krw: number;
  withdrawable_usd: number;
  /** 현금 흐름 건수 (0 이면 기록 없음) */
  flow_count: number;
}

export interface PendingSettle {
  /** 매도일 */
  date: string;
  /** 결제 예정일 — 이 날부터 출금 가능 */
  settle_date: string;
  currency: 'KRW' | 'USD';
  amount: number;
  label: string;
  transaction_id?: number;
}

export interface CashSummary extends CashBalance {
  account: Account;
  usd_krw: number;
  stock_value_krw?: number;
  account_total_krw?: number;
  pending?: PendingSettle[];
  flows: CashFlow[];
}

export interface CashEntryRequest {
  currency: 'KRW' | 'USD';
  date: string;
  kind: 'deposit' | 'withdraw' | 'interest';
  amount: number;
  notes: string;
}

export interface CashExchangeRequest {
  date: string;
  from_currency: 'KRW' | 'USD';
  from_amount: number;
  to_amount: number;
  notes: string;
}

export interface CashReconcileRequest {
  currency: 'KRW' | 'USD';
  balance: number;
  date: string;
}

// ── 배당 점수 · 월별 순위 ──
export type DivStatus = 'up' | 'flat' | 'down' | 'missed' | 'new';

export interface DivScoreParts {
  growth: number;
  stability: number;
  yield: number;
  consistency: number;
  price_growth: number;
  value: number;
}

export interface DivScoreMetrics {
  source: 'market' | 'records';
  ttm: number;
  growth_1y?: number;
  cagr_3y?: number;
  no_cut_years: number;
  increase_years: number;
  cuts_3y: number;
  missed_3y: number;
  missed_now: boolean;
  cv?: number;
  cycle?: string;
  payments_12m: number;
  specials_12m: number;
  last_payment?: string;
  next_expected?: string;
  price?: number;
  yield_pct?: number;
  avg_yield_pct?: number;
  pos_52?: number;
  ma_gap_pct?: number;
  /** 최근 1년 주가 변화 (%) */
  price_chg_1y?: number;
  /** 최근 1년 주가 하락 ÷ 최근 12개월 주당 배당 (1 = 받은 배당을 다 깎아 먹음) */
  div_eaten?: number;
  /** 하락 추세 (200일선 −5% 아래, 또는 200일선 아래 + 1년 −5% 넘게) */
  downtrend?: boolean;
  /** 최근 3년(없으면 1년 이상 있는 만큼) 연평균 주가 상승률 (%) */
  price_cagr_3y?: number;
  /** 그 계산에 쓴 기간 (년) */
  price_years?: number;
  /** 월말 종가가 1년 전 같은 달보다 높았던 비율 (0~1) */
  up_months?: number;
  up_months_n?: number;
  /** 최대 낙폭 (%, 0 이하) */
  max_drawdown?: number;
  history_years: number;
  status: DivStatus;
}

export interface DivScoreRow {
  asset_id: number;
  asset: Asset;
  score: number;
  rank: number;
  prev_rank?: number;
  prev_score?: number;
  prev_status?: DivStatus;
  parts: DivScoreParts;
  metrics: DivScoreMetrics;
  estimated: boolean;
  /** 항목별 순위 (그 항목 점수 순, 같으면 총점 순) */
  part_rank: Record<keyof DivScoreParts, number>;
  /** 지난달 항목별 순위 (지난달 순위가 있을 때만) */
  prev_part_rank?: Record<keyof DivScoreParts, number>;
  yoc_pct?: number;
  missing_count: number;
}

export interface DivScoreWeights {
  growth: number;
  stability: number;
  yield: number;
  consistency: number;
  price_growth: number;
  value: number;
  updated_at?: string;
}

export interface MissingDividend {
  asset_id: number;
  ticker: string;
  asset_name: string;
  account_id: number;
  account_name: string;
  account_broker: string;
  ex_date: string;
  per_share: number;
  quantity: number;
  currency: 'KRW' | 'USD';
  expected_net: number;
  pay_by: string;
  status: 'missing' | 'upcoming';
}

export interface DivScoreRanking {
  month: string;
  months: string[];
  current: boolean;
  weights: DivScoreWeights;
  rows: DivScoreRow[];
  no_dividend: Asset[];
  missing: MissingDividend[];
  /** 지난달 종목 전체의 순위·점수 (한국/미국만·항목별로 지난달 순위를 다시 매길 때) */
  prev?: { asset_id: number; ticker: string; rank: number; score: number; parts: DivScoreParts }[];
}

export interface DivScoreDetail {
  asset_id: number;
  asset: Asset;
  source: string;
  currency: string;
  history: { month: string; score: number; rank: number; of: number; status: DivStatus; estimated: boolean }[];
  years: { year: number; regular: number; special: number; count: number; partial: boolean }[];
  payments: { date: string; amount: number; special: boolean }[];
  /** 지금 보유 (없으면 보유하지 않는 종목) */
  position?: DivScorePosition;
}

/** 이 종목의 지금 보유 — 금액은 종목 통화, 받은 배당은 기록 통화별 (세후) */
export interface DivScorePosition {
  quantity: number;
  avg_price: number;
  cost: number;
  /** 지금 보유를 시작한 날 (계좌 중 가장 이른) */
  since?: string;
  received: { currency: string; total: number; last_12m: number; count: number }[];
  accounts: { account_id: number; name: string; broker: string; account_type: AccountType; quantity: number; avg_price: number; since?: string }[];
}
