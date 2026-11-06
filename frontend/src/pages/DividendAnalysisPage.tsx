import { useState } from 'react';
import { PageActions } from '../components/shell/PageSlots';
import DividendStatistics from '../components/DividendStatistics';
import DividendChart from '../components/DividendChart';
import DividendYearlyOverview from '../components/DividendYearlyOverview';
import { currentHashId } from '../navigation';
import { SubTabs, useAnalysisFilters } from './analysis/useAnalysisFilters';

type Tab = 'stats' | 'yearly';
const TABS: { id: Tab; label: string }[] = [
  { id: 'stats', label: '통계' },
  { id: 'yearly', label: '연간 현황' },
];

function Stats() {
  const f = useAnalysisFilters();
  return (
    <>
      <PageActions>{f.controls}</PageActions>
      {f.panel}
      <DividendStatistics accountId={f.account} marketType={f.market} liquidity={f.liquidity} months={f.period} />
      <div className="mt-6">
        <DividendChart accountId={f.account || undefined} months={f.period} />
      </div>
    </>
  );
}

// 배당 분석: 예전 '통계'의 배당 부분(배당 통계·월별 배당 차트) + '연간 현황'
export default function DividendAnalysisPage() {
  const [tab, setTab] = useState<Tab>(() => (currentHashId() === 'yearly' ? 'yearly' : 'stats'));
  return (
    <div>
      <PageActions lead={<SubTabs tabs={TABS} value={tab} onChange={setTab} />} />
      {tab === 'stats' ? <Stats /> : <DividendYearlyOverview />}
    </div>
  );
}
