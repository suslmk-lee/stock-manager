import { Account, AccountType } from '../types/models';

// 인출 가능 여부 필터 값 (통계 화면 등에서 공용)
export type LiquidityFilter = 'all' | 'liquid' | 'restricted';

interface AccountTypeMeta {
  value: AccountType;
  label: string;       // 폼/상세 표시용
  short: string;       // 배지/드롭다운 접두어
  restricted: boolean; // 중도 인출 제한 여부
  badgeClass: string;  // Tailwind 배지 스타일
}

export const ACCOUNT_TYPES: AccountTypeMeta[] = [
  { value: 'General', label: '일반 (위탁)', short: '일반', restricted: false, badgeClass: 'border border-mint-400/20 bg-mint-400/10 text-mint-300' },
  { value: 'ISA', label: 'ISA', short: 'ISA', restricted: false, badgeClass: 'border border-sky-400/20 bg-sky-400/10 text-sky-200' },
  { value: 'Pension', label: '연금저축', short: '연금', restricted: true, badgeClass: 'border border-amber-400/25 bg-amber-400/10 text-amber-200' },
  { value: 'IRP', label: 'IRP (개인형 퇴직연금)', short: 'IRP', restricted: true, badgeClass: 'border border-orange-400/25 bg-orange-400/10 text-orange-200' },
  { value: 'DC', label: '퇴직연금 DC', short: 'DC', restricted: true, badgeClass: 'border border-rose-400/25 bg-rose-400/10 text-rose-200' },
];

export const LIQUIDITY_LABELS: Record<Exclude<LiquidityFilter, 'all'>, string> = {
  liquid: '인출 가능',
  restricted: '인출 제한',
};

export function getAccountType(account?: Pick<Account, 'account_type'> | null): AccountType {
  return account?.account_type || 'General';
}

export function getAccountTypeMeta(account?: Pick<Account, 'account_type'> | null): AccountTypeMeta {
  const type = getAccountType(account);
  return ACCOUNT_TYPES.find((t) => t.value === type) || ACCOUNT_TYPES[0];
}

export function isRestrictedAccount(account?: Pick<Account, 'account_type'> | null): boolean {
  return getAccountTypeMeta(account).restricted;
}

// 인출 가능 여부 필터에 계좌가 해당하는지
export function matchesLiquidity(account: Pick<Account, 'account_type'> | null | undefined, filter: LiquidityFilter): boolean {
  if (filter === 'all') return true;
  const restricted = isRestrictedAccount(account);
  return filter === 'restricted' ? restricted : !restricted;
}

// 드롭다운 등 텍스트 전용 라벨: 일반 계좌는 접두어 없이, 그 외는 "[IRP] 계좌명"
export function accountTypePrefix(account?: Pick<Account, 'account_type'> | null): string {
  const meta = getAccountTypeMeta(account);
  return meta.value === 'General' ? '' : `[${meta.short}] `;
}
