import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account } from '../types/models';
import { ArrowLeft, Wallet } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import TotalReturnByAsset from './TotalReturnByAsset';
import AssetDetailView from './AssetDetailView';

interface AccountDashboardProps {
  account: Account;
  onBack: () => void;
}

const formatKRW = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`;
const compactKRW = (v: number) => {
  if (v >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
  if (v >= 10000) return `${Math.round(v / 10000).toLocaleString()}만`;
  return `₩${Math.round(v).toLocaleString('ko-KR')}`;
};

export default function AccountDashboard({ account, onBack }: AccountDashboardProps) {
  const [trend, setTrend] = useState<{ label: string; value: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [detailAsset, setDetailAsset] = useState<{ assetId: number; ticker: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTrendLoading(true);
      try {
        const [snapData, rate] = await Promise.all([
          apiClient.GetSnapshotsByAccount(account.id),
          apiClient.GetUSDToKRW(),
        ]);
        if (cancelled) return;
        const exchangeRate = rate as number;
        const map = new Map<string, number>();
        ((snapData as any[]) || []).forEach((s) => {
          const key = `${s.year}-${String(s.month).padStart(2, '0')}`;
          const valKRW = s.currency === 'USD' ? (s.market_value || 0) * exchangeRate : (s.market_value || 0);
          map.set(key, (map.get(key) || 0) + valKRW);
        });
        setTrend(
          Array.from(map.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, v]) => ({ label: k.slice(2), value: v }))
        );
      } catch (err) {
        console.error('Failed to load account trend:', err);
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account.id]);

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> 계좌 목록
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <Wallet className="w-5 h-5 text-blue-400 shrink-0" />
          <h2 className="text-xl sm:text-2xl font-bold text-white truncate">{account.name}</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 whitespace-nowrap">
            {account.broker}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 whitespace-nowrap">
            {account.market_type === 'Domestic' ? '국내' : '해외'}
          </span>
        </div>
      </div>

      {/* 평가금 추세 */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-4 sm:p-6 border border-slate-700 mb-6">
        <p className="text-sm font-semibold text-white mb-3">평가금 추세</p>
        <div className="h-56">
          {trendLoading ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">추세 로딩 중...</div>
          ) : trend.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">
              스냅샷 추세 데이터가 없습니다. (매월 자동 기록됩니다)
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="acctTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={30} axisLine={{ stroke: '#334155' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} domain={['auto', 'auto']} width={55} axisLine={false} tickLine={false} tickFormatter={compactKRW} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#cbd5e1' }} itemStyle={{ color: '#e2e8f0' }}
                  formatter={(v: number) => [formatKRW(v), '평가금(KRW)']}
                />
                <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fill="url(#acctTrendFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 종목별 실질 손익 (계좌 기준, 행 클릭 → 종목 상세) */}
      <TotalReturnByAsset accountId={account.id} onSelectAsset={setDetailAsset} />

      {detailAsset && (
        <AssetDetailView
          assetId={detailAsset.assetId}
          ticker={detailAsset.ticker}
          name={detailAsset.name}
          accountId={account.id}
          accountName={account.name}
          onClose={() => setDetailAsset(null)}
        />
      )}
    </div>
  );
}
