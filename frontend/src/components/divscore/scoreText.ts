import type { DivScoreMetrics, DivScoreParts, DivScoreWeights, DivStatus } from '../../types/models';
import { ccySymbol, normCcy } from '../../utils/fx';

/** 배당 상태 이름·색 */
export const STATUS_META: Record<DivStatus, { label: string; cls: string; hint: string }> = {
  up: { label: '증가', cls: 'bg-mint-400/15 text-mint-300', hint: '최근 12개월 주당 배당이 1년 전보다 3% 이상 늘었습니다' },
  flat: { label: '유지', cls: 'border border-white/10 bg-white/[0.05] text-zinc-300', hint: '1년 전과 ±3% 안' },
  down: { label: '감소', cls: 'bg-rose-500/15 text-rose-300', hint: '1년 전보다 3% 넘게 줄었습니다' },
  missed: { label: '누락', cls: 'bg-amber-500/15 text-amber-300', hint: '지급 주기상 나왔어야 할 배당이 아직 없습니다 (중단·지연 의심)' },
  new: { label: '신규', cls: 'bg-sky-500/15 text-sky-300', hint: '배당 이력이 2년이 안 되어 증감을 아직 판단하지 않습니다' },
};

export type PartKey = keyof DivScoreParts;
export const PART_KEYS: PartKey[] = ['growth', 'stability', 'yield', 'consistency', 'price_growth', 'value'];
export const PART_LABEL: Record<PartKey, string> = {
  growth: '배당 성장',
  stability: '배당 안정성',
  yield: '지금 수익률 매력',
  consistency: '지급 꾸준함',
  price_growth: '주가 성장',
  value: '가격·가치',
};
/** 정렬 칩 등 좁은 곳의 짧은 이름 */
export const PART_SHORT: Record<PartKey, string> = {
  growth: '성장',
  stability: '안정성',
  yield: '수익률',
  consistency: '꾸준함',
  price_growth: '주가',
  value: '가격',
};
export const PART_HELP: Record<PartKey, string> = {
  growth: '3년 연평균 증가율 60% + 최근 1년 증가율 40% · 배당수익률이 2% 아래면 줄인다 (작은 배당의 큰 증가율 보정)',
  stability: '삭감 없이 이어진 해 50% + 최근 3년 삭감 30% + 회차별 금액 변동 20%',
  yield:
    '(지금 배당수익률 70% + 최근 2년 평균 대비 30%) × 주가 보전 — 평균보다 높으면 싼 편이지만 하락 추세이거나 1년 새 배당이 30% 넘게 바뀐 해는 가산 없음. 최근 1년 주가 하락이 받은 배당을 깎아 먹은 만큼 줄인다 (다 깎아 먹으면 절반)',
  consistency: '지급 주기(월·분기…) 50% + 최근 3년 빠진 회차 50%, 이번 회차가 늦으면 절반',
  price_growth: '주가만(배당 제외) 최근 3년 — 연평균 상승률 40% + 최근 1년 변화 20% + 1년 전보다 올라 있던 달의 비율 25% + 최대 낙폭 15% · 꾸준히 오른 종목이 높다 (시세 1년 미만이면 중간 아래)',
  value: '52주 범위에서의 위치 60% (낮을수록 싸다) + 200일선 추세 40% (아래면 하락 추세로 낮게, 조금 위가 가장 높고, 너무 위면 과열) · 하락 추세면 52주 저점 근처여도 \'싸다\'는 중간까지만',
};

export const DEFAULT_WEIGHTS: DivScoreWeights = { growth: 25, stability: 20, yield: 20, consistency: 10, price_growth: 15, value: 10 };

const signedPct = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;
export const pct = (v: number | undefined, d = 1) => (v == null ? '—' : `${v.toFixed(d)}%`);
export { signedPct };

/** 항목별 근거 문장 */
export function partReason(key: PartKey, m: DivScoreMetrics): string {
  switch (key) {
    case 'growth':
      if (m.growth_1y == null) return `배당 이력 ${m.history_years}년 — 2년이 안 되어 중간 아래 점수`;
      return [m.cagr_3y != null ? `3년 연평균 ${signedPct(m.cagr_3y)}` : '3년 이력 부족', `최근 1년 ${signedPct(m.growth_1y)}`].join(' · ');
    case 'stability':
      return [
        `삭감 없이 ${m.no_cut_years}년${m.no_cut_years >= 4 ? ' 이상' : ''}`,
        `최근 3년 삭감 ${m.cuts_3y}회`,
        m.cv != null ? `회차별 변동 ${(m.cv * 100).toFixed(0)}%` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'yield': {
      // 1년 주가 변화와 그 하락이 받은 배당을 얼마나 깎았는지 (주가 보전)
      let price = '';
      if (m.price_chg_1y != null) {
        const eaten = m.div_eaten ?? 0;
        price = `1년 주가 ${signedPct(m.price_chg_1y)}${eaten >= 1 ? ' (받은 배당보다 더 빠짐)' : eaten >= 0.05 ? ` (받은 배당의 ${Math.round(eaten * 100)}%를 깎음)` : ''}`;
      }
      return [`지금 ${pct(m.yield_pct, 2)}`, m.avg_yield_pct != null ? `2년 평균 ${pct(m.avg_yield_pct, 2)}` : '2년 평균 없음', price].filter(Boolean).join(' · ');
    }
    case 'consistency':
      return [`${m.cycle ? `${m.cycle} 지급` : '최근 12개월 지급 없음'}`, `최근 3년 빠진 회차 ${m.missed_3y}`, m.missed_now ? '이번 회차 늦음' : ''].filter(Boolean).join(' · ');
    case 'price_growth':
      if (m.price_cagr_3y == null) return '주가 이력이 1년이 안 되어 중간 아래 점수';
      return [
        `${m.price_years != null && m.price_years < 2.95 ? `${m.price_years}년` : '3년'} 연평균 ${signedPct(m.price_cagr_3y)}`,
        m.price_chg_1y != null ? `최근 1년 ${signedPct(m.price_chg_1y)}` : '',
        m.up_months != null ? `1년 전보다 오른 달 ${Math.round(m.up_months * 100)}%` : '',
        m.max_drawdown != null ? `최대 낙폭 ${signedPct(m.max_drawdown)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'value':
      return [
        m.pos_52 != null ? `52주 범위 ${(m.pos_52 * 100).toFixed(0)}% 위치` : '52주 범위 없음',
        m.ma_gap_pct != null ? `200일선 ${signedPct(m.ma_gap_pct)}` : '',
        m.downtrend ? '하락 추세' : m.ma_gap_pct != null && m.ma_gap_pct > 15 ? '과열' : '',
      ]
        .filter(Boolean)
        .join(' · ');
  }
}

/** 항목 점수를 지금 배점의 점수로 (예: 24.1 / 30) */
export function partPoints(key: PartKey, parts: DivScoreParts, w: DivScoreWeights) {
  const total = PART_KEYS.reduce((s, k) => s + (w[k] || 0), 0) || 1;
  const max = ((w[key] || 0) / total) * 100;
  return { got: parts[key] * max, max };
}

export const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
export const shortMonth = (m: string) => `${m.slice(2, 4)}.${m.slice(5, 7)}`;

/** 주당 배당 금액 (종목 통화) */
/** 주당 배당 (₩375 · $0.2650 · ¥8.5) */
export const dps = (v: number, ccy: string) => {
  const c = normCcy(ccy);
  if (c === 'KRW') return `₩${Math.round(v).toLocaleString('ko-KR')}`;
  if (c === 'USD' || !c) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return `${ccySymbol(c)}${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
};
