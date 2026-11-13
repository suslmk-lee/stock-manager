/**
 * 배당 회차 패턴 — 회차 목록(최근 3년)에서 연도 × 월 달력, 막대용 추세, 바뀐 점을 만든다.
 *
 * - 같은 달 두 번째 이후 회차는 '같은 달 추가'(예: 1월분을 12월에 앞당겨 주는 월배당)로 따로 표시한다.
 * - 빈 달은 해마다 같으면 그냥 빈칸이고, 다른 온전한 해 둘 이상이 모두 그달에 받았는데 그해만 회차가 줄었을 때만 '빠짐'
 *   (비교할 해가 하나뿐이면 지급 일정이 바뀐 것과 구분이 안 된다).
 * - 바뀐 점은 직전 회차보다 6% 넘게 바뀌고, 1년 전 같은 회차(±45일)와 비교해도 같은 쪽으로 3% 넘게 바뀐 회차
 *   (국내 결산 배당처럼 해마다 크게 나오는 회차나 월마다 출렁이는 분배금이 매번 잡히지 않게).
 * - 같은 달 비교(▲▼)·전년 대비는 비교할 자료가 있을 때만.
 */

export interface Pay {
  date: string; // YYYY-MM-DD
  amount: number;
  special: boolean;
}

export interface PayItem extends Pay {
  y: number;
  m: number;
  extra: boolean; // 같은 달 두 번째 이후
}

export type CellKind = 'paid' | 'none' | 'missed' | 'out' | 'future';

export interface Cell {
  kind: CellKind;
  main?: PayItem; // 그달 첫 회차
  extras: PayItem[];
  vsLastYear?: number; // 작년 같은 달 첫 회차 대비 (%)
  shade: number; // 0~1 (금액이 클수록 진하게)
}

export interface YearRow {
  year: number;
  current: boolean;
  cells: Cell[]; // 1~12월
  total: number;
  count: number;
  yoy?: number; // 전년 대비 (두 해 모두 온전할 때만)
}

export type EventKind = 'up' | 'down' | 'special' | 'extra' | 'missed';
export interface PayEvent {
  kind: EventKind;
  key: string; // 정렬용 날짜 (YYYY-MM-DD)
  date?: string; // 회차 날짜 (빠짐이면 없음)
  y: number;
  m: number;
  amount?: number;
  prev?: number; // 직전 정기 회차 금액
  change?: number; // 직전 대비 %
  yoy?: number; // 1년 전 같은 회차 대비 %
}

export interface PaymentPattern {
  items: PayItem[]; // 오래된 것부터
  ma: (number | null)[]; // 정기 회차 1년 이동평균 (items 와 같은 순서)
  rows: YearRow[]; // 올해부터
  events: PayEvent[]; // 최근 것부터
  min: number;
  max: number;
  avg12: number; // 최근 12개월 정기 회차 평균
}

const CHANGE_BAND = 6; // 직전 정기 회차보다 이만큼(%) 넘게 바뀌면 '바뀐 점'
const SAME_MONTH_BAND = 3; // 작년 같은 달 대비 ▲▼

const pad = (n: number) => String(n).padStart(2, '0');

export function analyzePayments(payments: Pay[], perYear: number, now = new Date()): PaymentPattern {
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set<string>();
  const items: PayItem[] = sorted.map((p) => {
    const y = Number(p.date.slice(0, 4));
    const m = Number(p.date.slice(5, 7));
    const k = `${y}-${m}`;
    const extra = seen.has(k);
    seen.add(k);
    return { ...p, y, m, extra };
  });
  const byYM = new Map<string, PayItem[]>();
  for (const it of items) {
    const k = `${it.y}-${it.m}`;
    byYM.set(k, [...(byYM.get(k) ?? []), it]);
  }
  const regular = items.filter((p) => !p.special && !p.extra);
  const amounts = regular.map((p) => p.amount);
  const min = amounts.length ? Math.min(...amounts) : 0;
  const max = amounts.length ? Math.max(...amounts) : 0;

  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const today = `${curY}-${pad(curM)}-${pad(now.getDate())}`;
  const first = items[0];
  const startKey = first ? first.y * 12 + first.m : Infinity;
  // 그해 1~12월 자료가 모두 있는 해 (첫 회차가 그해 앞에 있고 지난 해)
  const complete = (y: number) => !!first && y < curY && first.y < y;
  const countUpTo = (y: number, m: number) => items.filter((p) => p.y === y && p.m <= m).length;
  const firstIn = (y: number, m: number) => byYM.get(`${y}-${m}`)?.find((p) => !p.special);

  const years: number[] = [];
  for (let y = curY; y >= Math.max(curY - 2, first ? first.y : curY); y--) years.push(y);

  const missed: { y: number; m: number }[] = [];
  const rows: YearRow[] = years.map((y) => {
    const cells: Cell[] = [];
    for (let m = 1; m <= 12; m++) {
      const list = byYM.get(`${y}-${m}`) ?? [];
      const main = list.find((p) => !p.extra);
      const extras = list.filter((p) => p.extra);
      if (main) {
        const prev = firstIn(y - 1, m);
        const base = main.special ? undefined : main;
        cells.push({
          kind: 'paid',
          main,
          extras,
          vsLastYear: base && prev ? ((base.amount - prev.amount) / prev.amount) * 100 : undefined,
          shade: max > min ? (main.amount - min) / (max - min) : 0.5,
        });
        continue;
      }
      if (y * 12 + m < startKey) {
        cells.push({ kind: 'out', extras: [], shade: 0 });
        continue;
      }
      if (y > curY || (y === curY && m >= curM)) {
        cells.push({ kind: 'future', extras: [], shade: 0 });
        continue;
      }
      // 빠짐: 다른 온전한 해에는 모두 그달에 받았고, 그해 그달까지의 회차 수도 다른 해보다 적으며,
      // 다음 달에 늦게 들어와 메워지지도 않았다 (분기 배당이 6월 → 7월로 밀린 것은 빠짐이 아님)
      const others = [curY - 3, curY - 2, curY - 1].filter((o) => o !== y && complete(o));
      const minOthers = (mm: number) => Math.min(...others.map((o) => countUpTo(o, mm)));
      const allPaid = others.length >= 2 && others.every((o) => byYM.has(`${o}-${m}`));
      const fewer = others.length >= 2 && countUpTo(y, m) < minOthers(m);
      // 다음 달이 아직 끝나지 않았으면 그달 몫은 빼고 비교한다 (이번 달 회차가 아직 안 나왔을 수 있다)
      const nextDone = !(y === curY && m + 1 >= curM);
      const recovered = m < 12 && countUpTo(y, m + 1) >= (nextDone ? minOthers(m + 1) : minOthers(m));
      if (allPaid && fewer && !recovered) {
        missed.push({ y, m });
        cells.push({ kind: 'missed', extras: [], shade: 0 });
      } else {
        cells.push({ kind: 'none', extras: [], shade: 0 });
      }
    }
    const inYear = items.filter((p) => p.y === y);
    const total = inYear.reduce((s, p) => s + p.amount, 0);
    const prevTotal = items.filter((p) => p.y === y - 1).reduce((s, p) => s + p.amount, 0);
    return {
      year: y,
      current: y === curY,
      cells,
      total,
      count: inYear.length,
      yoy: complete(y) && complete(y - 1) && prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : undefined,
    };
  });

  // 1년 이동평균 (정기 회차 perYear 개)
  const n = Math.max(1, Math.min(12, Math.round(perYear) || 4));
  const ma: (number | null)[] = [];
  const window: number[] = [];
  for (const it of items) {
    if (!it.special && !it.extra) {
      window.push(it.amount);
      if (window.length > n) window.shift();
    }
    ma.push(window.length >= n ? window.reduce((s, v) => s + v, 0) / window.length : null);
  }

  // 바뀐 점
  const DAY = 86400000;
  const t = (d: string) => new Date(`${d}T00:00:00`).getTime();
  const yearAgoOf = (it: PayItem) => {
    const target = t(it.date) - 365 * DAY;
    let best: PayItem | undefined;
    for (const r of regular) {
      const gap = Math.abs(t(r.date) - target);
      if (gap <= 45 * DAY && (!best || gap < Math.abs(t(best.date) - target))) best = r;
    }
    return best;
  };
  const events: PayEvent[] = [];
  let prevReg: PayItem | null = null;
  for (const it of items) {
    if (it.special) {
      events.push({ kind: 'special', key: it.date, date: it.date, y: it.y, m: it.m, amount: it.amount });
      continue;
    }
    if (it.extra) {
      events.push({ kind: 'extra', key: it.date, date: it.date, y: it.y, m: it.m, amount: it.amount });
      continue;
    }
    if (prevReg) {
      const ch = ((it.amount - prevReg.amount) / prevReg.amount) * 100;
      const ago = yearAgoOf(it);
      const yoy = ago ? ((it.amount - ago.amount) / ago.amount) * 100 : undefined;
      const confirmed = yoy == null || (Math.sign(yoy) === Math.sign(ch) && Math.abs(yoy) > SAME_MONTH_BAND);
      if (Math.abs(ch) > CHANGE_BAND && confirmed) {
        events.push({ kind: ch > 0 ? 'up' : 'down', key: it.date, date: it.date, y: it.y, m: it.m, amount: it.amount, prev: prevReg.amount, change: ch, yoy });
      }
    }
    prevReg = it;
  }
  for (const mm of missed) events.push({ kind: 'missed', key: `${mm.y}-${pad(mm.m)}-15`, y: mm.y, m: mm.m });
  events.sort((a, b) => b.key.localeCompare(a.key));

  const yearAgo = `${curY - 1}-${pad(curM)}-${pad(now.getDate())}`;
  const last12 = regular.filter((p) => p.date > yearAgo && p.date <= today);
  const avg12 = last12.length ? last12.reduce((s, p) => s + p.amount, 0) / last12.length : 0;

  return { items, ma, rows, events, min, max, avg12 };
}

export { SAME_MONTH_BAND };
