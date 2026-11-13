import { useState } from 'react';
import { PageActions } from '../components/shell/PageSlots';
import DividendAnalysis from '../components/dividends/DividendAnalysis';
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
      <DividendAnalysis accountId={f.account} marketType={f.market} liquidity={f.liquidity} months={f.period} />
      <div className="mt-6">
        <DividendChart accountId={f.account || undefined} months={f.period} />
      </div>
    </>
  );
}

// 배당 분석: 받은 배당 분석(최근 12개월·예상·성장·종목별·계좌별) + 월별 배당 차트 + '연간 현황'
export default function DividendAnalysisPage() {
  const [tab, setTab] = useState<Tab>(() => (currentHashId() === 'yearly' ? 'yearly' : 'stats'));
  return (
    <div>
      <PageActions lead={<SubTabs tabs={TABS} value={tab} onChange={setTab} />} />
      {tab === 'stats' ? <Stats /> : <DividendYearlyOverview />}
    </div>
  );
}
