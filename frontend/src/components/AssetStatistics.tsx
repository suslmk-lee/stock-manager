import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Asset, Account } from '../types/models';
import { Wallet, Globe, Home, ChevronDown, ChevronUp, LineChart } from 'lucide-react';
import TotalAssetTrendModal from './TotalAssetTrendModal';
import { LiquidityFilter, matchesLiquidity, isRestrictedAccount, getAccountTypeMeta } from '../utils/accountType';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import CountUp from './CountUp';
import CardIcon from './ui/CardIcon';
import RingGauge from './ui/RingGauge';
import Chip from './ui/Chip';
import { useThemeColors } from '../appearance/AppearanceContext';
import { IconTrend, IconWallet } from './ui/appIcons';

const TOP_N = 5; // 기본 축소보기에서 노출할 계좌 수

interface AssetStatisticsProps {
  accountId?: number;
  marketType?: string;
  liquidity?: LiquidityFilter;
}

interface AssetValue {
  ticker: string;
  name: string;
  quantity: number;
  currentPrice: number;
  value: number;
  accountId: number;
  accountName: string;
  marketType: string;
}

export default function AssetStatistics({ accountId, marketType = 'all', liquidity = 'all' }: AssetStatisticsProps) {
  const tc = useThemeColors();
  const PALETTE = tc.palette;
  const OTHER_COLOR = tc.axis;
  const [loading, setLoading] = useState(true);
  const [showTrend, setShowTrend] = useState(false);
  const [totalValue, setTotalValue] = useState(0);
  const [accountValues, setAccountValues] = useState<Map<number, number>>(new Map());
  const [domesticValue, setDomesticValue] = useState(0);
  const [internationalValue, setInternationalValue] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [liquidValue, setLiquidValue] = useState(0);
  const [restrictedValue, setRestrictedValue] = useState(0);
  const [stockValue, setStockValue] = useState(0);
  const [cashValue, setCashValue] = useState(0);


  useEffect(() => {
    loadAssetValues();
  }, [accountId, marketType, liquidity]);

  const loadAssetValues = async () => {
    try {
      setLoading(true);
      const [assetsData, accountsData, rate, cashData] = await Promise.all([
        apiClient.GetAllAssets(),
        apiClient.GetAllAccounts(),
        apiClient.GetUSDToKRW(),
        apiClient.GetCashBalances().catch(() => null),
      ]);

      const assets = assetsData as Asset[];
      const accountsList = accountsData as Account[];
      setAccounts(accountsList);
      const exchangeRate = rate as number;

      const assetValues: AssetValue[] = [];

      // 보유가 있는 자산의 티커를 모아 일괄 시세 조회 (동시 5개 제한 + 5분 캐시)
      const assetsWithHoldings = assets.filter((a) => a.holdings && a.holdings.length > 0);
      const tickers = Array.from(new Set(assetsWithHoldings.map((a) => a.ticker).filter(Boolean)));
      const batchPrices = tickers.length > 0
        ? (await apiClient.GetCurrentPrices(tickers)) as Record<string, any>
        : {};

      const priceInKRWOf = (ticker: string) => {
        const pd = batchPrices[ticker.toUpperCase()] || batchPrices[ticker];
        const price = Number(pd?.price || 0);
        const currency = String(pd?.currency || '');
        return currency === 'USD' ? price * exchangeRate : price;
      };

      for (const asset of assetsWithHoldings) {
        const priceInKRW = priceInKRWOf(asset.ticker);

        for (const holding of asset.holdings!) {
          const account = accountsList.find(acc => acc.id === holding.account_id);
          if (!account) continue;

          // 필터 적용
          if (accountId && holding.account_id !== accountId) continue;
          if (marketType === 'domestic' && account.market_type !== 'Domestic') continue;
          if (marketType === 'international' && account.market_type !== 'International') continue;

          if (!matchesLiquidity(account, liquidity)) continue;

          assetValues.push({
            ticker: asset.ticker,
            name: asset.name,
            quantity: holding.quantity,
            currentPrice: priceInKRW,
            value: priceInKRW * holding.quantity,
            accountId: holding.account_id,
            accountName: account.name,
            marketType: account.market_type,
          });
        }
      }

      // 예수금: 계좌마다 원화 + 달러(현재 환율). 필터는 주식과 같게 적용
      const usdKrw = (cashData?.usd_krw || (rate as number)) || 0;
      const cashByAccount = new Map<number, number>();
      for (const b of cashData?.balances ?? []) {
        const account = accountsList.find((acc) => acc.id === b.account_id);
        if (!account) continue;
        if (accountId && b.account_id !== accountId) continue;
        if (marketType === 'domestic' && account.market_type !== 'Domestic') continue;
        if (marketType === 'international' && account.market_type !== 'International') continue;
        if (!matchesLiquidity(account, liquidity)) continue;
        const v = b.krw + b.usd * usdKrw;
        if (v !== 0) cashByAccount.set(b.account_id, v);
      }
      const cashTotal = Array.from(cashByAccount.values()).reduce((s, v) => s + v, 0);

      // 총 자산 계산 (주식 평가금 + 예수금)
      const stockTotal = assetValues.reduce((sum, av) => sum + av.value, 0);
      setStockValue(stockTotal);
      setCashValue(cashTotal);
      setTotalValue(stockTotal + cashTotal);

      // 계좌별 자산 계산
      const accountValuesMap = new Map<number, number>();
      assetValues.forEach(av => {
        const current = accountValuesMap.get(av.accountId) || 0;
        accountValuesMap.set(av.accountId, current + av.value);
      });
      cashByAccount.forEach((v, id) => accountValuesMap.set(id, (accountValuesMap.get(id) || 0) + v));
      setAccountValues(accountValuesMap);

      // 국내/해외별 자산 계산 (예수금은 계좌의 시장 구분을 따른다)
      const cashOf = (pred: (a: Account | undefined) => boolean) =>
        Array.from(cashByAccount.entries()).filter(([id]) => pred(accountsList.find((a) => a.id === id))).reduce((s, [, v]) => s + v, 0);
      const domestic = assetValues
        .filter(av => av.marketType === 'Domestic')
        .reduce((sum, av) => sum + av.value, 0) + cashOf((a) => a?.market_type === 'Domestic');
      const international = assetValues
        .filter(av => av.marketType === 'International')
        .reduce((sum, av) => sum + av.value, 0) + cashOf((a) => a?.market_type === 'International');

      // 인출 가능/제한별 자산 계산
      let liquid = cashOf((a) => !isRestrictedAccount(a));
      let restricted = cashOf((a) => isRestrictedAccount(a));
      assetValues.forEach(av => {
        const acc = accountsList.find(a => a.id === av.accountId);
        if (isRestrictedAccount(acc)) restricted += av.value;
        else liquid += av.value;
      });
      setLiquidValue(liquid);
      setRestrictedValue(restricted);

      setDomesticValue(domestic);
      setInternationalValue(international);

    } catch (err) {
      console.error('Failed to load asset values:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* 총 자산 스켈레톤 */}
        <div className="hero-grain p-6 sm:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="h-3 w-24 rounded bg-white/10" />
              <div className="h-12 w-72 max-w-full rounded-lg bg-white/10" />
              <div className="h-3 w-40 rounded bg-white/10" />
            </div>
            <div className="surface-inset h-44" />
          </div>
        </div>

        {/* 계좌별 분포 스켈레톤 */}
        <div className="surface p-6">
          <div className="h-4 w-40 rounded bg-white/10 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex items-center justify-center h-64">
              <div className="w-44 h-44 rounded-full border-[14px] border-white/[0.06]" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: TOP_N }).map((_, i) => (
                <div key={i} className="surface-inset flex items-center gap-3 p-3">
                  <div className="w-3 h-3 rounded-full bg-white/10" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-28 rounded bg-white/10" />
                    <div className="h-2.5 w-16 rounded bg-white/10" />
                  </div>
                  <div className="space-y-2 text-right">
                    <div className="h-3 w-20 rounded bg-white/10 ml-auto" />
                    <div className="h-2.5 w-10 rounded bg-white/10 ml-auto" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 계좌별 자산을 금액 내림차순으로 정렬
  const sortedEntries = Array.from(accountValues.entries())
    .map(([accId, value]) => ({ accId, value }))
    .sort((a, b) => b.value - a.value);

  // 기본 축소보기: 상위 N개 + "기타" 묶음 (펼치면 전체)
  const canCollapse = sortedEntries.length > TOP_N + 1;
  const collapsed = !expanded && canCollapse;
  const topEntries = collapsed ? sortedEntries.slice(0, TOP_N) : sortedEntries;
  const restEntries = collapsed ? sortedEntries.slice(TOP_N) : [];
  const restValue = restEntries.reduce((sum, e) => sum + e.value, 0);

  // 파이/리스트 공통 데이터
  const pieData = [
    ...topEntries.map((e, i) => {
      const account = accounts.find((acc) => acc.id === e.accId);
      return {
        name: account?.name || '알 수 없음',
        value: e.value,
        color: PALETTE[i % PALETTE.length],
      };
    }),
    ...(restEntries.length > 0
      ? [{ name: `기타 ${restEntries.length}개`, value: restValue, color: OTHER_COLOR }]
      : []),
  ];

  const pct = (v: number) => (totalValue > 0 ? (v / totalValue) * 100 : 0);
  const countAccounts = (restricted: boolean) =>
    Array.from(accountValues.keys()).filter(id => isRestrictedAccount(accounts.find(a => a.id === id)) === restricted).length;


  const showSplit = liquidity === 'all';
  const marketStats = marketType === 'all'
    ? [
        { key: 'dom', label: '국내', icon: Home, value: pct(domesticValue).toFixed(1), unit: '%', sub: domesticValue },
        { key: 'intl', label: '해외', icon: Globe, value: pct(internationalValue).toFixed(1), unit: '%', sub: internationalValue },
      ]
    : [];
  const statColumns = [
    ...marketStats,
    { key: 'acc', label: '계좌 수', icon: Wallet, value: String(accountValues.size), unit: '개', sub: null as number | null },
  ];

  return (
    <div className="space-y-6">
      {showTrend && <TotalAssetTrendModal onClose={() => setShowTrend(false)} />}
      {/* 총 자산 히어로 */}
      <div className="hero-grain p-6 sm:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-8 items-center">
          <div>
            <div className="flex items-center gap-2.5 mb-5">
              <CardIcon icon={IconTrend} tone="mint" size="sm" />
              <span className="label-mono !text-zinc-400">총 자산 평가액</span>
              <button onClick={() => setShowTrend(true)} className="btn-ghost !py-1 !px-2.5 !text-xs ml-1" title="총자산 추이 보기">
                <LineChart className="w-3.5 h-3.5" />
                추이 보기
              </button>
            </div>
            <p
              className="num text-4xl sm:text-5xl font-light tracking-tight text-white break-all cursor-pointer"
              title="총자산 추이 보기"
              onClick={() => setShowTrend(true)}
            >
              <CountUp value={totalValue} format={formatCurrency} />
            </p>
            {cashValue !== 0 && (
              <p className="mt-2 text-sm text-zinc-400 num">
                주식 <CountUp value={stockValue} format={formatCurrency} /> · 예수금 <CountUp value={cashValue} format={formatCurrency} />
              </p>
            )}
            {restrictedValue > 0 && liquidity === 'all' && (
              <p className="mt-3 text-sm text-mint-300 num">
                즉시 인출 가능 <CountUp value={liquidValue} format={formatCurrency} />
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <Chip check>{accountValues.size}개 계좌</Chip>
              {showSplit && <Chip check>인출 가능 {countAccounts(false)}개</Chip>}
              {showSplit && restrictedValue > 0 && <Chip check>인출 제한 {countAccounts(true)}개</Chip>}
            </div>
          </div>

          <div className="surface-inset p-5 sm:p-6">
            {showSplit && (
              <div className="flex items-start justify-around gap-4 mb-6">
                <RingGauge
                  size={104}
                  value={pct(liquidValue)}
                  color="rgb(var(--c-mint-400))"
                  label={
                    <>
                      <span className="block">인출 가능</span>
                      <span className="block text-zinc-400 num mt-0.5"><CountUp value={liquidValue} format={formatCurrency} /></span>
                    </>
                  }
                >
                  <span className="text-2xl font-light">{Math.round(pct(liquidValue))}<span className="text-sm">%</span></span>
                </RingGauge>
                <RingGauge
                  size={104}
                  value={pct(restrictedValue)}
                  color="rgb(var(--c-amber-400))"
                  label={
                    <>
                      <span className="block">인출 제한</span>
                      <span className="block text-zinc-400 num mt-0.5"><CountUp value={restrictedValue} format={formatCurrency} /></span>
                    </>
                  }
                >
                  <span className="text-2xl font-light">{Math.round(pct(restrictedValue))}<span className="text-sm">%</span></span>
                </RingGauge>
              </div>
            )}
            <div className={`flex items-stretch justify-between gap-2 ${showSplit ? 'border-t border-white/[0.06] pt-5' : ''}`}>
              {statColumns.map((c, i) => (
                <div key={c.key} className="contents">
                  {i > 0 && <span className="divider-v" />}
                  <div className="flex-1 min-w-0 text-center">
                    <p className="num text-2xl font-light text-mint-300">
                      {c.value}<span className="text-sm ml-0.5">{c.unit}</span>
                    </p>
                    <p className="label-mono mt-1 !text-zinc-400">{c.label}</p>
                    {c.sub !== null && (
                      <p className="label-mono !text-[10px] sm:!text-[11px] mt-0.5 whitespace-nowrap"><CountUp value={c.sub} format={formatCurrency} /></p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 계좌별 자산 */}
      {!accountId && accountValues.size > 0 && (
        <div className="surface p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-5">
            <CardIcon icon={IconWallet} tone="sky" size="sm" />
            <h3 className="section-title">계좌별 자산 분포</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 파이 차트 (라벨/범례 제거 → 우측 리스트로 대체, 높이 축소) */}
            <div className="relative h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={66}
                    outerRadius={98}
                    paddingAngle={2}
                    cornerRadius={4}
                    stroke="none"
                    dataKey="value"
                  >
                    {pieData.map((d, index) => (
                      <Cell key={`cell-${index}`} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${formatCurrency(value)} (${totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : 0}%)`,
                      name,
                    ]}
                    contentStyle={tc.tooltip.contentStyle}
                    itemStyle={tc.tooltip.itemStyle}
                    labelStyle={tc.tooltip.labelStyle}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* 도넛 중앙: 총 자산 / 계좌 수 */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="label-mono">총 자산</p>
                <p className="num text-base font-light text-white mt-0.5"><CountUp value={totalValue} format={formatCurrency} /></p>
                <p className="label-mono mt-0.5">{sortedEntries.length}개 계좌</p>
              </div>
            </div>

            {/* 상세 정보 (축소보기: 상위 N + 기타) */}
            <div className="space-y-2">
              {topEntries.map((e, index) => {
                const account = accounts.find(acc => acc.id === e.accId);
                if (!account) return null;
                const percentage = totalValue > 0 ? (e.value / totalValue) * 100 : 0;
                return (
                  <div key={e.accId} className="surface-inset p-3 flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{account.name}</p>
                        {(() => {
                          const meta = getAccountTypeMeta(account);
                          return meta.value === 'General' ? null : (
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.badgeClass}`}>{meta.short}</span>
                          );
                        })()}
                      </div>
                      <p className="label-mono truncate mt-0.5">{account.broker}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="num text-sm font-medium text-white"><CountUp value={e.value} format={formatCurrency} /></p>
                      <p className="label-mono mt-0.5">{percentage.toFixed(1)}%</p>
                    </div>
                  </div>
                );
              })}

              {restEntries.length > 0 && (
                <div className="surface-inset !bg-none p-3 flex items-center gap-3 opacity-80">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: OTHER_COLOR }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-300">기타 {restEntries.length}개 계좌</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="num text-sm font-medium text-zinc-200"><CountUp value={restValue} format={formatCurrency} /></p>
                    <p className="label-mono mt-0.5">
                      {totalValue > 0 ? ((restValue / totalValue) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                </div>
              )}

              {canCollapse && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="btn-ghost w-full !py-2 !text-xs"
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="w-4 h-4" /> 접기
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" /> 전체 {sortedEntries.length}개 계좌 보기
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
