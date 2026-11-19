import { useState } from 'react';
import type { PriceZoneRow } from '../../types/models';
import { fmtCcy } from '../../utils/fx';
import { ZONE_LEVEL, pickTitle } from './TodayCard';

/** 지금 사기 좋은 가격대(3년 종가 하위 20% 이하)에 있는 보유 종목 — 가격 매력 높은 순, 누르면 신호 상세 */

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

export function zoneTestText(z: PriceZoneRow): { text: string; cls: string } {
  if (z.verdict === 'works') return { text: `이만큼 쌌을 때 1년 뒤 ${fmtPct(z.cheap_avg)} (평소 ${fmtPct(z.all_avg)})`, cls: 'text-zinc-300' };
  if (z.verdict === 'trap') return { text: `싸게 사도 1년 뒤 ${fmtPct(z.cheap_avg)} (평소 ${fmtPct(z.all_avg)})`, cls: 'text-amber-300' };
  return { text: '비교할 과거 사례가 적어요', cls: 'text-zinc-500' };
}

export default function ZoneList({ rows, picked, onOpen }: { rows: PriceZoneRow[]; picked: Set<number>; onOpen: (assetId: number) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <div className="divide-y divide-white/[0.05]">
      {shown.map((z) => {
        const t = pickTitle(z);
        const test = zoneTestText(z);
        const lv = ZONE_LEVEL[z.level];
        return (
          <button key={z.asset_id} type="button" onClick={() => onOpen(z.asset_id)} className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]">
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold text-white">
                <span className="truncate">{t.primary}</span>
                {picked.has(z.asset_id) && <span className="shrink-0 rounded border border-mint-400/40 px-1 text-[10px] font-medium text-mint-300">Top 3</span>}
                {z.falling && <span className="shrink-0 rounded border border-amber-300/40 px-1 text-[10px] font-medium text-amber-300">내려가는 중</span>}
              </p>
              <p className={`truncate text-[11.5px] ${test.cls}`}>{test.text}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-[13.5px] font-semibold text-white">{fmtCcy(z.price, z.currency)}</p>
              <p className="num text-[11px] text-zinc-400">
                좋은 가격 {fmtCcy(z.good, z.currency)} · 1년 하위 {Math.round(z.pos_1y)}%
              </p>
            </div>
            <span className={`badge hidden shrink-0 !py-0 !text-[11px] sm:inline-flex ${lv.badge}`}>{lv.label}</span>
          </button>
        );
      })}
      {rows.length > 8 && (
        <div className="pt-2">
          <button type="button" className="text-[12.5px] text-zinc-400 hover:text-white hover:underline" onClick={() => setAll((v) => !v)}>
            {all ? '접기' : `모두 보기 (${rows.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
