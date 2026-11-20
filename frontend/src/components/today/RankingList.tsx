import { useState } from 'react';
import type { TodayRow } from '../../types/models';
import { fmtCcy } from '../../utils/fx';
import { ZONE_LEVEL, pickTitle } from './TodayCard';

/**
 * 보유 종목 순위 — 위 Top 3 와 같은 오늘 점수. Top 3 에서 뺀 종목은 이유를 보여 준다. 누르면 신호 상세.
 * 계좌별로 볼 때(accountId)는 그 계좌의 순위·Top 3 와 함께 그 계좌에 담긴 수량, 전체 계좌 기준 순위를 보여 준다.
 */

const EXCLUDED: Record<string, string> = {
  sell: '매도 신호',
  conflict: '신호 충돌',
  no_price: '시세 없음',
  cooldown: '쉬는 기간',
  max_weight: '최대 비중',
  no_rebound: '반등 전',
  bought_today: '오늘 매수',
  planned: '오늘 모으기',
  low_score: '점수 낮음',
};

const SEGS: { key: 'price' | 'signal' | 'dividend' | 'weight'; cls: string }[] = [
  { key: 'price', cls: 'bg-emerald-400' },
  { key: 'signal', cls: 'bg-mint-400' },
  { key: 'dividend', cls: 'bg-amber-300' },
  { key: 'weight', cls: 'bg-sky-400' },
];

/** 계좌별 순위: 그 계좌에 담긴 종목만 같은 점수 순서로, 빠질 이유가 없는 앞의 3개가 그 계좌의 Top 3 */
export function accountRanking(rows: TodayRow[], accountId: number): TodayRow[] {
  let pick = 0;
  return rows
    .filter((r) => r.held?.some((h) => h.account_id === accountId))
    .map((r, i) => ({ ...r, rank: i + 1, global_rank: r.rank, pick: !r.excluded && pick < 3 ? ++pick : undefined }));
}

const qtyText = (q: number, ticker: string) => `${q.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${/^FUND:/i.test(ticker) ? '좌' : '주'}`;

export default function RankingList({ rows, onOpen, accountId }: { rows: TodayRow[]; onOpen: (assetId: number) => void; accountId?: number | null }) {
  const [all, setAll] = useState(false);
  // 처음에는 Top 3 가 나올 때까지 + 몇 줄 (빠진 종목의 이유가 보이게), 최소 10줄
  const lastPick = rows.reduce((m, r, i) => (r.pick ? i : m), -1);
  const shown = all ? rows : rows.slice(0, Math.max(10, lastPick + 3));
  return (
    <div>
      <div className="hidden grid-cols-[2.2rem_minmax(0,1fr)_7.5rem_6.5rem_7rem] gap-3 border-b border-white/[0.06] pb-1.5 text-[11px] text-zinc-500 sm:grid">
        <span className="text-right">순위</span>
        <span>종목</span>
        <span>오늘 점수</span>
        <span className="text-right">과거 기준 기대</span>
        <span className="text-right">상태</span>
      </div>
      <div className="divide-y divide-white/[0.05]">
        {shown.map((r) => {
          const t = pickTitle(r);
          const lv = r.has_zone && r.level ? ZONE_LEVEL[r.level as keyof typeof ZONE_LEVEL] : null;
          const held = accountId ? r.held?.find((h) => h.account_id === accountId) : undefined;
          return (
            <button
              key={r.asset_id}
              type="button"
              onClick={() => onOpen(r.asset_id)}
              className={`grid w-full grid-cols-[2.2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 text-left transition-colors hover:bg-white/[0.03] sm:grid-cols-[2.2rem_minmax(0,1fr)_7.5rem_6.5rem_7rem] ${r.excluded ? 'opacity-70' : ''}`}
            >
              <span className={`num text-right text-[13px] ${r.pick ? 'font-semibold text-white' : 'text-zinc-500'}`}>{r.rank}</span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-semibold text-white">{t.primary}</span>
                  {r.pick ? <span className="shrink-0 rounded border border-mint-400/40 px-1 text-[10px] font-medium text-mint-300">{accountId ? '이 계좌' : 'Top 3'} · {r.pick}위</span> : null}
                </span>
                <span className="num block truncate text-[11px] text-zinc-500">
                  {r.has_zone && r.expect > 0 && <span className="text-emerald-300 sm:hidden">기대 +{r.expect.toFixed(1)}%p · </span>}
                  {r.price_neutral && <span className="sm:hidden">가격 매력 중간값 · </span>}
                  {held ? `보유 ${qtyText(held.qty, r.ticker)}${r.global_rank ? ` · 전체 ${r.global_rank}위` : ''} · ` : ''}
                  {fmtCcy(r.price, r.currency)}
                  {r.has_zone ? ` · 1년 하위 ${Math.round(r.pos_1y)}% · 좋은 가격 ${fmtCcy(r.good, r.currency)}` : ' · 주가 이력 부족'}
                </span>
              </span>
              <span className="flex items-center gap-2 sm:col-auto">
                <span className="num w-8 text-right text-[14px] font-semibold text-white">{Math.round(r.score)}</span>
                <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.08] sm:flex" aria-hidden>
                  {SEGS.map((x) => (
                    <span key={x.key} className={`block h-full ${x.cls}`} style={{ width: `${r.parts[x.key]}%` }} />
                  ))}
                </span>
              </span>
              <span
                className={`num hidden text-right text-[12.5px] sm:block ${r.expect > 0 ? 'text-emerald-300' : 'text-zinc-500'}`}
                title={r.price_neutral ? '싸게 산 사례가 적어(1년 하위 20%였던 날 40일 미만) 가격 매력을 보유 종목 중간값으로 매겼어요' : undefined}
              >
                {r.price_neutral ? '사례 적음' : r.has_zone ? (r.expect > 0 ? `+${r.expect.toFixed(1)}%p` : r.verdict === 'trap' ? '안 통함' : '—') : '—'}
              </span>
              <span className="col-span-2 col-start-2 flex flex-wrap justify-start gap-1 sm:col-span-1 sm:col-start-auto sm:justify-end">
                {r.excluded && <span className="badge !py-0 !text-[10.5px] border border-white/10 bg-white/[0.04] text-zinc-400">{EXCLUDED[r.excluded] ?? r.excluded}</span>}
                {lv && !r.excluded && <span className={`badge !py-0 !text-[10.5px] ${lv.badge}`}>{lv.label}</span>}
                {r.falling && (r.level === 'great' || r.level === 'good') && <span className="badge !py-0 !text-[10.5px] border border-amber-300/40 text-amber-300">내려가는 중</span>}
              </span>
            </button>
          );
        })}
      </div>
      {rows.length > shown.length || all ? (
        <div className="pt-2">
          <button type="button" className="text-[12.5px] text-zinc-400 hover:text-white hover:underline" onClick={() => setAll((v) => !v)}>
            {all ? '접기' : `모두 보기 (${rows.length})`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
