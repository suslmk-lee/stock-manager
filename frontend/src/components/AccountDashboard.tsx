import { useState, useEffect, type ReactNode } from 'react';
import { apiClient } from '../api/client';
import { Account } from '../types/models';
import { getAccountTypeMeta } from '../utils/accountType';
import { Lock } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import TotalReturnByAsset from './TotalReturnByAsset';
import AssetDetailView from './AssetDetailView';
import CardIcon from './ui/CardIcon';
import { useThemeColors } from '../appearance/AppearanceContext';
import { IconTrend, IconWallet } from './ui/appIcons';

interface AccountDashboardProps {
  account: Account;
  /** 머리글 오른쪽 버튼 (수정·삭제 등) */
  actions?: ReactNode;
}

const formatKRW = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`;
const compactKRW = (v: number) => {
  if (v >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
  if (v >= 10000) return `${Math.round(v / 10000).toLocaleString()}만`;
  return `₩${Math.round(v).toLocaleString('ko-KR')}`;
};

// 계좌 상세 (계좌 관리의 오른쪽 패널): 평가금 추세 + 종목별 실질 손익
export default function AccountDashboard({ account, actions }: AccountDashboardProps) {
  const tc = useThemeColors();
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
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <CardIcon icon={IconWallet} tone="mint" className="shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight text-white">{account.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="chip">{account.broker}</span>
              <span className="chip">{account.market_type === 'Domestic' ? '국내' : '해외'}</span>
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${getAccountTypeMeta(account).badgeClass}`}>
                {getAccountTypeMeta(account).restricted && <Lock className="w-3 h-3" />}
                {getAccountTypeMeta(account).short}
              </span>
              <span className="chip">{account.currency}</span>
              {account.account_number && <span className="label-mono">{account.account_number}</span>}
            </div>
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
      {account.description && <p className="-mt-2 mb-5 text-sm text-zinc-400">{account.description}</p>}

      {/* 평가금 추세 */}
      <div className="surface-inset p-4 sm:p-5 mb-5">
        <div className="flex items-center gap-3 mb-4">
          <CardIcon icon={IconTrend} tone="mint" size="sm" />
          <p className="section-title">평가금 추세</p>
        </div>
        <div className="h-56">
          {trendLoading ? (
            <div className="h-full flex items-center justify-center label-mono">추세 로딩 중...</div>
          ) : trend.length === 0 ? (
            <div className="h-full flex items-center justify-center label-mono">
              스냅샷 추세 데이터가 없습니다. (매월 자동 기록됩니다)
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="acctTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tc.accent} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={tc.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: tc.axis }} minTickGap={30} axisLine={{ stroke: tc.grid }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: tc.axis }} domain={['auto', 'auto']} width={55} axisLine={false} tickLine={false} tickFormatter={compactKRW} />
                <Tooltip
                  contentStyle={tc.tooltip.contentStyle}
                  labelStyle={tc.tooltip.labelStyle} itemStyle={tc.tooltip.itemStyle}
                  formatter={(v: number) => [formatKRW(v), '평가금(KRW)']}
                />
                <Area type="monotone" dataKey="value" stroke={tc.accent} strokeWidth={2} fill="url(#acctTrendFill)" />
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
