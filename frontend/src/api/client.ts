import * as WailsApp from '../../wailsjs/go/main/App';
import { Account, Asset, Holding, Transaction, Dividend, SignalRule, SignalRulesResponse, SignalReport, SignalEvent, SignalEventsResponse, NotificationSetting, SignalProfile, SignalProfilesResponse, CreateProfileRequest, UpdateProfileRequest, ProfileAssignment, ProfileCandidate } from '../types/models';

// Wails 환경(데스크톱 앱)인지 웹 브라우저(모바일 등)인지 판별
// Wails 환경에서는 window.go 객체가 존재합니다.
const isWeb = !(window as any).go;

// API 서버 주소: 환경변수 VITE_API_URL이 설정되면 사용, 아니면 로컬 기본값
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined)?.trim();

/**
 * HTTP 요청 헬퍼 함수
 */
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(options?.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // 클라우드 API 인증 키가 설정된 경우 자동으로 Bearer 헤더를 첨부합니다.
  if (API_KEY && !headers.has('Authorization') && !headers.has('X-API-Key')) {
    headers.set('Authorization', `Bearer ${API_KEY}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * 프론트엔드 API 클라이언트
 */
export const apiClient = {
  // ==========================================
  // Accounts
  // ==========================================
  GetAllAccounts: async () => {
    if (isWeb) return fetchApi<Account[]>('/accounts');
    return WailsApp.GetAllAccounts();
  },

  GetAccount: async (id: number) => {
    if (isWeb) return fetchApi<Account>(`/accounts/${id}`);
    return WailsApp.GetAccount(id);
  },

  CreateAccount: async (name: string, broker: string, accountNumber: string, marketType: string, currency: string, description: string, accountType: string) => {
    if (isWeb) {
      return fetchApi<Account>('/accounts', {
        method: 'POST',
        body: JSON.stringify({ name, broker, account_number: accountNumber, market_type: marketType, currency, description, account_type: accountType }),
      });
    }
    return WailsApp.CreateAccount(name, broker, accountNumber, marketType, currency, description, accountType);
  },

  UpdateAccount: async (id: number, name: string, broker: string, accountNumber: string, marketType: string, currency: string, description: string, accountType: string) => {
    if (isWeb) {
      return fetchApi<Account>(`/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, broker, account_number: accountNumber, market_type: marketType, currency, description, account_type: accountType }),
      });
    }
    return WailsApp.UpdateAccount(id, name, broker, accountNumber, marketType, currency, description, accountType);
  },

  DeleteAccount: async (id: number) => {
    if (isWeb) {
      await fetchApi(`/accounts/${id}`, { method: 'DELETE' });
      return;
    }
    return WailsApp.DeleteAccount(id);
  },

  // ==========================================
  // Assets
  // ==========================================
  GetAllAssets: async () => {
    if (isWeb) return fetchApi<Asset[]>('/assets');
    return WailsApp.GetAllAssets();
  },

  GetAssetByTicker: async (ticker: string) => {
    if (isWeb) return fetchApi<Asset>(`/assets/ticker/${ticker}`);
    return WailsApp.GetAssetByTicker(ticker);
  },

  CreateAsset: async (ticker: string, name: string, type: string, sector: string, accountID: number, quantity: number, averagePrice: number) => {
    if (isWeb) {
      return fetchApi<Asset>('/assets', {
        method: 'POST',
        body: JSON.stringify({ ticker, name, type, sector, account_id: accountID, quantity, average_price: averagePrice }),
      });
    }
    return WailsApp.CreateAsset(ticker, name, type, sector, accountID, quantity, averagePrice);
  },

  UpdateAsset: async (id: number, name: string, type: string, sector: string) => {
    if (isWeb) {
      return fetchApi<Asset>(`/assets/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, type, sector }),
      });
    }
    return WailsApp.UpdateAsset(id, name, type, sector);
  },

  DeleteAsset: async (id: number) => {
    if (isWeb) {
      await fetchApi(`/assets/${id}`, { method: 'DELETE' });
      return;
    }
    return WailsApp.DeleteAsset(id);
  },

  // ==========================================
  // Holdings
  // ==========================================
  GetAllHoldings: async () => {
    if (isWeb) return fetchApi<Holding[]>('/holdings');
    return WailsApp.GetAllHoldings();
  },

  GetHoldingsByAccount: async (accountID: number) => {
    if (isWeb) return fetchApi<Holding[]>(`/accounts/${accountID}/holdings`);
    return WailsApp.GetHoldingsByAccount(accountID);
  },

  CreateHolding: async (accountID: number, assetID: number, quantity: number, averagePrice: number) => {
    if (isWeb) {
      return fetchApi<Holding>('/holdings', {
        method: 'POST',
        body: JSON.stringify({ account_id: accountID, asset_id: assetID, quantity, average_price: averagePrice }),
      });
    }
    return WailsApp.CreateHolding(accountID, assetID, quantity, averagePrice);
  },

  UpdateHolding: async (id: number, quantity: number, averagePrice: number) => {
    if (isWeb) {
      return fetchApi<Holding>(`/holdings/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ quantity, average_price: averagePrice }),
      });
    }
    return WailsApp.UpdateHolding(id, quantity, averagePrice);
  },

  DeleteHolding: async (id: number) => {
    if (isWeb) {
      await fetchApi(`/holdings/${id}`, { method: 'DELETE' });
      return;
    }
    return WailsApp.DeleteHolding(id);
  },

  // ==========================================
  // Transactions
  // ==========================================
  GetTransactionsByAccount: async (accountID: number) => {
    if (isWeb) return fetchApi<Transaction[]>(`/accounts/${accountID}/transactions`);
    return WailsApp.GetTransactionsByAccount(accountID);
  },

  GetTransactionsByAsset: async (assetID: number) => {
    if (isWeb) return fetchApi<Transaction[]>(`/assets/${assetID}/transactions`);
    return WailsApp.GetTransactionsByAsset(assetID);
  },

  CreateTransaction: async (accountID: number, assetID: number, type: string, date: string, price: number, quantity: number, fee: number, notes: string) => {
    if (isWeb) {
      return fetchApi<Transaction>('/transactions', {
        method: 'POST',
        body: JSON.stringify({ account_id: accountID, asset_id: assetID, type, date, price, quantity, fee, notes }),
      });
    }
    return WailsApp.CreateTransaction(accountID, assetID, type, date, price, quantity, fee, notes);
  },

  UpdateTransaction: async (id: number, type: string, date: string, price: number, quantity: number, fee: number, notes: string) => {
    if (isWeb) {
      return fetchApi<Transaction>(`/transactions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ type, date, price, quantity, fee, notes }),
      });
    }
    return WailsApp.UpdateTransaction(id, type, date, price, quantity, fee, notes);
  },

  DeleteTransaction: async (id: number) => {
    if (isWeb) return fetchApi<void>(`/transactions/${id}`, { method: 'DELETE' });
    return WailsApp.DeleteTransaction(id);
  },

  // ==========================================
  // Dividends
  // ==========================================
  GetDividendsByAccount: async (accountID: number) => {
    if (isWeb) return fetchApi<Dividend[]>(`/accounts/${accountID}/dividends`);
    return WailsApp.GetDividendsByAccount(accountID);
  },

  GetAllDividends: async () => {
    if (isWeb) return fetchApi<Dividend[]>('/dividends/all');
    return WailsApp.GetAllDividends();
  },

  CreateDividend: async (accountID: number, assetID: number, date: string, amount: number, tax: number, currency: string, isReceived: boolean, notes: string) => {
    if (isWeb) {
      return fetchApi<Dividend>('/dividends', {
        method: 'POST',
        body: JSON.stringify({ account_id: accountID, asset_id: assetID, date, amount, tax, currency, is_received: isReceived, notes }),
      });
    }
    return WailsApp.CreateDividend(accountID, assetID, date, amount, tax, currency, isReceived, notes);
  },

  UpdateDividend: async (id: number, accountID: number, assetID: number, date: string, amount: number, tax: number, currency: string, isReceived: boolean, notes: string) => {
    if (isWeb) {
      return fetchApi<Dividend>(`/dividends/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ account_id: accountID, asset_id: assetID, date, amount, tax, currency, is_received: isReceived, notes }),
      });
    }
    return WailsApp.UpdateDividend(id, accountID, assetID, date, amount, tax, currency, isReceived, notes);
  },

  DeleteDividend: async (id: number) => {
    if (isWeb) {
      await fetchApi(`/dividends/${id}`, { method: 'DELETE' });
      return;
    }
    return WailsApp.DeleteDividend(id);
  },

  GetMonthlyDividends: async (startDate: string, endDate: string) => {
    if (isWeb) return fetchApi<any>(`/dividends/monthly?startDate=${startDate}&endDate=${endDate}`);
    return WailsApp.GetMonthlyDividends(startDate, endDate);
  },

  GetMonthlyDividendsByAccount: async (accountID: number, startDate: string, endDate: string) => {
    if (isWeb) return fetchApi<any>(`/dividends/monthly/account/${accountID}?startDate=${startDate}&endDate=${endDate}`);
    return WailsApp.GetMonthlyDividendsByAccount(accountID, startDate, endDate);
  },

  GetDividendStats: async () => {
    if (isWeb) return fetchApi<any>('/dividends/stats');
    return WailsApp.GetDividendStats();
  },

  // ==========================================
  // Utilities & Exchange
  // ==========================================
  GetTickerInfo: async (ticker: string) => {
    if (isWeb) return fetchApi<any>(`/ticker/info?ticker=${ticker}`);
    return WailsApp.GetTickerInfo(ticker);
  },

  SearchTicker: async (query: string) => {
    if (isWeb) return fetchApi<any>(`/ticker/search?query=${query}`);
    return WailsApp.SearchTicker(query);
  },

  GetCurrentPrice: async (ticker: string) => {
    if (isWeb) return fetchApi<number>(`/ticker/price?ticker=${ticker}`);
    return WailsApp.GetCurrentPrice(ticker);
  },

  GetPriceHistory: async (ticker: string, range = '6mo', interval = '1d') => {
    if (isWeb)
      return fetchApi<any>(`/ticker/history?ticker=${ticker}&range=${range}&interval=${interval}`);
    return WailsApp.GetPriceHistory(ticker, range, interval);
  },

  GetCurrentPrices: async (tickers: string[]) => {
    if (isWeb) return fetchApi<Record<string, any>>(`/ticker/prices?tickers=${tickers.join(',')}`);
    // Wails: 서버 측 일괄 조회(동시 5개 제한 + 5분 캐시) 사용
    return (await WailsApp.GetCurrentPrices(tickers)) as Record<string, any>;
  },

  GetUSDToKRW: async () => {
    if (isWeb) return fetchApi<number>('/exchange-rate/usd-krw');
    return WailsApp.GetUSDToKRW();
  },

  ConvertToKRW: async (amount: number, currency: string) => {
    if (isWeb) return fetchApi<number>(`/exchange-rate/convert?amount=${amount}&currency=${currency}`);
    return WailsApp.ConvertToKRW(amount, currency);
  },

  // ==========================================
  // Portfolio Snapshots
  // ==========================================
  EnsureSnapshot: async () => {
    if (isWeb) return fetchApi<any>('/snapshots/ensure', { method: 'POST' });
    return WailsApp.EnsureSnapshot();
  },

  GetSnapshotsByAccount: async (accountID: number) => {
    if (isWeb) return fetchApi<any[]>(`/snapshots/account/${accountID}`);
    return WailsApp.GetSnapshotsByAccount(accountID);
  },

  GetSnapshotsByAsset: async (assetID: number) => {
    if (isWeb) return fetchApi<any[]>(`/snapshots/asset/${assetID}`);
    return WailsApp.GetSnapshotsByAsset(assetID);
  },

  GetMonthlySnapshotByAccount: async (accountID: number) => {
    if (isWeb) return fetchApi<any[]>(`/snapshots/account/${accountID}/monthly`);
    return WailsApp.GetMonthlySnapshotByAccount(accountID);
  },

  GetMonthlySnapshotSummary: async (months: number = 36) => {
    if (isWeb) return fetchApi<any[]>(`/snapshots/monthly-summary?months=${months}`);
    return WailsApp.GetMonthlySnapshotSummary(months);
  },

  // ==========================================
  // Realized P&L
  // ==========================================
  GetAllRealizedPnL: async () => {
    if (isWeb) return fetchApi<any[]>('/realized-pnl');
    return WailsApp.GetAllRealizedPnL();
  },

  GetRealizedPnLByAccount: async (accountID: number) => {
    if (isWeb) return fetchApi<any[]>(`/realized-pnl/account/${accountID}`);
    return WailsApp.GetRealizedPnLByAccount(accountID);
  },

  GetRealizedPnLByAsset: async (assetID: number) => {
    if (isWeb) return fetchApi<any[]>(`/realized-pnl/asset/${assetID}`);
    return WailsApp.GetRealizedPnLByAsset(assetID);
  },

  GetRealizedPnLSummary: async () => {
    if (isWeb) return fetchApi<any>('/realized-pnl/summary');
    return WailsApp.GetRealizedPnLSummary();
  },

  // ==========================================
  // Trade Signals
  // ==========================================
  GetSignals: async (): Promise<SignalReport> => {
    if (isWeb) return fetchApi<SignalReport>('/signals');
    return (await WailsApp.GetSignals()) as SignalReport;
  },

  GetSignalRules: async (): Promise<SignalRulesResponse> => {
    if (isWeb) return fetchApi<SignalRulesResponse>('/signal-rules');
    return (await WailsApp.GetSignalRules()) as SignalRulesResponse;
  },

  SaveDefaultSignalRule: async (rule: SignalRule): Promise<SignalRule> => {
    if (isWeb) {
      return fetchApi<SignalRule>('/signal-rules/default', { method: 'PUT', body: JSON.stringify(rule) });
    }
    // Wails 생성 타입은 convertValues 를 가진 클래스지만 실제 전달은 JSON 이므로 형태만 맞춘다
    return (await WailsApp.SaveDefaultSignalRule(rule as unknown as Parameters<typeof WailsApp.SaveDefaultSignalRule>[0])) as SignalRule;
  },

  SaveAssetSignalRule: async (assetId: number, rule: SignalRule): Promise<SignalRule> => {
    if (isWeb) {
      return fetchApi<SignalRule>(`/signal-rules/asset/${assetId}`, { method: 'PUT', body: JSON.stringify(rule) });
    }
    return (await WailsApp.SaveAssetSignalRule(assetId, rule as unknown as Parameters<typeof WailsApp.SaveAssetSignalRule>[1])) as SignalRule;
  },

  DeleteAssetSignalRule: async (assetId: number) => {
    if (isWeb) {
      await fetchApi(`/signal-rules/asset/${assetId}`, { method: 'DELETE' });
      return;
    }
    return WailsApp.DeleteAssetSignalRule(assetId);
  },

  // ==========================================
  // Signal Alerts
  // ==========================================
  GetSignalEvents: async (limit: number, unreadOnly: boolean): Promise<SignalEventsResponse> => {
    if (isWeb) return fetchApi<SignalEventsResponse>(`/signal-events?limit=${limit}&unread_only=${unreadOnly}`);
    return (await WailsApp.GetSignalEvents(limit, unreadOnly)) as SignalEventsResponse;
  },

  MarkSignalEventsRead: async (ids: number[], all: boolean): Promise<{ unread_count: number }> => {
    if (isWeb) {
      return fetchApi<{ unread_count: number }>('/signal-events/read', {
        method: 'POST',
        body: JSON.stringify(all ? { all: true } : { ids }),
      });
    }
    return (await WailsApp.MarkSignalEventsRead(ids, all)) as { unread_count: number };
  },

  GetUnreadSignalCount: async (): Promise<{ unread_count: number }> => {
    if (isWeb) return fetchApi<{ unread_count: number }>('/signal-events/unread-count');
    return (await WailsApp.GetUnreadSignalCount()) as { unread_count: number };
  },

  CheckSignals: async (): Promise<{ new_events: SignalEvent[]; unread_count: number }> => {
    if (isWeb) return fetchApi<{ new_events: SignalEvent[]; unread_count: number }>('/signals/check', { method: 'POST' });
    return (await WailsApp.CheckSignals()) as { new_events: SignalEvent[]; unread_count: number };
  },

  GetNotificationSettings: async (): Promise<NotificationSetting> => {
    if (isWeb) return fetchApi<NotificationSetting>('/notification-settings');
    return (await WailsApp.GetNotificationSettings()) as NotificationSetting;
  },

  SaveNotificationSettings: async (s: NotificationSetting): Promise<NotificationSetting> => {
    if (isWeb) return fetchApi<NotificationSetting>('/notification-settings', { method: 'PUT', body: JSON.stringify(s) });
    return (await WailsApp.SaveNotificationSettings(s as unknown as Parameters<typeof WailsApp.SaveNotificationSettings>[0])) as NotificationSetting;
  },

  // ------------------------------------------
  // Signal Profiles
  // ------------------------------------------
  GetSignalProfiles: async (): Promise<SignalProfilesResponse> => {
    if (isWeb) return fetchApi<SignalProfilesResponse>('/signal-profiles');
    return (await WailsApp.GetSignalProfiles()) as SignalProfilesResponse;
  },

  CreateSignalProfile: async (req: CreateProfileRequest): Promise<SignalProfile> => {
    if (isWeb) return fetchApi<SignalProfile>('/signal-profiles', { method: 'POST', body: JSON.stringify(req) });
    return (await WailsApp.CreateSignalProfile(req as unknown as Parameters<typeof WailsApp.CreateSignalProfile>[0])) as SignalProfile;
  },

  UpdateSignalProfile: async (id: number, req: UpdateProfileRequest): Promise<SignalProfile> => {
    if (isWeb) return fetchApi<SignalProfile>(`/signal-profiles/${id}`, { method: 'PUT', body: JSON.stringify(req) });
    return (await WailsApp.UpdateSignalProfile(id, req as unknown as Parameters<typeof WailsApp.UpdateSignalProfile>[1])) as SignalProfile;
  },

  DeleteSignalProfile: async (id: number): Promise<void> => {
    if (isWeb) {
      await fetchApi(`/signal-profiles/${id}`, { method: 'DELETE' });
      return;
    }
    return WailsApp.DeleteSignalProfile(id);
  },

  ResetSignalProfile: async (id: number): Promise<SignalProfile> => {
    if (isWeb) return fetchApi<SignalProfile>(`/signal-profiles/${id}/reset`, { method: 'POST' });
    return (await WailsApp.ResetSignalProfile(id)) as SignalProfile;
  },

  AssignSignalProfile: async (id: number, assetIds: number[]): Promise<{ assignments: ProfileAssignment[] }> => {
    if (isWeb) return fetchApi<{ assignments: ProfileAssignment[] }>(`/signal-profiles/${id}/assets`, { method: 'PUT', body: JSON.stringify({ asset_ids: assetIds }) });
    return (await WailsApp.AssignSignalProfile(id, assetIds)) as { assignments: ProfileAssignment[] };
  },

  GetProfileCandidates: async (): Promise<{ candidates: ProfileCandidate[] }> => {
    if (isWeb) return fetchApi<{ candidates: ProfileCandidate[] }>('/signal-profiles/candidates');
    return (await WailsApp.GetProfileCandidates()) as { candidates: ProfileCandidate[] };
  },

  DismissProfileSuggestion: async (assetId: number): Promise<void> => {
    if (isWeb) {
      await fetchApi(`/signal-profiles/suggestions/${assetId}/dismiss`, { method: 'POST' });
      return;
    }
    return WailsApp.DismissProfileSuggestion(assetId);
  },
};
