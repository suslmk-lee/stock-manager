import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../../api/client';
import type { Account, Dividend, Holding, PriceHistory } from '../../types/models';
import { useThemeColors } from '../../appearance/AppearanceContext';
import { LiquidityFilter, matchesLiquidity } from '../../utils/accountType';
import { analyzeDividends, monthKeyOf } from '../../utils/dividendAnalysis';
import { assetPrimary, assetSecondary, tickerFirst } from '../../utils/assetLabel';
import CardIcon from '../ui/CardIcon';
import BrokerLogo from '../ui/BrokerLogo';
import { IconBars, IconCalendar, IconChart, IconCoin, IconLayers, IconPercent, IconPie, IconReceipt, IconTrend } from '../ui/appIcons';

/**
 * 배당 분석 — 받은 배당(세후)을 계좌 필터대로 모아 본다.
 * 최근 12개월·올해·앞으로 12개월 예상·배당률, 연도별 성장, 올해와 작년 월별, 종목별 표, 계좌별·국내/해외, (있으면) 세금.
 */

interface Props {
  accountId?: number;
  marketType?: string;
  liquidity?: LiquidityFilter;
  months: number;
}

const krw = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`;
const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 100000000) return `${(v / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  if (a >= 10000) return `${Math.round(v / 10000).toLocaleString('ko-KR')}만`;
  return Math.round(v).toLocaleString('ko-KR');
};
const pct = (v: number, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`;
const shortDate = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
const SHOW = 15;

function Card({ title, sub, icon, right, children, className = '' }: { title: string; sub?: string; icon: Parameters<typeof CardIcon>[0]['icon']; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`surface p-5 sm:p-6 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <CardIcon icon={icon} size="sm" />
          <div>
            <h3 className="section-title">{title}</h3>
            {sub && <p className="label-mono mt-0.5">{sub}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function ShareBar({ label, value, total, color, extra }: { label: ReactNode; value: number; total: number; color: string; extra?: ReactNode }) {
  const share = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate text-zinc-200">{label}</span>
        <span className="num shrink-0 text-zinc-100">
          {krw(value)} <span className="text-[11px] text-zinc-500">{share.toFixed(1)}%</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(share, value > 0 ? 1 : 0)}%`, background: color }} />
      </div>
      {extra}
    </div>
  );
}

export default function DividendAnalysis({ accountId = 0, marketType = 'all', liquidity = 'all', months }: Props) {
  const tc = useThemeColors();
  const [data, setData] = useState<{ dividends: Dividend[]; holdings: Holding[]; accounts: Account[]; rate: number; fx: Map<string, number> | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(SHOW);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dividends, holdings, accounts, rate, hist] = await Promise.all([
          apiClient.GetAllDividends(),
          apiClient.GetAllHoldings(),
          apiClient.GetAllAccounts(),
          apiClient.GetUSDToKRW(),
          apiClient.GetPriceHistory('KRW=X', '5y', '1mo').catch(() => null),
        ]);
        // 달별 환율 (거래소 UTC 오프셋 기준 달)
        let fx: Map<string, number> | null = null;
        const h = hist as PriceHistory | null;
        if (h?.points?.length) {
          fx = new Map();
          const offset = typeof h.gmtoffset === 'number' ? h.gmtoffset : 2 * 3600;
          for (const p of h.points) {
            if (!p.close || p.close <= 0) continue;
            const d = new Date((p.time + offset) * 1000);
            fx.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, p.close);
          }
        }
        if (!cancelled) setData({ dividends: (dividends as Dividend[]) ?? [], holdings: (holdings as Holding[]) ?? [], accounts: (accounts as Account[]) ?? [], rate: (rate as number) || 0, fx });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const a = useMemo(() => {
    if (!data) return null;
    const keys = data.fx ? [...data.fx.keys()].sort() : [];
    const rateFor = (key: string) => {
      if (!data.fx) return data.rate;
      const exact = data.fx.get(key);
      if (exact) return exact;
      let found: number | undefined;
      for (const k of keys) {
        if (k <= key) found = data.fx.get(k);
        else break;
      }
      return found ?? data.rate;
    };
    return analyzeDividends({
      dividends: data.dividends,
      holdings: data.holdings,
      accounts: data.accounts,
      includeAccount: (acc) =>
        (!accountId || acc.id === accountId) &&
        (marketType === 'all' || (marketType === 'domestic' ? acc.market_type === 'Domestic' : acc.market_type === 'International')) &&
        matchesLiquidity(acc, liquidity),
      rateFor,
      currentRate: data.rate,
      periodMonths: months,
    });
  }, [data, accountId, marketType, liquidity, months]);

  if (error) return <div className="surface p-6 text-sm text-rose-300">배당 분석을 불러오지 못했습니다: {error}</div>;
  if (!a) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="surface h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  const growth = a.lastYtdKRW > 0 ? ((a.ytdKRW - a.lastYtdKRW) / a.lastYtdKRW) * 100 : null;
  const kpis = [
    { label: '최근 12개월 배당', value: krw(a.t12KRW), sub: `월평균 ${krw(a.t12KRW / 12)}`, icon: IconCoin },
    {
      label: `${a.thisYear}년 배당`,
      value: krw(a.ytdKRW),
      sub: growth == null ? '작년 같은 기간 기록 없음' : `작년 같은 기간 ${krw(a.lastYtdKRW)} · ${pct(growth)}`,
      icon: IconTrend,
      tone: growth == null ? undefined : growth >= 0 ? 'text-mint-300' : 'text-rose-300',
    },
    { label: '앞으로 12개월 예상', value: krw(a.forecastKRW), sub: '지난 12개월 지급 기준 추정', icon: IconCalendar },
    { label: '투자금 대비 배당률', value: a.yoc == null ? '—' : `${a.yoc.toFixed(2)}%`, sub: `최근 12개월 ÷ 투자금 ${krw(a.costKRW)}`, icon: IconPercent },
  ];

  const axisTick = { fontSize: 11, fill: tc.axis, fontFamily: 'JetBrains Mono, monospace' };
  const tooltip = (fmt: (v: number) => string) => ({
    contentStyle: tc.tooltip.contentStyle,
    labelStyle: tc.tooltip.labelStyle,
    itemStyle: tc.tooltip.itemStyle,
    formatter: (v: number) => fmt(v),
    cursor: { fill: tc.grid, opacity: 0.35 },
  });
  const LAST = tc.palette[2] ?? tc.axis;
  const hasLastYear = a.monthCompare.some((m) => m.lastYear > 0);
  const assetsShown = a.assets.slice(0, limit);
  const marketTotal = a.byMarket.domestic + a.byMarket.overseas;
  const currentMonth = monthKeyOf(new Date());

  return (
    <div className="space-y-6">
      {/* 주요 숫자 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="stat-label">{k.label}</p>
              <CardIcon icon={k.icon} size="sm" />
            </div>
            <p className="num text-2xl font-light tracking-tight text-white">{k.value}</p>
            <p className={`num mt-1.5 text-[11px] ${k.tone ?? 'text-zinc-500'}`}>{k.sub}</p>
          </div>
        ))}
      </div>

      {a.receivedCount === 0 ? (
        <div className="surface p-8 text-center text-sm text-zinc-400">이 조건에 맞는 받은 배당이 없습니다.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* 연도별 */}
            <Card title="연도별 배당" sub="받은 배당 (세후) · 지난해 대비 · 올해는 위 카드에서 같은 기간끼리 비교" icon={IconBars}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={a.yearly} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={tc.grid} strokeOpacity={0.5} />
                    <XAxis dataKey="year" tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis tick={axisTick} tickFormatter={compact} width={48} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltip(krw)} />
                    <Bar dataKey="krw" name="배당" fill={tc.accent} radius={[6, 6, 0, 0]} maxBarSize={56} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {a.yearly.map((y) => (
                  <span key={y.year} className="num text-[11px] text-zinc-400">
                    {y.year}
                    {y.partial ? ' (진행 중)' : ''} {krw(y.krw)}
                    {y.growth != null && <span className={y.growth >= 0 ? ' text-mint-300' : ' text-rose-300'}> {pct(y.growth, 0)}</span>}
                  </span>
                ))}
              </div>
            </Card>

            {/* 올해 vs 작년 */}
            <Card title={`월별 ${a.thisYear}년 · ${a.thisYear - 1}년`} sub="같은 달끼리 비교" icon={IconChart}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={a.monthCompare} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke={tc.grid} strokeOpacity={0.5} />
                    <XAxis dataKey="month" tick={axisTick} tickFormatter={(m: number) => `${m}월`} axisLine={false} tickLine={false} interval={0} />
                    <YAxis tick={axisTick} tickFormatter={compact} width={48} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltip(krw)} labelFormatter={(m: number) => `${m}월`} />
                    <Legend wrapperStyle={{ fontSize: 11, color: tc.muted }} iconType="circle" iconSize={8} />
                    {hasLastYear && <Bar dataKey="lastYear" name={`${a.thisYear - 1}년`} fill={LAST} radius={[4, 4, 0, 0]} isAnimationActive={false} />}
                    <Bar dataKey="thisYear" name={`${a.thisYear}년`} fill={tc.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* 앞으로 12개월 */}
          <Card
            title="앞으로 12개월 예상 배당"
            sub="지난 12개월에 받은 달·금액을 1년 뒤로 옮긴 추정 · 지금 보유한 종목만 · 수량 변화는 반영하지 않음"
            icon={IconCalendar}
            right={<span className="num text-lg font-light text-mint-300">{krw(a.forecastKRW)}</span>}
          >
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.forecast} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={tc.grid} strokeOpacity={0.5} />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={axisTick} tickFormatter={compact} width={48} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltip(krw)} />
                  <Legend wrapperStyle={{ fontSize: 11, color: tc.muted }} iconType="circle" iconSize={8} />
                  <Bar dataKey="confirmed" name="적어 둔 예정 배당" stackId="f" fill={tc.palette[1]} isAnimationActive={false} />
                  <Bar dataKey="projected" name="예상" stackId="f" fill={tc.accent} fillOpacity={0.55} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 종목별 */}
          <Card title="종목별 배당" sub={`최근 ${months}개월 큰 순서 · 배당률은 최근 12개월 ÷ 지금 투자금`} icon={IconLayers}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="table-head border-b border-white/[0.08]">
                    <th className="py-2.5 pr-3 text-left font-normal">종목</th>
                    <th className="px-3 py-2.5 text-right font-normal">최근 {months}개월</th>
                    <th className="px-3 py-2.5 text-right font-normal">배당률</th>
                    <th className="px-3 py-2.5 text-center font-normal">주기</th>
                    <th className="px-3 py-2.5 text-right font-normal">마지막</th>
                    <th className="px-3 py-2.5 text-right font-normal">다음 예상</th>
                    <th className="py-2.5 pl-3 text-right font-normal">누적</th>
                  </tr>
                </thead>
                <tbody>
                  {assetsShown.map((r) => {
                    const first = tickerFirst(r.asset);
                    const soon = r.nextDate && r.nextDate.slice(0, 7) === currentMonth;
                    return (
                      <tr key={r.assetId} className="table-row num text-zinc-200">
                        <td className="max-w-[220px] py-2.5 pr-3">
                          <span className="flex items-baseline gap-1.5">
                            <span className={`truncate ${first ? 'font-semibold text-white' : 'text-zinc-100'}`}>{assetPrimary(r.asset, `#${r.assetId}`)}</span>
                            <span className={`truncate text-[11px] text-zinc-500 ${first ? '' : 'font-mono'}`}>{assetSecondary(r.asset)}</span>
                          </span>
                          {!r.held && <span className="label-mono">지금 보유 없음</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-white">{r.periodKRW > 0 ? krw(r.periodKRW) : '—'}</td>
                        <td className="px-3 py-2.5 text-right">{r.yoc == null ? <span className="text-zinc-600">—</span> : <span className="text-amber-300">{r.yoc.toFixed(2)}%</span>}</td>
                        <td className="px-3 py-2.5 text-center">{r.cycle ? <span className="chip !px-2 !py-0 !text-[11px]">{r.cycle}</span> : <span className="text-zinc-600">—</span>}</td>
                        <td className="px-3 py-2.5 text-right text-zinc-400">{r.lastDate ? shortDate(r.lastDate) : '—'}</td>
                        <td className={`px-3 py-2.5 text-right ${soon ? 'text-mint-300' : 'text-zinc-400'}`}>{r.nextDate ? shortDate(r.nextDate) : '—'}</td>
                        <td className="py-2.5 pl-3 text-right text-zinc-300">{krw(r.totalKRW)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {a.assets.length > limit && (
              <button type="button" onClick={() => setLimit((l) => l + 30)} className="mt-3 text-xs text-mint-300 hover:underline">
                {a.assets.length - limit}종목 더 보기
              </button>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* 계좌별 */}
            <Card title="계좌별 배당" sub={`최근 ${months}개월`} icon={IconPie}>
              <div className="space-y-3">
                {a.byAccount.map((r, i) => (
                  <ShareBar
                    key={r.account.id}
                    label={
                      <span className="flex items-center gap-2">
                        <BrokerLogo broker={r.account.broker} className="h-5 w-12 shrink-0" />
                        <span className="truncate">{r.account.name}</span>
                      </span>
                    }
                    value={r.periodKRW}
                    total={a.periodKRW}
                    color={tc.palette[i % tc.palette.length]}
                    extra={<p className="num mt-1 text-[11px] text-zinc-500">누적 {krw(r.totalKRW)}</p>}
                  />
                ))}
              </div>
            </Card>

            {/* 국내·해외 */}
            <Card title="국내 · 해외 배당" sub={`최근 ${months}개월 · 종목 기준`} icon={IconChart}>
              {marketTotal <= 0 ? (
                <p className="py-6 text-center text-xs text-zinc-500">이 기간에 받은 배당이 없습니다.</p>
              ) : (
                <div className="space-y-4">
                  <ShareBar label="국내 주식" value={a.byMarket.domestic} total={marketTotal} color={tc.palette[1]} />
                  <ShareBar label="해외 주식" value={a.byMarket.overseas} total={marketTotal} color={tc.accent} />
                </div>
              )}
            </Card>
          </div>

          {/* 세금: 세금을 적은 기록이 있을 때만 */}
          {a.taxKRW > 0 && (
            <Card title="세금" sub="세금을 따로 적어 둔 예전 기록 기준" icon={IconReceipt}>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="label-mono">세전 합계</p>
                  <p className="num mt-0.5 text-lg font-light text-white">{krw(a.grossKRW)}</p>
                </div>
                <div>
                  <p className="label-mono">세금</p>
                  <p className="num mt-0.5 text-lg font-light text-rose-300">{krw(a.taxKRW)}</p>
                </div>
                <div>
                  <p className="label-mono">세율</p>
                  <p className="num mt-0.5 text-lg font-light text-white">{a.grossKRW > 0 ? ((a.taxKRW / a.grossKRW) * 100).toFixed(1) : '0.0'}%</p>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
