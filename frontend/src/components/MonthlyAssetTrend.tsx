import { useState, useEffect, useMemo } from 'react';
import { apiClient } from '../api/client';
import { Account, MonthlySnapshotSummary, PriceHistory } from '../types/models';
import { LiquidityFilter, matchesLiquidity, isRestrictedAccount } from '../utils/accountType';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceArea } from 'recharts';
import CountUp from './CountUp';
import { useThemeColors } from '../appearance/AppearanceContext';
import CardIcon from './ui/CardIcon';
import Chip from './ui/Chip';
import { IconTrend } from './ui/appIcons';

interface MonthlyAssetTrendProps {
  accountId?: number;
  marketType?: string;
  liquidity?: LiquidityFilter;
  months: number;
}

interface MonthPoint {
  key: string; // YYYY-MM
  label: string; // YY.MM
  liquid: number;
  restricted: number;
  total: number;
  /** 예수금 (월초 잔액, total 에 포함) */
  cash: number;
  estimated: boolean;
}


const formatKRW = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`;
const compactKRW = (v: number) => {
  if (v >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
  if (v >= 10000) return `${Math.round(v / 10000).toLocaleString()}만`;
  return `₩${Math.round(v).toLocaleString('ko-KR')}`;
};
const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const monthIndex = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
};
const signed = (v: number) => `${v >= 0 ? '+' : '-'}${formatKRW(Math.abs(v))}`;
const signedPct = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`;
const deltaColor = (v: number) => (v > 0 ? 'text-mint-300' : v < 0 ? 'text-rose-300' : 'text-zinc-300');

interface Delta {
  amount: number;
  pct: number | null;
}
const calcDelta = (from: number, to: number): Delta => ({
  amount: to - from,
  pct: from > 0 ? ((to - from) / from) * 100 : null,
});

function DeltaText({ delta, animate = false }: { delta: Delta | null; animate?: boolean }) {
  if (!delta) return <span className="text-zinc-500">-</span>;
  return (
    <span className={deltaColor(delta.amount)}>
      {animate ? <CountUp value={delta.amount} format={signed} /> : signed(delta.amount)}
      {delta.pct !== null && (
        <span className="ml-1 text-xs">
          ({animate ? <CountUp value={delta.pct} format={signedPct} /> : signedPct(delta.pct)})
        </span>
      )}
    </span>
  );
}

export default function MonthlyAssetTrend({
  accountId,
  marketType = 'all',
  liquidity = 'all',
  months,
}: MonthlyAssetTrendProps) {
  const tc = useThemeColors();
  const LIQUID_COLOR = tc.accent;
  const RESTRICTED_COLOR = tc.restricted;
  const SINGLE_COLOR = tc.palette[1];
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<MonthlySnapshotSummary[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentRate, setCurrentRate] = useState(1);
  const [fxMap, setFxMap] = useState<Map<string, number> | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [summaryData, accountsData, rate, hist] = await Promise.all([
          apiClient.GetMonthlySnapshotSummary(36),
          apiClient.GetAllAccounts(),
          apiClient.GetUSDToKRW(),
          apiClient.GetPriceHistory('KRW=X', '5y', '1mo').catch((err: unknown) => {
            console.error('Failed to load USD/KRW history:', err);
            return null;
          }),
        ]);
        if (cancelled) return;
        let map: Map<string, number> | null = null;
        const points = (hist as PriceHistory | null)?.points;
        const gmtoffset = (hist as PriceHistory | null)?.gmtoffset;
        if (points && points.length > 0) {
          map = new Map();
          points.forEach((p) => {
            if (!p.close || p.close <= 0) return;
            // 거래소 UTC 오프셋(gmtoffset)이 있으면 그것으로, 없으면 런던 BST 기준 2시간 보정
            const offset = typeof gmtoffset === 'number' ? gmtoffset : 2 * 3600;
            const d = new Date((p.time + offset) * 1000);
            map!.set(monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1), p.close);
          });
          if (map.size === 0) map = null;
        }
        setSummary(((summaryData as MonthlySnapshotSummary[]) || []).filter(Boolean));
        setAccounts((accountsData as Account[]) || []);
        setCurrentRate((rate as number) || 1);
        setFxMap(map);
      } catch (err) {
        console.error('Failed to load monthly asset trend:', err);
        if (!cancelled) setSummary([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const series = useMemo<MonthPoint[]>(() => {
    const accMap = new Map(accounts.map((a) => [a.id, a]));
    const noFilter = !accountId && marketType === 'all' && liquidity === 'all';
    const fxKeys = fxMap ? Array.from(fxMap.keys()).sort() : [];
    const rateFor = (key: string) => {
      if (!fxMap) return currentRate;
      // 스냅샷은 월초에 기록되므로 전월 종가(= 해당 월 월초 환율)를 우선 사용
      let found: number | undefined;
      for (const k of fxKeys) {
        if (k < key) found = fxMap.get(k);
        else break;
      }
      return found ?? fxMap.get(key) ?? currentRate;
    };

    const agg = new Map<string, MonthPoint>();
    for (const row of summary) {
      const acc = accMap.get(row.account_id);
      if (acc) {
        if (accountId && acc.id !== accountId) continue;
        if (marketType === 'domestic' && acc.market_type !== 'Domestic') continue;
        if (marketType === 'international' && acc.market_type !== 'International') continue;
        if (!matchesLiquidity(acc, liquidity)) continue;
      } else if (!noFilter) {
        continue;
      }
      const key = monthKey(row.year, row.month);
      const value = row.currency === 'USD' ? (row.total_value || 0) * rateFor(key) : row.total_value || 0;
      let p = agg.get(key);
      if (!p) {
        p = { key, label: key.slice(2).replace('-', '.'), liquid: 0, restricted: 0, total: 0, cash: 0, estimated: !!row.estimated };
        agg.set(key, p);
      }
      if (acc && isRestrictedAccount(acc)) p.restricted += value;
      else p.liquid += value;
      p.total += value;
      if (row.cash) p.cash += value;
    }
    return Array.from(agg.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [summary, accounts, currentRate, fxMap, accountId, marketType, liquidity]);

  // 최근 N개월 창 (최신 데이터 월 기준)
  const windowed = useMemo(() => {
    if (series.length === 0) return [];
    const latest = monthIndex(series[series.length - 1].key);
    return series.filter((p) => monthIndex(p.key) > latest - months);
  }, [series, months]);

  // 직전 존재 월 대비 증감 (창 바깥 월 포함)
  const momDelta = useMemo(() => {
    const map = new Map<string, Delta>();
    series.forEach((p, i) => {
      if (i > 0) map.set(p.key, calcDelta(series[i - 1].total, p.total));
    });
    return map;
  }, [series]);

  // 연속된 추정 구간(label 기준) 목록
  const estimatedRuns = useMemo(() => {
    const runs: { x1: string; x2: string }[] = [];
    let start: string | null = null;
    let prevLabel = '';
    for (const p of windowed) {
      if (p.estimated) {
        if (start === null) start = p.label;
        prevLabel = p.label;
      } else if (start !== null) {
        runs.push({ x1: start, x2: prevLabel });
        start = null;
      }
    }
    if (start !== null) runs.push({ x1: start, x2: prevLabel });
    return runs;
  }, [windowed]);

  const stacked = liquidity === 'all' && !accountId;
  const showRestricted = stacked && windowed.some((p) => p.restricted > 0);
  const hasCash = windowed.some((p) => Math.abs(p.cash) >= 1);

  if (loading) {
    return (
      <div className="surface p-5 sm:p-6 animate-pulse">
        <div className="h-4 w-32 rounded bg-white/10 mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-white/[0.05]" />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-white/[0.04]" />
      </div>
    );
  }

  const header = (
    <div className="flex items-center gap-3 mb-5">
      <CardIcon icon={IconTrend} tone="mint" size="sm" />
      <h3 className="section-title">월별 자산 추이</h3>
    </div>
  );

  if (windowed.length === 0) {
    return (
      <div className="surface p-5 sm:p-6">
        {header}
        <div className="h-32 flex items-center justify-center text-sm text-zinc-500 text-center">
          스냅샷 데이터가 없습니다. (매월 첫 실행 시 자동 기록됩니다)
        </div>
      </div>
    );
  }

  const first = windowed[0];
  const last = windowed[windowed.length - 1];
  const hasCompare = windowed.length >= 2;
  const prev = windowed.length >= 2 ? windowed[windowed.length - 2] : null;
  const monthDelta = prev ? calcDelta(prev.total, last.total) : null;
  const periodDelta = hasCompare ? calcDelta(first.total, last.total) : null;
  const tableRows = [...windowed].reverse();

  const tile = 'surface-inset p-4';

  return (
    <div className="surface p-5 sm:p-6">
      {header}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-1">
        <div className={tile}>
          <p className="label-mono mb-2">최근 평가액 ({last.label})</p>
          <p className="num text-2xl font-light tracking-tight text-white"><CountUp value={last.total} format={formatKRW} /></p>
        </div>
        <div className={tile}>
          <p className="label-mono mb-2">
            전월 대비 평가액 변화{prev ? ` (${prev.label} → ${last.label})` : ''}
          </p>
          <p className="num text-lg font-light tracking-tight">
            <DeltaText delta={monthDelta} animate />
          </p>
        </div>
        <div className={tile}>
          <p className="label-mono mb-2">
            기간 대비 평가액 변화{first.estimated ? ' (추정 포함)' : ''}{hasCompare ? ` (${first.label} → ${last.label})` : ''}
          </p>
          <p className="num text-lg font-light tracking-tight">
            <DeltaText delta={periodDelta} animate />
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3 mb-5">
        <Chip check>입금·매수에 따른 증감 포함</Chip>
        <Chip check>{fxMap === null ? '환율: 현재 환율 기준' : '환율: 월초 기준'}</Chip>
        {hasCash && <Chip check>예수금 포함 (월초 잔액)</Chip>}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={windowed} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="mat-liquid" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LIQUID_COLOR} stopOpacity={0.32} />
                <stop offset="100%" stopColor={LIQUID_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="mat-restricted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={RESTRICTED_COLOR} stopOpacity={0.32} />
                <stop offset="100%" stopColor={RESTRICTED_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="mat-single" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SINGLE_COLOR} stopOpacity={0.28} />
                <stop offset="100%" stopColor={SINGLE_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: tc.axis, fontFamily: 'JetBrains Mono, monospace' }} minTickGap={30} axisLine={{ stroke: tc.grid }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: tc.axis, fontFamily: 'JetBrains Mono, monospace' }} domain={[0, 'auto']} width={55} axisLine={false} tickLine={false} tickFormatter={compactKRW} />
            <Tooltip
              contentStyle={tc.tooltip.contentStyle}
              labelStyle={tc.tooltip.labelStyle}
              itemStyle={tc.tooltip.itemStyle}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const p = payload[0].payload as MonthPoint;
                return (
                  <div style={{ ...tc.tooltip.contentStyle, padding: '10px 12px' }}>
                    <p style={{ color: tc.tooltip.labelStyle.color, marginBottom: 4 }}>{label}{p.estimated ? ' (추정)' : ''}</p>
                    {stacked ? (
                      <>
                        <p style={{ color: LIQUID_COLOR }}>인출 가능: {formatKRW(p.liquid)}</p>
                        {showRestricted && <p style={{ color: RESTRICTED_COLOR }}>인출 제한: {formatKRW(p.restricted)}</p>}
                        <p style={{ color: tc.text, marginTop: 2 }}>합계: {formatKRW(p.total)}</p>
                      </>
                    ) : (
                      <p style={{ color: SINGLE_COLOR }}>평가액: {formatKRW(p.total)}</p>
                    )}
                    {Math.abs(p.cash) >= 1 && <p style={{ color: tc.muted }}>└ 예수금: {formatKRW(p.cash)}</p>}
                  </div>
                );
              }}
            />
            {estimatedRuns.map((r) => (
              <ReferenceArea
                key={r.x1}
                x1={r.x1}
                x2={r.x2}
                fill={tc.text}
                fillOpacity={0.04}
                stroke="none"
                ifOverflow="extendDomain"
                label={{ value: '추정', position: 'insideTop', fill: tc.axis, fontSize: 10 }}
              />
            ))}
            {stacked ? (
              <>
                <Legend wrapperStyle={{ fontSize: 11, color: tc.muted }} iconType="circle" iconSize={8} />
                <Area type="monotone" dataKey="liquid" name="인출 가능" stackId="a" stroke={LIQUID_COLOR} strokeWidth={1.75} fill="url(#mat-liquid)" />
                {showRestricted && (
                  <Area type="monotone" dataKey="restricted" name="인출 제한" stackId="a" stroke={RESTRICTED_COLOR} strokeWidth={1.75} fill="url(#mat-restricted)" />
                )}
              </>
            ) : (
              <Area type="monotone" dataKey="total" name="평가액" stroke={SINGLE_COLOR} strokeWidth={1.75} fill="url(#mat-single)" />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {estimatedRuns.length > 0 && (
        <p className="mt-2 label-mono !text-zinc-500 normal-case">
          추정: 실제 기록 이전 기간은 거래내역과 과거 월초 시세로 계산한 값입니다 (직접 입력한 보유는 기간 내내 보유로 가정)
        </p>
      )}

      <button
        onClick={() => setShowTable((v) => !v)}
        className="mt-3 btn-ghost !py-1.5 !text-xs"
      >
        {showTable ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        월별 상세 보기
      </button>

      {showTable && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-head border-b border-white/[0.08]">
                <th className="text-left py-2.5 pr-3 font-normal">월</th>
                {stacked && <th className="text-right py-2.5 px-3 font-normal">인출 가능</th>}
                {stacked && <th className="text-right py-2.5 px-3 font-normal">인출 제한</th>}
                {hasCash && <th className="text-right py-2.5 px-3 font-normal">예수금</th>}
                <th className="text-right py-2.5 px-3 font-normal">합계</th>
                <th className="text-right py-2.5 pl-3 font-normal">전월 대비</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((p) => (
                <tr key={p.key} className="table-row num text-zinc-200">
                  <td className="py-2.5 pr-3 whitespace-nowrap">{p.label}
                    {p.estimated && (
                      <span className="ml-1.5 chip !px-1.5 !py-0 !text-[10px]">추정</span>
                    )}
                  </td>
                  {stacked && <td className="text-right py-2.5 px-3 whitespace-nowrap">{formatKRW(p.liquid)}</td>}
                  {stacked && <td className="text-right py-2.5 px-3 whitespace-nowrap">{formatKRW(p.restricted)}</td>}
                  {hasCash && <td className="text-right py-2.5 px-3 whitespace-nowrap text-zinc-400">{Math.abs(p.cash) >= 1 ? formatKRW(p.cash) : '—'}</td>}
                  <td className="text-right py-2.5 px-3 whitespace-nowrap font-medium text-white">{formatKRW(p.total)}</td>
                  <td className="text-right py-2.5 pl-3 whitespace-nowrap">
                    <DeltaText delta={momDelta.get(p.key) || null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
