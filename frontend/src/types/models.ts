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
export type SignalMode = 'any' | 'all';
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
  sell_mode: SignalMode;
  buy_mode: SignalMode;
  created_at?: string;
  updated_at?: string;
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
  rule_source: 'default' | 'asset';
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
  sell_checks: SignalCheck[];
  buy_checks: SignalCheck[];
  accounts: SignalAccount[];
}

export interface SignalReport {
  generated_at: string;
  usd_krw: number;
  summary: { sell: number; buy: number; hold: number; conflict: number; no_price: number };
  items: SignalItem[];
}
