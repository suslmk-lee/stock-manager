import { LucideIcon } from 'lucide-react';

type Tone = 'warm' | 'mint' | 'amber' | 'sky';

const TONE_CLASS: Record<Tone, string> = {
  warm: '',
  mint: 'icon-tile-mint',
  amber: 'icon-tile-amber',
  sky: 'icon-tile-sky',
};

interface IconTileProps {
  icon: LucideIcon;
  tone?: Tone;
  size?: 'sm' | 'md';
  className?: string;
}

// 어두운 그라데이션 + 아래쪽 글로우를 가진 아이콘 타일
export default function IconTile({ icon: Icon, tone = 'warm', size = 'md', className = '' }: IconTileProps) {
  const sizeClass = size === 'sm' ? '!w-8 !h-8 !rounded-lg' : '';
  return (
    <span className={`icon-tile ${TONE_CLASS[tone]} ${sizeClass} ${className}`}>
      <Icon className={size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]'} strokeWidth={1.75} />
    </span>
  );
}
