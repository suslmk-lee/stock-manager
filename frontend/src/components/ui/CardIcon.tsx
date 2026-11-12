import type { AppIcon, IconTone } from './appIcons';

// 카드 머리 · 목록 아이콘 — 예전 그라데이션 타일 대신 quantum-mate 처럼 타일 없이 "어긋난 두 색" 아이콘만 둔다.
// tone 은 면 색: mint/warm = 테마 강조색, amber · sky · rose = 상태 색 (예전 타일 색 이름 그대로 받는다)
type Tone = 'warm' | 'mint' | 'amber' | 'sky' | 'rose';

const TONE: Record<Tone, IconTone> = { warm: 'accent', mint: 'accent', amber: 'amber', sky: 'sky', rose: 'rose' };
const SIZE = { sm: 'h-5 w-5', md: 'h-6 w-6', lg: 'h-10 w-10' } as const;

interface CardIconProps {
  icon: AppIcon;
  tone?: Tone;
  size?: keyof typeof SIZE;
  className?: string;
}

export default function CardIcon({ icon: Icon, tone = 'mint', size = 'md', className = '' }: CardIconProps) {
  return <Icon className={`shrink-0 text-zinc-200 ${SIZE[size]} ${className}`} tone={TONE[tone]} />;
}
