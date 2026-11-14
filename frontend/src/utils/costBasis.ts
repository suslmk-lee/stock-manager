/**
 * 그날의 보유 원가 (수량 × 그때 평단) — 지금 보유에서 거래를 거꾸로 되돌려 구한다.
 * 매수를 되돌리면 평단이 그 매수 전으로 돌아가고, 매도는 평단을 바꾸지 않는다.
 * 전부 판 뒤라 지금 평단을 모르면 그 매도의 실현손익에 남은 매수 평단을 쓴다.
 * 배당률을 '그때 들고 있던 원금' 대비로 셀 때 쓴다 (중간에 사고판 것까지 반영).
 */

export interface CostTx {
  id: number;
  type: 'Buy' | 'Sell';
  date: string; // ISO
  price: number;
  quantity: number;
}

export interface CostState {
  qty: number;
  avg: number;
}

const EPS = 1e-9;

/** 한 종목의 날짜별 보유 (수량·평단). sellAvg: 매도 거래 id → 그때 매수 평단 (실현손익 기록) */
export function costTimeline(nowQty: number, nowAvg: number, txs: CostTx[], sellAvg: Map<number, number> = new Map()) {
  const sorted = [...txs].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id - b.id);
  // after[i]: i번째 거래 뒤의 보유 (다음 거래 전까지)
  const after: CostState[] = new Array(sorted.length);
  let cur: CostState = { qty: Math.max(0, nowQty), avg: nowAvg > 0 ? nowAvg : 0 };
  for (let i = sorted.length - 1; i >= 0; i--) {
    const t = sorted[i];
    after[i] = cur;
    if (t.type === 'Buy') {
      const q = cur.qty - t.quantity;
      if (q <= EPS) {
        cur = { qty: 0, avg: 0 };
      } else {
        const avg = (cur.qty * cur.avg - t.quantity * t.price) / q;
        cur = { qty: q, avg: avg > 0 ? avg : cur.avg }; // 기록이 어긋나 음수면 지금 평단으로
      }
    } else {
      const avg = cur.qty > EPS && cur.avg > 0 ? cur.avg : sellAvg.get(t.id) ?? (cur.avg > 0 ? cur.avg : t.price);
      cur = { qty: cur.qty + t.quantity, avg };
    }
  }
  const opening = cur; // 첫 거래 전 (거래 없이 보유만 넣은 종목은 지금 그대로)
  const times = sorted.map((t) => Date.parse(t.date));

  /** at: 그 시각까지의 거래를 반영한 보유 */
  return (atMs: number): CostState => {
    let lo = 0;
    let hi = times.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= atMs) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return idx < 0 ? opening : after[idx];
  };
}

/** 배당 지급일 며칠 전의 보유로 원금을 본다 (배당락·기준일은 지급일보다 며칠 앞) */
export const DIVIDEND_LOOKBACK_DAYS = 3;

/** 지급일 기준으로 원금을 볼 시각 (그날 끝까지의 거래 포함) */
export function costAtFor(payDate: string): number {
  const d = new Date(payDate);
  d.setDate(d.getDate() - DIVIDEND_LOOKBACK_DAYS);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
