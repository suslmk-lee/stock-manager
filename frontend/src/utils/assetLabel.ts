// 종목을 화면에 보일 때의 대표 이름.
// 미국 종목은 티커(NVDA, SCHD)가 알아보기 쉬워 티커가 대표, 회사·ETF 이름은 작게.
// 국내 종목은 티커가 숫자 코드(005930.KS)라 이름이 대표, 코드는 작게.

type AssetLike = { ticker?: string | null; name?: string | null } | null | undefined;

export const isKRTicker = (ticker?: string | null) => /\.(KS|KQ)$/i.test(ticker ?? '');
/** 펀드 (거래소 시세 없음, 티커 FUND:펀드코드) */
export const isFundTicker = (ticker?: string | null) => /^FUND:/i.test(ticker ?? '');
/** 펀드코드 (앱이 만든 코드면 빈 문자열) */
export const fundCode = (ticker?: string | null) => {
  const c = (ticker ?? '').replace(/^FUND:/i, '');
  return /^X[A-Z0-9]{7}$/.test(c) ? '' : c;
};

/** 미국 종목이면서 이름이 따로 있으면 티커가 대표 */
export const tickerFirst = (a: AssetLike) => !!a?.ticker && !!a?.name && a.name !== a.ticker && !isKRTicker(a.ticker) && !isFundTicker(a.ticker);

/** 크게 보일 이름 (미국 = 티커, 국내 = 이름) */
export function assetPrimary(a: AssetLike, fallback = ''): string {
  if (tickerFirst(a)) return a!.ticker!;
  return a?.name || a?.ticker || fallback;
}

/** 작게 붙는 이름 (미국 = 회사·ETF 이름, 국내 = 종목 코드). 없으면 빈 문자열 */
export function assetSecondary(a: AssetLike): string {
  if (tickerFirst(a)) return a!.name!;
  if (isFundTicker(a?.ticker)) return fundCode(a?.ticker) || '펀드';
  return a?.name ? a?.ticker || '' : '';
}
