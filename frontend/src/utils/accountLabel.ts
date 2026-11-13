import type { Account } from '../types/models';

type AccountLike = Pick<Account, 'name' | 'broker'> | null | undefined;

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** 증권사 이름에서 '증권'·'투자증권' 같은 꼬리를 뗀 부분 (토스증권 → 토스, NH투자증권 → nh투자) */
const brokerCore = (broker: string) => norm(broker).replace(/(금융투자|투자증권|증권)$/, '');

/** 계좌 이름만으로 증권사를 알 수 있는지 (예: '토스 달러', '카카오페이 모으기') */
export function nameShowsBroker(account: AccountLike): boolean {
  if (!account?.broker) return true;
  const core = brokerCore(account.broker);
  return !core || norm(account.name).includes(core);
}

/**
 * 화면에 보일 계좌 이름 — '종합계좌'·'주식계좌'·'ISA' 처럼 여러 증권사에 있는 이름이면 증권사를 붙인다.
 * 예: 'NH투자증권 · 종합계좌', '토스 달러'(이름에 이미 '토스'가 있음)
 */
export function accountDisplayName(account: AccountLike, fallback = ''): string {
  if (!account) return fallback;
  if (nameShowsBroker(account)) return account.name || fallback;
  return `${account.broker} · ${account.name}`;
}
