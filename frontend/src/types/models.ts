export type MarketType = 'Domestic' | 'International';

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
