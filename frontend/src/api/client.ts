import * as WailsApp from '../../wailsjs/go/main/App';
import { Account, Asset, Holding, Transaction, Dividend } from '../types/models';

// Wails 환경(데스크톱 앱)인지 웹 브라우저(모바일 등)인지 판별
// Wails 환경에서는 window.go 객체가 존재합니다.
const isWeb = !(window as any).go;

// 개발 중 웹 브라우저에서 접속할 API 서버 주소 (자신의 PC 로컬 IP로 변경하세요)
const API_BASE_URL = 'http://localhost:8080/api';

/**
 * HTTP 요청 헬퍼 함수
 */
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
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

  CreateAccount: async (name: string, broker: string, accountNumber: string, marketType: string, currency: string, description: string) => {
    if (isWeb) {
      return fetchApi<Account>('/accounts', {
        method: 'POST',
        body: JSON.stringify({ name, broker, accountNumber, marketType, currency, description }),
      });
    }
    return WailsApp.CreateAccount(name, broker, accountNumber, marketType, currency, description);
  },

  UpdateAccount: async (id: number, name: string, broker: string, accountNumber: string, marketType: string, currency: string, description: string) => {
    if (isWeb) {
      return fetchApi<Account>(`/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, broker, accountNumber, marketType, currency, description }),
      });
    }
    return WailsApp.UpdateAccount(id, name, broker, accountNumber, marketType, currency, description);
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
        body: JSON.stringify({ ticker, name, type, sector, accountID, quantity, averagePrice }),
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
        body: JSON.stringify({ accountID, assetID, quantity, averagePrice }),
      });
    }
    return WailsApp.CreateHolding(accountID, assetID, quantity, averagePrice);
  },

  UpdateHolding: async (id: number, quantity: number, averagePrice: number) => {
    if (isWeb) {
      return fetchApi<Holding>(`/holdings/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ quantity, averagePrice }),
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
        body: JSON.stringify({ accountID, assetID, type, date, price, quantity, fee, notes }),
      });
    }
    return WailsApp.CreateTransaction(accountID, assetID, type, date, price, quantity, fee, notes);
  },

  // ==========================================
  // Dividends
  // ==========================================
  GetDividendsByAccount: async (accountID: number) => {
    if (isWeb) return fetchApi<Dividend[]>(`/accounts/${accountID}/dividends`);
    return WailsApp.GetDividendsByAccount(accountID);
  },

  CreateDividend: async (accountID: number, assetID: number, date: string, amount: number, tax: number, currency: string, isReceived: boolean, notes: string) => {
    if (isWeb) {
      return fetchApi<Dividend>('/dividends', {
        method: 'POST',
        body: JSON.stringify({ accountID, assetID, date, amount, tax, currency, isReceived, notes }),
      });
    }
    return WailsApp.CreateDividend(accountID, assetID, date, amount, tax, currency, isReceived, notes);
  },

  UpdateDividend: async (id: number, accountID: number, assetID: number, date: string, amount: number, tax: number, currency: string, isReceived: boolean, notes: string) => {
    if (isWeb) {
      return fetchApi<Dividend>(`/dividends/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ accountID, assetID, date, amount, tax, currency, isReceived, notes }),
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

  GetUSDToKRW: async () => {
    if (isWeb) return fetchApi<number>('/exchange-rate/usd-krw');
    return WailsApp.GetUSDToKRW();
  },

  ConvertToKRW: async (amount: number, currency: string) => {
    if (isWeb) return fetchApi<number>(`/exchange-rate/convert?amount=${amount}&currency=${currency}`);
    return WailsApp.ConvertToKRW(amount, currency);
  },
};
