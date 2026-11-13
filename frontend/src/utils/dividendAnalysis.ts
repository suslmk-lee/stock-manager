import type { Account, Asset, Dividend, Holding } from '../types/models';
import { isKRTicker } from './assetLabel';

/**
 * 배당 분석 계산 (화면과 분리한 순수 함수).
 * - 금액은 세후(받은 금액 = amount − tax), 원화로 환산 — 달러는 지급한 달의 환율, 앞으로의 예상은 현재 환율.
 * - 계좌 필터(계좌·시장·인출 가능/제한)를 거친 계좌의 배당·보유만 센다.
 */

export interface AnalysisInput {
  dividends: Dividend[];
  holdings: Holding[];
  accounts: Account[];
  /** 이 계좌를 셀지 (필터) */
  includeAccount: (a: Account) => boolean;
  /** YYYY-MM 의 USD→KRW (없으면 현재 환율) */
  rateFor: (monthKey: string) => number;
  currentRate: number;
  /** 종목 표·계좌별·국내/해외 합계의 기간 (개월) */
  periodMonths: number;
  now?: Date;
}

export type Cycle = '월' | '격월' | '분기' | '반기' | '연' | '불규칙';

export interface AssetRow {
  assetId: number;
  asset?: Asset;
  periodKRW: number; // 최근 N개월
  t12KRW: number; // 최근 12개월
  totalKRW: number; // 누적
  costKRW: number; // 지금 보유 투자금
  yoc: number | null; // 최근 12개월 ÷ 투자금 (%)
  cycle: Cycle | null; // 최근 12개월 지급 달 수로 본 주기
  lastDate: string;
  nextDate: string | null; // 지금 보유 중일 때만
  held: boolean;
}

export interface Analysis {
  t12KRW: number;
  ytdKRW: number;
  lastYtdKRW: number;
  costKRW: number;
  yoc: number | null;
  /** 연도별 받은 배당 (오래된 해부터). 올해는 진행 중이라 작년 전체와 비교하지 않는다 (같은 기간 비교는 ytd) */
  yearly: { year: number; krw: number; growth: number | null; partial: boolean }[];
  /** 올해·작년 월별 (1~12월) */
  monthCompare: { month: number; thisYear: number; lastYear: number }[];
  thisYear: number;
  /** 앞으로 12개월 예상 (이번 달 남은 날부터 11달 뒤까지) */
  forecast: { key: string; label: string; projected: number; confirmed: number }[];
  forecastKRW: number;
  assets: AssetRow[];
  byAccount: { account: Account; periodKRW: number; totalKRW: number }[];
  byMarket: { domestic: number; overseas: number };
  periodKRW: number;
  taxKRW: number;
  grossKRW: number;
  receivedCount: number;
  pendingCount: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const monthKeyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const parseDate = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28));
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const currencyOf = (d: Dividend) => (d.currency || (isKRTicker(d.asset?.ticker) ? 'KRW' : 'USD')).toUpperCase();

const CYCLE_MONTHS: Record<Cycle, number> = { 월: 1, 격월: 2, 분기: 3, 반기: 6, 연: 12, 불규칙: 0 };
function cycleOf(months: number): Cycle | null {
  if (months <= 0) return null;
  if (months >= 10) return '월';
  if (months === 6) return '격월';
  if (months >= 3 && months <= 5) return '분기';
  if (months === 2) return '반기';
  if (months === 1) return '연';
  return '불규칙';
}

export function analyzeDividends(input: AnalysisInput): Analysis {
  const now = input.now ?? new Date();
  const today = ymd(now);
  const accById = new Map(input.accounts.map((a) => [a.id, a]));
  const included = (accountId: number) => {
    const a = accById.get(accountId);
    return !!a && input.includeAccount(a);
  };
  const toKRW = (v: number, ccy: string, monthKey: string) => (ccy === 'KRW' ? v : v * (input.rateFor(monthKey) || input.currentRate));
  const nowToKRW = (v: number, ccy: string) => (ccy === 'KRW' ? v : v * input.currentRate);

  const t12From = ymd(addMonths(now, -12));
  const periodFrom = ymd(addMonths(now, -input.periodMonths));
  const thisYear = now.getFullYear();
  const lastYtdTo = `${thisYear - 1}-${today.slice(5)}`;

  const divs = input.dividends.filter((d) => included(d.account_id));
  const received = divs.filter((d) => d.is_received);

  // 지금 보유 (계좌·종목별 수량, 종목별 투자금)
  const heldQty = new Map<string, number>();
  const costByAsset = new Map<number, number>();
  for (const h of input.holdings) {
    if (!included(h.account_id) || !(h.quantity > 0)) continue;
    heldQty.set(`${h.account_id}:${h.asset_id}`, (heldQty.get(`${h.account_id}:${h.asset_id}`) ?? 0) + h.quantity);
    const ccy = isKRTicker(h.asset?.ticker) ? 'KRW' : 'USD';
    costByAsset.set(h.asset_id, (costByAsset.get(h.asset_id) ?? 0) + nowToKRW(h.quantity * h.average_price, ccy));
  }

  let t12KRW = 0;
  let ytdKRW = 0;
  let lastYtdKRW = 0;
  let periodKRW = 0;
  let taxKRW = 0;
  let grossKRW = 0;
  const yearMap = new Map<number, number>();
  const monthThis = Array(12).fill(0);
  const monthLast = Array(12).fill(0);
  const assetMap = new Map<number, AssetRow & { months12: Set<string> }>();
  const accMap = new Map<number, { periodKRW: number; totalKRW: number }>();
  const market = { domestic: 0, overseas: 0 };

  for (const d of received) {
    const date = d.date.slice(0, 10);
    const mk = date.slice(0, 7);
    const ccy = currencyOf(d);
    const net = toKRW(d.amount - (d.tax || 0), ccy, mk);
    taxKRW += toKRW(d.tax || 0, ccy, mk);
    grossKRW += toKRW(d.amount, ccy, mk);
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7)) - 1;
    yearMap.set(y, (yearMap.get(y) ?? 0) + net);
    if (y === thisYear) monthThis[m] += net;
    if (y === thisYear - 1) monthLast[m] += net;
    if (date > t12From && date <= today) t12KRW += net;
    if (y === thisYear && date <= today) ytdKRW += net;
    if (y === thisYear - 1 && date <= lastYtdTo) lastYtdKRW += net;
    const inPeriod = date > periodFrom && date <= today;
    if (inPeriod) periodKRW += net;

    let row = assetMap.get(d.asset_id);
    if (!row) {
      row = { assetId: d.asset_id, asset: d.asset, periodKRW: 0, t12KRW: 0, totalKRW: 0, costKRW: 0, yoc: null, cycle: null, lastDate: '', nextDate: null, held: false, months12: new Set() };
      assetMap.set(d.asset_id, row);
    }
    row.totalKRW += net;
    if (inPeriod) row.periodKRW += net;
    if (date > t12From && date <= today) {
      row.t12KRW += net;
      row.months12.add(mk);
    }
    if (date > row.lastDate) row.lastDate = date;

    const acc = accMap.get(d.account_id) ?? { periodKRW: 0, totalKRW: 0 };
    acc.totalKRW += net;
    if (inPeriod) acc.periodKRW += net;
    accMap.set(d.account_id, acc);

    if (inPeriod) {
      if (isKRTicker(d.asset?.ticker)) market.domestic += net;
      else market.overseas += net;
    }
  }

  // 종목 표: 투자금·배당률·주기·다음 예상
  const assets: AssetRow[] = [];
  for (const row of assetMap.values()) {
    const { months12, ...r } = row;
    r.costKRW = costByAsset.get(r.assetId) ?? 0;
    r.held = r.costKRW > 0;
    r.yoc = r.held && r.costKRW > 0 && r.t12KRW > 0 ? (r.t12KRW / r.costKRW) * 100 : null;
    r.cycle = cycleOf(months12.size);
    const step = r.cycle ? CYCLE_MONTHS[r.cycle] : 0;
    if (r.held && step > 0 && r.lastDate) {
      let next = addMonths(parseDate(r.lastDate), step);
      while (ymd(next) <= today) next = addMonths(next, step);
      r.nextDate = ymd(next);
    }
    assets.push(r);
  }
  assets.sort((a, b) => b.periodKRW - a.periodKRW || b.totalKRW - a.totalKRW);

  // 앞으로 12개월 예상: 지난 12개월 지급을 1년 뒤로 (지금 보유 중인 계좌·종목만) + 이미 적어 둔 예정 배당
  const forecastKeys: string[] = [];
  for (let i = 0; i < 12; i++) forecastKeys.push(monthKeyOf(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  const fIndex = new Map(forecastKeys.map((k, i) => [k, i]));
  const forecast = forecastKeys.map((key, i) => ({ key, label: i === 0 ? '이번 달' : `${Number(key.slice(5))}월`, projected: 0, confirmed: 0 }));
  const pendingSlots = new Set<string>();
  for (const d of divs) {
    if (d.is_received || d.date.slice(0, 10) <= today) continue;
    const mk = d.date.slice(0, 7);
    const i = fIndex.get(mk);
    if (i === undefined) continue;
    forecast[i].confirmed += nowToKRW(d.amount - (d.tax || 0), currencyOf(d));
    pendingSlots.add(`${d.account_id}:${d.asset_id}:${mk}`);
  }
  // 지난 12개월 (지금−12개월, 지금] 의 지급을 1년 뒤 (지금, 지금+12개월] 로 옮긴다 (보유 수량 변화는 반영하지 않음)
  for (const d of received) {
    const date = d.date.slice(0, 10);
    if (!(date > t12From && date <= today)) continue;
    if (!heldQty.get(`${d.account_id}:${d.asset_id}`)) continue;
    const mk = monthKeyOf(addMonths(parseDate(date), 12));
    const i = fIndex.get(mk);
    if (i === undefined || pendingSlots.has(`${d.account_id}:${d.asset_id}:${mk}`)) continue;
    forecast[i].projected += nowToKRW(d.amount - (d.tax || 0), currencyOf(d));
  }
  const forecastKRW = forecast.reduce((s, f) => s + f.projected + f.confirmed, 0);

  const years = [...yearMap.keys()].sort((a, b) => a - b);
  const yearly = years.map((year, i) => {
    const krw = yearMap.get(year) ?? 0;
    const prev = i > 0 ? yearMap.get(years[i - 1]) ?? 0 : 0;
    const partial = year === thisYear;
    return { year, krw, partial, growth: !partial && i > 0 && prev > 0 && years[i - 1] === year - 1 ? ((krw - prev) / prev) * 100 : null };
  });

  const costKRW = [...costByAsset.values()].reduce((s, v) => s + v, 0);
  const byAccount = [...accMap.entries()]
    .map(([id, v]) => ({ account: accById.get(id)!, ...v }))
    .filter((r) => r.account)
    .sort((a, b) => b.periodKRW - a.periodKRW || b.totalKRW - a.totalKRW);

  return {
    t12KRW,
    ytdKRW,
    lastYtdKRW,
    costKRW,
    yoc: costKRW > 0 && t12KRW > 0 ? (t12KRW / costKRW) * 100 : null,
    yearly,
    monthCompare: monthThis.map((v, i) => ({ month: i + 1, thisYear: v, lastYear: monthLast[i] })),
    thisYear,
    forecast,
    forecastKRW,
    assets,
    byAccount,
    byMarket: market,
    periodKRW,
    taxKRW,
    grossKRW,
    receivedCount: received.length,
    pendingCount: divs.length - received.length,
  };
}
