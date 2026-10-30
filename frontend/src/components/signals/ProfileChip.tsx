import { Coins, Layers } from 'lucide-react';
import type { ProfileKind } from '../../types/models';

interface ProfileChipProps {
  name: string;
  kind?: ProfileKind;
  className?: string;
}

// 전략 프로필 배지: 배당형은 하늘색 + 동전 아이콘, 일반형은 중립색
export default function ProfileChip({ name, kind = 'standard', className = '' }: ProfileChipProps) {
  const dividend = kind === 'dividend';
  return (
    <span
      className={`badge max-w-full ${
        dividend ? 'border border-sky-400/30 bg-sky-400/10 text-sky-200' : 'border border-white/10 bg-white/[0.05] text-zinc-300'
      } ${className}`}
    >
      {dividend ? <Coins className="h-3 w-3 shrink-0" /> : <Layers className="h-3 w-3 shrink-0" />}
      <span className="truncate">{name}</span>
    </span>
  );
}

export function kindLabel(kind: ProfileKind): string {
  return kind === 'dividend' ? '배당형' : '일반';
}
