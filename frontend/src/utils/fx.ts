import { apiClient } from '../api/client';

/**
 * 여러 통화 → 원화. 달러는 앱 환율(GetUSDToKRW)을 그대로 쓰고, 엔화 등 그 밖의 통화는 {통화}KRW=X 시세로 바꾼다.
 * (예전에는 원화가 아니면 모두 달러로 봐서, 도쿄 상장 2621.T 같은 엔화 종목이 크게 틀렸다)
 */

/** 거래소 꼬리표로 짐작한 종목 통화 (.KS·.KQ 원화, .T 엔화 … 모르면 달러) — 서버 currencyFor 와 같은 규칙 */
const SUFFIX_CCY: [string, string][] = [
  ['.KS', 'KRW'],
  ['.KQ', 'KRW'],
  ['.T', 'JPY'],
  ['.HK', 'HKD'],
  ['.SS', 'CNY'],
  ['.SZ', 'CNY'],
  ['.TWO', 'TWD'],
  ['.TW', 'TWD'],
  ['.L', 'GBp'],
  ['.TO', 'CAD'],
  ['.AX', 'AUD'],
  ['.SI', 'SGD'],
  ['.DE', 'EUR'],
  ['.PA', 'EUR'],
];
export function ccyOfTicker(ticker?: string | null): string {
  const u = (ticker ?? '').trim().toUpperCase();
  for (const [suf, ccy] of SUFFIX_CCY) if (u.endsWith(suf)) return ccy;
  return 'USD';
}

/** 통화 이름 정리 — 원화·달러·엔화는 대문자로, 펜스(GBp) 같은 1/100 단위는 그대로 */
export function normCcy(ccy?: string | null): string {
  const c = (ccy ?? '').trim();
  if (!c) return '';
  if (c === 'GBp' || c === 'GBX' || c === 'ILA' || c === 'ZAc') return c;
  return c.toUpperCase();
}

/** 통화 1단위의 원화 값을 주는 시세 티커와 배수 */
function fxSymbol(ccy: string): [string, number] {
  switch (ccy) {
    case 'GBp':
    case 'GBX':
      return ['GBPKRW=X', 0.01];
    case 'ILA':
      return ['ILSKRW=X', 0.01];
    case 'ZAc':
      return ['ZARKRW=X', 0.01];
    default:
      return [`${ccy}KRW=X`, 1];
  }
}

export type FxRates = Record<string, number>;

// 이번 실행 동안 10분 기억
const cache = new Map<string, { v: number; at: number }>();
const TTL = 10 * 60 * 1000;

/** 통화별 원화 환율 (원화 1, 달러는 usdKrw). 못 구한 통화는 빠진다 → toKRW 가 0 으로 본다 */
export async function loadFxRates(currencies: (string | null | undefined)[], usdKrw: number): Promise<FxRates> {
  const out: FxRates = { KRW: 1 };
  if (usdKrw > 0) out.USD = usdKrw;
  const need: string[] = [];
  for (const raw of new Set(currencies.map(normCcy))) {
    if (!raw || raw === 'KRW' || raw === 'USD') continue;
    const hit = cache.get(raw);
    if (hit && Date.now() - hit.at < TTL) out[raw] = hit.v;
    else need.push(raw);
  }
  if (need.length > 0) {
    try {
      const syms = need.map((c) => fxSymbol(c)[0]);
      const prices = ((await apiClient.GetCurrentPrices(syms)) ?? {}) as Record<string, { price?: number } | undefined>;
      for (const c of need) {
        const [sym, mult] = fxSymbol(c);
        const p = Number(prices[sym]?.price ?? prices[sym.toUpperCase()]?.price ?? 0);
        if (p > 0) {
          out[c] = p * mult;
          cache.set(c, { v: p * mult, at: Date.now() });
        }
      }
    } catch (e) {
      console.warn('환율을 불러오지 못했습니다:', need, e);
    }
  }
  return out;
}

/** 원화로 — 환율을 모르는 통화는 0 (원화로 잘못 읽지 않게) */
export function toKRW(v: number, ccy: string | null | undefined, rates: FxRates): number {
  const c = normCcy(ccy);
  if (!c || c === 'KRW') return v;
  const r = rates[c];
  return r > 0 ? v * r : 0;
}

/** 통화 → 통화 (원화를 거쳐). 환율을 모르면 0 */
export function convertCcy(v: number, from: string | null | undefined, to: string | null | undefined, rates: FxRates): number {
  const f = normCcy(from) || 'KRW';
  const t = normCcy(to) || 'KRW';
  if (f === t) return v;
  const krw = toKRW(v, f, rates);
  if (t === 'KRW') return krw;
  const r = rates[t];
  return r > 0 ? krw / r : 0;
}

const FLAG: Record<string, string> = { KRW: '🇰🇷', USD: '🇺🇸', JPY: '🇯🇵', CNY: '🇨🇳', HKD: '🇭🇰', TWD: '🇹🇼', EUR: '🇪🇺', GBP: '🇬🇧', GBp: '🇬🇧', CAD: '🇨🇦', AUD: '🇦🇺', SGD: '🇸🇬' };
/** 시장 국기 (원화 🇰🇷 · 달러 🇺🇸 · 엔화 🇯🇵 …) */
export const ccyFlag = (ccy?: string | null) => FLAG[normCcy(ccy)] ?? '🌐';

const SYMBOL: Record<string, string> = { KRW: '₩', USD: '$', JPY: '¥', CNY: 'CN¥', HKD: 'HK$', TWD: 'NT$', EUR: '€', GBP: '£', GBp: 'p', CAD: 'C$', AUD: 'A$', SGD: 'S$' };
/** 소수점 없이 쓰는 통화 */
const NO_DECIMALS = new Set(['KRW', 'JPY', 'TWD', 'GBp']);

/** 통화 기호 */
export const ccySymbol = (ccy?: string | null) => SYMBOL[normCcy(ccy)] ?? `${normCcy(ccy)} `;

/** 금액 표시 (₩1,234 · $12.34 · ¥961) — 마이너스는 −₩1,234 */
export function fmtCcy(v: number, ccy?: string | null, opts: { decimals?: number } = {}): string {
  const c = normCcy(ccy) || 'KRW';
  const d = opts.decimals ?? (NO_DECIMALS.has(c) ? 0 : 2);
  const a = Math.abs(v);
  const body = c === 'GBp' ? `${a.toLocaleString('en-US', { maximumFractionDigits: 2 })}p` : `${ccySymbol(c)}${a.toLocaleString(c === 'KRW' ? 'ko-KR' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  return v < 0 && a >= (d === 0 ? 0.5 : 0.005) ? `−${body}` : body;
}
