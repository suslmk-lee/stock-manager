import { useState } from 'react';
import { PageActions } from '../components/shell/PageSlots';
import AssetStatistics from '../components/AssetStatistics';
import MonthlyAssetTrend from '../components/MonthlyAssetTrend';
import TotalReturnByAsset from '../components/TotalReturnByAsset';
import AssetDetailView from '../components/AssetDetailView';
import PortfolioSnapshots from '../components/PortfolioSnapshots';
import { currentHashId } from '../navigation';
import { SubTabs, useAnalysisFilters } from './analysis/useAnalysisFilters';

type Tab = 'overview' | 'snapshots';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '개요' },
  { id: 'snapshots', label: '월별 스냅샷' },
];

function Overview() {
  const f = useAnalysisFilters();
  const [detailAsset, setDetailAsset] = useState<{ assetId: number; ticker: string; name: string } | null>(null);
  return (
    <>
      <PageActions>{f.controls}</PageActions>
      {f.panel}
      <AssetStatistics accountId={f.account || undefined} marketType={f.market} liquidity={f.liquidity} />
      <div className="mt-6">
        <MonthlyAssetTrend accountId={f.account || undefined} marketType={f.market} liquidity={f.liquidity} months={f.period} />
      </div>
      <div className="mt-6">
        <TotalReturnByAsset accountId={f.account || undefined} marketType={f.market} liquidity={f.liquidity} onSelectAsset={setDetailAsset} />
      </div>
      {detailAsset && (
        <AssetDetailView
          assetId={detailAsset.assetId}
          ticker={detailAsset.ticker}
          name={detailAsset.name}
          accountId={f.account || undefined}
          accountName={f.accounts.find((a) => a.id === f.account)?.name}
          onClose={() => setDetailAsset(null)}
        />
      )}
    </>
  );
}

// 자산 추이: 예전 '통계'의 자산 부분(총자산·월별 추이·종목별 실질 손익) + '포트폴리오' 월별 스냅샷
export default function AssetTrendPage() {
  const [tab, setTab] = useState<Tab>(() => (currentHashId() === 'portfolio' ? 'snapshots' : 'overview'));
  return (
    <div>
      <PageActions lead={<SubTabs tabs={TABS} value={tab} onChange={setTab} />} />
      {tab === 'overview' ? <Overview /> : <PortfolioSnapshots />}
    </div>
  );
}
