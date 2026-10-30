import { ReactNode } from 'react';
import { Check } from 'lucide-react';

interface ChipProps {
  children: ReactNode;
  check?: boolean; // 앞에 민트 체크 아이콘
  className?: string;
}

// 고정폭 텍스트 칩 (예: "✓ sitemap.xml")
export default function Chip({ children, check = false, className = '' }: ChipProps) {
  return (
    <span className={`chip ${className}`}>
      {check && <Check className="w-3 h-3 text-mint-400" strokeWidth={2.5} />}
      {children}
    </span>
  );
}
