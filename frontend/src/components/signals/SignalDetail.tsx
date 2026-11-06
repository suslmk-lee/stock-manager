import type { SignalItem, SignalProfile, SignalRule } from '../../types/models';
import SignalHistory from '../alerts/SignalHistory';
import ProfileChip from './ProfileChip';
import PriceChart from './PriceChart';
import SignalRuleEditor from './SignalRuleEditor';
import { ACTION_META, SignalCard, actionLabelOf } from './SignalCard';

export type DetailTab = 'overview' | 'rule' | 'history';

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: '개요' },
  { id: 'rule', label: '규칙' },
  { id: 'history', label: '이력' },
];

interface SignalDetailProps {
  item: SignalItem;
  rule?: SignalRule;
  assetRule: SignalRule | null;
  profiles: SignalProfile[] | null;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  /** 규칙을 저장했을 때 (신호를 다시 계산해 불러온다) */
  onRuleSaved: () => void;
}

/** 매매 신호 상세 패널: 개요(가격 차트 + 카드 본문) · 규칙(종목별 전략 편집) · 이력 */
export default function SignalDetail({ item, rule, assetRule, profiles, tab, onTab, onRuleSaved }: SignalDetailProps) {
  const meta = ACTION_META[item.action];
  const accountCount = item.accounts.length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight text-white">{item.name}</h2>
          <p className="label-mono mt-1">
            {item.ticker} · {item.currency} · 계좌 {accountCount}개
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {item.rule_source === 'asset' && <span className="badge border border-sky-400/25 bg-sky-400/10 text-sky-200">개별 전략</span>}
          {item.profile_name && <ProfileChip name={item.profile_name} kind={item.profile_kind} />}
          <span className={`badge ${meta.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {actionLabelOf(item)}
          </span>
        </div>
      </header>

      <nav className="flex gap-5 border-b border-white/[0.07]" role="tablist" aria-label="상세 보기">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTab(t.id)}
              className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors ${active ? 'border-mint-400 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'overview' && (
        <div className="flex flex-col gap-4" role="tabpanel">
          {item.action !== 'NO_PRICE' && <PriceChart ticker={item.ticker} currency={item.currency} avgPrice={item.avg_price} />}
          <SignalCard item={item} rule={rule} variant="detail" onEdit={() => onTab('rule')} />
        </div>
      )}

      {tab === 'rule' && (
        <div role="tabpanel">
          {profiles ? (
            <SignalRuleEditor
              key={item.asset_id}
              inline
              assetId={item.asset_id}
              assetName={`${item.name} (${item.ticker})`}
              profiles={profiles}
              currentProfileId={item.profile_id}
              assetRule={assetRule}
              onClose={() => onTab('overview')}
              onSaved={onRuleSaved}
            />
          ) : (
            <p className="py-10 text-center text-sm text-zinc-400">전략 프로필을 불러오지 못해 규칙을 편집할 수 없습니다.</p>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div role="tabpanel">
          <SignalHistory assetId={item.asset_id} embedded />
        </div>
      )}
    </div>
  );
}
