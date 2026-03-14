// Stub module for web-only builds (Cloudflare Pages)
// These functions are never called in web mode - they exist only to satisfy TypeScript imports
const stub = (..._args: any[]): never => { throw new Error('Wails bindings not available in web mode'); };

export const GetAllAccounts = stub;
export const GetAccount = stub;
export const CreateAccount = stub;
export const UpdateAccount = stub;
export const DeleteAccount = stub;
export const GetAllAssets = stub;
export const GetAssetByTicker = stub;
export const CreateAsset = stub;
export const UpdateAsset = stub;
export const DeleteAsset = stub;
export const GetAllHoldings = stub;
export const GetHoldingsByAccount = stub;
export const CreateHolding = stub;
export const UpdateHolding = stub;
export const DeleteHolding = stub;
export const GetTransactionsByAccount = stub;
export const GetTransactionsByAsset = stub;
export const CreateTransaction = stub;
export const GetDividendsByAccount = stub;
export const CreateDividend = stub;
export const UpdateDividend = stub;
export const DeleteDividend = stub;
export const GetMonthlyDividends = stub;
export const GetMonthlyDividendsByAccount = stub;
export const GetDividendStats = stub;
export const GetTickerInfo = stub;
export const SearchTicker = stub;
export const GetCurrentPrice = stub;
export const GetUSDToKRW = stub;
export const ConvertToKRW = stub;
