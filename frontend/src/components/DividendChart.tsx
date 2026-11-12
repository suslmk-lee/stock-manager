import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { apiClient } from '../api/client';
import { Calendar } from 'lucide-react';
import CardIcon from './ui/CardIcon';
import { useThemeColors } from '../appearance/AppearanceContext';
import { IconTrend } from './ui/appIcons';

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
  const tc = useThemeColors();
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
        <div
          className="p-3 shadow-lg"
          style={{ background: tc.tooltip.contentStyle.background, border: tc.tooltip.contentStyle.border, borderRadius: 12 }}
        >
          <p className="text-white font-medium mb-1 text-sm">{data.label}</p>
          <p className="text-mint-300 text-sm num">배당금: {formatCurrency(data.total)}</p>
          <p className="label-mono mt-0.5">건수: {data.count}건</p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="surface p-6">
        <div className="flex items-center justify-center h-64">
          <div className="label-mono">로딩 중...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-rose-300">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <CardIcon icon={IconTrend} tone="mint" />
          <div>
            <h2 className="section-title !text-lg">월별 배당금 현황</h2>
            <p className="label-mono mt-0.5">최근 {months}개월</p>
          </div>
        </div>
        <div className="text-right">
          <p className="label-mono">총 배당금</p>
          <p className="num text-2xl sm:text-3xl font-light tracking-tight text-mint-300">{formatCurrency(totalDividend)}</p>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
          <Calendar className="w-14 h-14 mb-4 opacity-40" />
          <p className="text-lg">배당금 데이터가 없습니다.</p>
          <p className="text-sm mt-2">배당금을 추가하면 여기에 표시됩니다.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data} margin={{ top: 16, right: 16, left: 8, bottom: 5 }}>
            <defs>
              <linearGradient id="colorDividend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tc.accent} stopOpacity={0.9}/>
                <stop offset="100%" stopColor={tc.accent} stopOpacity={0.15}/>
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              axisLine={{ stroke: tc.grid }}
              tickLine={false}
              tick={{ fill: tc.axis, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: tc.axis, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
              tickFormatter={(value) => `₩${value.toLocaleString()}`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: tc.text, fillOpacity: 0.04 }} />
            <Legend
              wrapperStyle={{ color: tc.muted, fontSize: 11 }}
              iconType="circle"
              iconSize={8}
              formatter={() => '배당금'}
            />
            <Bar
              dataKey="total"
              fill="url(#colorDividend)"
              radius={[10, 10, 2, 2]}
              name="배당금"
            />
          </BarChart>
        </ResponsiveContainer>
      )}

      {data.length > 0 && (
        <div className="mt-6 surface-inset flex flex-col sm:flex-row items-stretch gap-4 sm:gap-0 p-5">
          {[
            { label: '평균 월 배당금', value: formatCurrency(totalDividend / data.length) },
            { label: '최고 월 배당금', value: formatCurrency(Math.max(...data.map(d => d.total || 0))) },
            { label: '총 배당 건수', value: `${data.reduce((sum, d) => sum + d.count, 0)}건` },
            { label: '배당 월 수', value: `${data.length}개월` },
          ].map((s, i) => (
            <div key={s.label} className="contents">
              {i > 0 && <span className="divider-v hidden sm:block" />}
              <div className="flex-1 sm:text-center">
                <p className="num text-lg font-light text-white">{s.value}</p>
                <p className="label-mono mt-1.5">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
