import { useEffect, useState } from 'react';
import { Filter } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { Account } from '../../types/models';
import { LiquidityFilter, matchesLiquidity } from '../../utils/accountType';

const LIQUIDITY_OPTIONS: { value: LiquidityFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'liquid', label: '인출 가능' },
  { value: 'restricted', label: '인출 제한' },
];

/**
 * 자산 추이·배당 분석 페이지가 함께 쓰는 필터 (계좌 유형, 기간, 계좌, 시장).
 * controls 는 상단 바 오른쪽에, panel 은 본문 맨 위에 넣는다.
 */
export function useAnalysisFilters() {
  const [period, setPeriod] = useState(12);
  const [account, setAccount] = useState<number>(0);
  const [market, setMarket] = useState<string>('all');
  const [liquidity, setLiquidity] = useState<LiquidityFilter>('all');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    apiClient
      .GetAllAccounts()
      .then((data) => setAccounts(data as Account[]))
      .catch((err) => console.error('Failed to load accounts:', err));
  }, []);

  const changeLiquidity = (value: LiquidityFilter) => {
    setLiquidity(value);
    setAccount(0);
  };

  const filteredAccounts = accounts.filter(
    (acc) =>
      matchesLiquidity(acc, liquidity) &&
      (market === 'all' || (market === 'domestic' ? acc.market_type === 'Domestic' : acc.market_type === 'International')),
  );

  const controls = (
    <>
      <div className="glass-pill flex p-1" role="group" aria-label="계좌 유형">
        {LIQUIDITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => changeLiquidity(opt.value)}
            className={`pill-item ${liquidity === opt.value ? (opt.value === 'restricted' ? 'pill-item-active !text-amber-300' : 'pill-item-active !text-mint-300') : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="glass-pill flex p-1" role="group" aria-label="기간">
        {[6, 12, 24, 36].map((months) => (
          <button key={months} onClick={() => setPeriod(months)} className={`pill-item font-mono !text-xs ${period === months ? 'pill-item-active' : ''}`}>
            {months}개월
          </button>
        ))}
      </div>
      <button onClick={() => setShowPanel(!showPanel)} className={`btn-ghost ${showPanel ? '!border-mint-400/50 !text-mint-300' : ''}`} aria-expanded={showPanel}>
        <Filter className="w-4 h-4" />
        필터
      </button>
    </>
  );

  const panel = showPanel ? (
    <div className="surface p-5 sm:p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="field-label">계좌</label>
          <select value={account} onChange={(e) => setAccount(Number(e.target.value))} className="input-field">
            <option value={0}>전체 계좌</option>
            {filteredAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.broker})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">시장 구분</label>
          <select
            value={market}
            onChange={(e) => {
              setMarket(e.target.value);
              setAccount(0);
            }}
            className="input-field"
          >
            <option value="all">전체</option>
            <option value="domestic">국내</option>
            <option value="international">해외</option>
          </select>
        </div>
        <div>
          <label className="field-label">계좌 유형</label>
          <select value={liquidity} onChange={(e) => changeLiquidity(e.target.value as LiquidityFilter)} className="input-field">
            {LIQUIDITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  ) : null;

  return { period, account, market, liquidity, accounts, controls, panel };
}

/** 페이지 하위 탭 (상단 바 제목 옆) */
export function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="glass-pill flex p-1" role="tablist" aria-label="보기">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={`pill-item !text-xs ${value === t.id ? 'pill-item-active' : ''}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
