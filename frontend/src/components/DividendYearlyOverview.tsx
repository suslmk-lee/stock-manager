import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account, Dividend } from '../types/models';
import { Calendar, X } from 'lucide-react';

interface MonthlyData {
  [accountId: number]: {
    accountName: string;
    broker: string;
    months: number[]; // 0-11 for Jan-Dec
    total: number;
    count: number;
  };
}

interface AssetMonthlyData {
  assetId: number;
  ticker: string;
  assetName: string;
  months: number[];
  total: number;
  count: number;
}

export default function DividendYearlyOverview() {
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<MonthlyData>({});
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [assetMonthlyData, setAssetMonthlyData] = useState<AssetMonthlyData[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedYear]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [accountsData, rate] = await Promise.all([
        apiClient.GetAllAccounts(),
        apiClient.GetUSDToKRW(),
      ]);

      const accountsList = accountsData as Account[];
      setAccounts(accountsList);
      const exchangeRate = rate as number;

      const data: MonthlyData = {};

      // 각 계좌별로 배당금 데이터 로드
      for (const account of accountsList) {
        const dividendsData = await apiClient.GetDividendsByAccount(account.id);
        const dividends = dividendsData as Dividend[];

        // 해당 연도의 배당금만 필터링
        const yearDividends = dividends.filter(div => {
          const divDate = new Date(div.date);
          return divDate.getFullYear() === selectedYear;
        });

        // 월별 집계
        const months = new Array(12).fill(0);
        let total = 0;

        yearDividends.forEach(div => {
          const divDate = new Date(div.date);
          const month = divDate.getMonth(); // 0-11
          const amountInKRW = div.currency === 'USD' 
            ? div.amount * exchangeRate 
            : div.amount;
          
          months[month] += amountInKRW;
          total += amountInKRW;
        });

        data[account.id] = {
          accountName: account.name,
          broker: account.broker,
          months,
          total,
          count: yearDividends.length,
        };
      }

      setMonthlyData(data);
    } catch (err) {
      console.error('Failed to load yearly overview:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    if (value === 0) return '-';
    return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  };

  const getMonthTotal = (month: number) => {
    return Object.values(monthlyData).reduce((sum, account) => sum + account.months[month], 0);
  };

  const getGrandTotal = () => {
    return Object.values(monthlyData).reduce((sum, account) => sum + account.total, 0);
  };

  const loadAssetDetails = async (account: Account) => {
    try {
      setModalLoading(true);
      setSelectedAccount(account);
      setShowAssetModal(true);

      const [dividendsData, rate] = await Promise.all([
        apiClient.GetDividendsByAccount(account.id),
        apiClient.GetUSDToKRW(),
      ]);

      const dividends = dividendsData as Dividend[];
      const exchangeRate = rate as number;

      // 해당 연도의 배당금만 필터링
      const yearDividends = dividends.filter(div => {
        const divDate = new Date(div.date);
        return divDate.getFullYear() === selectedYear;
      });

      // 자산별로 그룹화
      const assetMap = new Map<number, AssetMonthlyData>();

      yearDividends.forEach(div => {
        if (!div.asset) return;

        const divDate = new Date(div.date);
        const month = divDate.getMonth();
        const amountInKRW = div.currency === 'USD' 
          ? div.amount * exchangeRate 
          : div.amount;

        if (!assetMap.has(div.asset_id)) {
          assetMap.set(div.asset_id, {
            assetId: div.asset_id,
            ticker: div.asset.ticker,
            assetName: div.asset.name,
            months: new Array(12).fill(0),
            total: 0,
            count: 0,
          });
        }

        const assetData = assetMap.get(div.asset_id)!;
        assetData.months[month] += amountInKRW;
        assetData.total += amountInKRW;
        assetData.count += 1;
      });

      const sortedAssets = Array.from(assetMap.values()).sort((a, b) => b.total - a.total);
      setAssetMonthlyData(sortedAssets);
    } catch (err) {
      console.error('Failed to load asset details:', err);
    } finally {
      setModalLoading(false);
    }
  };

  const monthNames = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="text-center py-8 text-slate-400">데이터 로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="w-6 h-6 text-blue-400" />
          <h2 className="text-2xl font-bold">연간 배당금 현황</h2>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">연도:</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(year => (
              <option key={year} value={year}>{year}년</option>
            ))}
          </select>
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 border-b border-slate-600">
                <th className="px-4 py-3 text-left font-semibold text-slate-200 sticky left-0 bg-slate-700/50 z-20 min-w-[150px]">
                  계좌
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-200 min-w-[120px]">
                  증권사
                </th>
                {monthNames.map((month, index) => (
                  <th key={index} className="px-4 py-3 text-right font-semibold text-slate-200 min-w-[100px]">
                    {month}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-semibold text-blue-300 min-w-[120px] bg-slate-700/70">
                  합계
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-200 min-w-[80px]">
                  건수
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account, idx) => {
                const data = monthlyData[account.id];
                if (!data) return null;

                return (
                  <tr 
                    key={account.id} 
                    className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
                      idx % 2 === 0 ? 'bg-slate-800/50' : 'bg-slate-800/30'
                    }`}
                  >
                    <td 
                      className="px-4 py-3 font-medium text-white sticky left-0 bg-inherit z-20 cursor-pointer hover:text-blue-400 transition-colors"
                      onClick={() => loadAssetDetails(account)}
                    >
                      {data.accountName}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {data.broker}
                    </td>
                    {data.months.map((amount, monthIdx) => (
                      <td 
                        key={monthIdx} 
                        className={`px-4 py-3 text-right ${
                          amount > 0 ? 'text-green-400 font-medium' : 'text-slate-500'
                        }`}
                      >
                        {formatCurrency(amount)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-bold text-blue-400 bg-slate-700/30">
                      {formatCurrency(data.total)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {data.count}건
                    </td>
                  </tr>
                );
              })}
              
              {/* 합계 행 */}
              <tr className="bg-slate-700/50 font-bold border-t-2 border-slate-600">
                <td className="px-4 py-3 text-white sticky left-0 bg-slate-700/50 z-20">
                  월별 합계
                </td>
                <td className="px-4 py-3"></td>
                {monthNames.map((_, monthIdx) => {
                  const total = getMonthTotal(monthIdx);
                  return (
                    <td 
                      key={monthIdx} 
                      className={`px-4 py-3 text-right ${
                        total > 0 ? 'text-green-400' : 'text-slate-500'
                      }`}
                    >
                      {formatCurrency(total)}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right text-blue-400 bg-slate-700/50">
                  {formatCurrency(getGrandTotal())}
                </td>
                <td className="px-4 py-3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 요약 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-xl p-6 border border-blue-500/30">
          <p className="text-sm text-slate-400 mb-2">총 배당금</p>
          <p className="text-2xl font-bold text-white">{formatCurrency(getGrandTotal())}</p>
        </div>
        <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-6 border border-green-500/30">
          <p className="text-sm text-slate-400 mb-2">월평균 배당금</p>
          <p className="text-2xl font-bold text-white">
            {formatCurrency(getGrandTotal() / (new Date().getMonth() + 1))}
          </p>
        </div>
        <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-6 border border-purple-500/30">
          <p className="text-sm text-slate-400 mb-2">활성 계좌</p>
          <p className="text-2xl font-bold text-white">
            {Object.values(monthlyData).filter(d => d.total > 0).length}개
          </p>
        </div>
      </div>

      {/* 종목별 상세 모달 */}
      {showAssetModal && selectedAccount && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAssetModal(false)}
        >
          <div 
            className="bg-slate-800 rounded-xl border border-slate-700 max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <div>
                <h3 className="text-xl font-bold text-white">{selectedAccount.name} - 종목별 배당금</h3>
                <p className="text-sm text-slate-400 mt-1">{selectedAccount.broker} · {selectedYear}년</p>
              </div>
              <button
                onClick={() => setShowAssetModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* 모달 내용 */}
            <div className="flex-1 overflow-auto p-6">
              {modalLoading ? (
                <div className="text-center py-8 text-slate-400">데이터 로딩 중...</div>
              ) : assetMonthlyData.length === 0 ? (
                <div className="text-center py-8 text-slate-400">배당금 기록이 없습니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-700/50 border-b border-slate-600">
                        <th className="px-4 py-3 text-left font-semibold text-slate-200 sticky left-0 bg-slate-700/50 z-20 min-w-[200px]">
                          종목
                        </th>
                        {monthNames.map((month, index) => (
                          <th key={index} className="px-4 py-3 text-right font-semibold text-slate-200 min-w-[100px]">
                            {month}
                          </th>
                        ))}
                        <th className="px-4 py-3 text-right font-semibold text-blue-300 min-w-[120px] bg-slate-700/70">
                          합계
                        </th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-200 min-w-[80px]">
                          건수
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetMonthlyData.map((asset, idx) => (
                        <tr 
                          key={asset.assetId}
                          className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
                            idx % 2 === 0 ? 'bg-slate-800/50' : 'bg-slate-800/30'
                          }`}
                        >
                          <td className="px-4 py-3 sticky left-0 bg-inherit z-20">
                            <p className="font-medium text-white">
                              {asset.ticker.includes('.KS') || asset.ticker.includes('.KQ') 
                                ? asset.assetName 
                                : asset.ticker}
                            </p>
                            <p className="text-xs text-slate-400">
                              {asset.ticker.includes('.KS') || asset.ticker.includes('.KQ')
                                ? asset.ticker
                                : asset.assetName}
                            </p>
                          </td>
                          {asset.months.map((amount, monthIdx) => (
                            <td 
                              key={monthIdx}
                              className={`px-4 py-3 text-right ${
                                amount > 0 ? 'text-green-400 font-medium' : 'text-slate-500'
                              }`}
                            >
                              {formatCurrency(amount)}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-right font-bold text-blue-400 bg-slate-700/30">
                            {formatCurrency(asset.total)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-400">
                            {asset.count}건
                          </td>
                        </tr>
                      ))}

                      {/* 합계 행 */}
                      <tr className="bg-slate-700/50 font-bold border-t-2 border-slate-600">
                        <td className="px-4 py-3 text-white sticky left-0 bg-slate-700/50 z-20">
                          월별 합계
                        </td>
                        {monthNames.map((_, monthIdx) => {
                          const total = assetMonthlyData.reduce((sum, asset) => sum + asset.months[monthIdx], 0);
                          return (
                            <td 
                              key={monthIdx}
                              className={`px-4 py-3 text-right ${
                                total > 0 ? 'text-green-400' : 'text-slate-500'
                              }`}
                            >
                              {formatCurrency(total)}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-right text-blue-400 bg-slate-700/50">
                          {formatCurrency(assetMonthlyData.reduce((sum, asset) => sum + asset.total, 0))}
                        </td>
                        <td className="px-4 py-3"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
