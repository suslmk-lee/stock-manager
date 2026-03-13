import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { apiClient } from '../api/client';
import { TrendingUp, Calendar } from 'lucide-react';

interface MonthlyDividend {
  year: number;
  month: number;
  total_usd: number;
  total_krw: number;
  count: number;
  label: string;
  total?: number; // Computed field for display
}

interface DividendChartProps {
  accountId?: number;
  months?: number;
}

export default function DividendChart({ accountId, months = 12 }: DividendChartProps) {
  const [data, setData] = useState<MonthlyDividend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalDividend, setTotalDividend] = useState(0);

  useEffect(() => {
    loadDividendData();
  }, [accountId, months]);

  const loadDividendData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get exchange rate
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const [allData, rate] = await Promise.all([
        apiClient.GetMonthlyDividends(startStr, endStr),
        apiClient.GetUSDToKRW()
      ]);

      let result: MonthlyDividend[];
      if (accountId) {
        result = await apiClient.GetMonthlyDividendsByAccount(accountId, startStr, endStr) as MonthlyDividend[];
      } else {
        result = allData as MonthlyDividend[];
      }

      // Convert to KRW: USD * rate + KRW
      const convertedData = result?.map(item => ({
        ...item,
        total: (item.total_usd * rate) + item.total_krw
      })) || [];

      setData(convertedData);
      
      const total = convertedData.reduce((sum, item) => sum + (item.total || 0), 0);
      setTotalDividend(total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다.');
      console.error('Failed to load dividend data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency: 'KRW',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-lg">
          <p className="text-white font-semibold mb-1">{data.label}</p>
          <p className="text-green-400">배당금: {formatCurrency(data.total)}</p>
          <p className="text-slate-400 text-sm">건수: {data.count}건</p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-center h-64">
          <div className="text-slate-400">로딩 중...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">월별 배당금 현황</h2>
            <p className="text-slate-400 text-sm">최근 {months}개월</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-400">총 배당금</p>
          <p className="text-2xl font-bold text-green-400">{formatCurrency(totalDividend)}</p>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
          <Calendar className="w-16 h-16 mb-4 opacity-50" />
          <p className="text-lg">배당금 데이터가 없습니다.</p>
          <p className="text-sm mt-2">배당금을 추가하면 여기에 표시됩니다.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <defs>
              <linearGradient id="colorDividend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#059669" stopOpacity={0.6}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="label" 
              stroke="#9ca3af"
              tick={{ fill: '#9ca3af' }}
            />
            <YAxis 
              stroke="#9ca3af"
              tick={{ fill: '#9ca3af' }}
              tickFormatter={(value) => `₩${value.toLocaleString()}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              wrapperStyle={{ color: '#9ca3af' }}
              formatter={() => '배당금'}
            />
            <Bar 
              dataKey="total" 
              fill="url(#colorDividend)" 
              radius={[8, 8, 0, 0]}
              name="배당금"
            />
          </BarChart>
        </ResponsiveContainer>
      )}

      {data.length > 0 && (
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-700/50 rounded-lg p-4">
            <p className="text-slate-400 text-sm">평균 월 배당금</p>
            <p className="text-white text-lg font-semibold mt-1">
              {formatCurrency(totalDividend / data.length)}
            </p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-4">
            <p className="text-slate-400 text-sm">최고 월 배당금</p>
            <p className="text-white text-lg font-semibold mt-1">
              {formatCurrency(Math.max(...data.map(d => d.total || 0)))}
            </p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-4">
            <p className="text-slate-400 text-sm">총 배당 건수</p>
            <p className="text-white text-lg font-semibold mt-1">
              {data.reduce((sum, d) => sum + d.count, 0)}건
            </p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-4">
            <p className="text-slate-400 text-sm">배당 월 수</p>
            <p className="text-white text-lg font-semibold mt-1">
              {data.length}개월
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
