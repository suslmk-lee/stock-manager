import { Wallet } from 'lucide-react';

// 증권사 로고 (frontend/images). 로고가 없는 증권사는 지갑 아이콘.
export const BROKER_LOGOS: Record<string, string> = {
  메리츠증권: '/meritz.png',
  토스증권: '/toss.png',
  카카오증권: '/kakao.png',
  한국투자증권: '/korea.png',
  삼성증권: '/samsung.png',
  신한투자증권: '/shinhan.png',
  대신증권: '/daishin.png',
  NH투자증권: '/NH.png',
  미래에셋증권: '/miraeasset.png',
  KB증권: '/kb.png',
};

/** 증권사 이름으로 로고를 찾는다 ("카카오페이증권"처럼 조금 다른 이름도 앞부분으로 맞춘다) */
export function brokerLogo(broker: string): string | undefined {
  if (BROKER_LOGOS[broker]) return BROKER_LOGOS[broker];
  const key = Object.keys(BROKER_LOGOS).find((k) => broker.startsWith(k.replace(/증권$/, '')));
  return key ? BROKER_LOGOS[key] : undefined;
}

export default function BrokerLogo({ broker, className = '' }: { broker: string; className?: string }) {
  const logo = brokerLogo(broker);
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 ${logo ? 'bg-paper' : 'surface-inset text-zinc-400'} ${className}`}
    >
      {logo ? <img src={logo} alt={broker} className="h-full w-full object-contain px-1.5 py-1" /> : <Wallet className="h-4 w-4" />}
    </div>
  );
}
