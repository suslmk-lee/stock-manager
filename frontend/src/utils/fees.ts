// 한국 증권사 표준 매매 수수료/세금 계산 (2025년 기준)
//
// [국내 주식 - KRW]
//   - 증권사 수수료: 0.015% (비대면 평균)
//   - 증권거래세: 매도 시 0.15% (코스피 농특세 / 코스닥 거래세)
//   - 매수 총: 0.015% | 매도 총: 0.165%
//
// [해외 주식 - USD 외]
//   - 증권사 수수료: 0.25% (한국 증권사 평균)
//   - SEC Fee: 2025년 5월 13일부터 면제
//   - 매수/매도 동일 0.25%

export type FeeBreakdown = {
  commission: number; // 증권사 수수료
  tax: number;        // 증권거래세 / SEC Fee 등
  total: number;      // 합계
  rateDescription: string;
};

const RATES = {
  KRW: {
    commission: 0.00015, // 0.015%
    sellTax: 0.0015,     // 0.15% (매도 시만)
  },
  FOREIGN: {
    commission: 0.0025, // 0.25%
    sellTax: 0,         // SEC Fee 면제 (2025-05)
  },
};

export function calculateFee(
  price: number,
  quantity: number,
  currency: string,
  type: 'Buy' | 'Sell',
): FeeBreakdown {
  const gross = price * quantity;
  if (!gross || gross <= 0) {
    return { commission: 0, tax: 0, total: 0, rateDescription: '' };
  }

  const isKRW = currency === 'KRW' || !currency;
  const rates = isKRW ? RATES.KRW : RATES.FOREIGN;

  const commission = gross * rates.commission;
  const tax = type === 'Sell' ? gross * rates.sellTax : 0;
  const total = commission + tax;

  const commissionPct = (rates.commission * 100).toFixed(3) + '%';
  const taxPct = (rates.sellTax * 100).toFixed(3) + '%';

  let desc = `수수료 ${commissionPct}`;
  if (type === 'Sell' && rates.sellTax > 0) {
    desc += ` + ${isKRW ? '거래세' : 'SEC Fee'} ${taxPct}`;
  }

  return { commission, tax, total, rateDescription: desc };
}

// 통화별 소수점 반올림 (KRW는 원 단위, 그 외는 2자리)
export function roundFee(amount: number, currency: string): number {
  if (currency === 'KRW' || !currency) return Math.round(amount);
  return Math.round(amount * 100) / 100;
}
