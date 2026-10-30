import { useEffect, useState, ReactNode } from 'react';

interface RingGaugeProps {
  value: number; // 0 ~ 100 (링 채움 비율)
  size?: number; // px
  stroke?: number; // px
  color?: string; // 링 색상
  trackColor?: string;
  children?: ReactNode; // 링 중앙 내용 (기본: 반올림한 value)
  label?: ReactNode; // 링 아래 고정폭 라벨
}

// 참고 디자인의 민트 링 게이지. 마운트 시 0 → value 로 채워진다.
export default function RingGauge({
  value,
  size = 88,
  stroke = 3,
  color = 'rgb(var(--c-mint-400))',
  trackColor = 'rgb(var(--c-white) / 0.06)',
  children,
  label,
}: RingGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(clamped));
    return () => cancelAnimationFrame(id);
  }, [clamped]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: trackColor }} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - shown / 100)}
            style={{ stroke: color, transition: 'stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)', filter: `drop-shadow(0 0 6px color-mix(in srgb, ${color} 35%, transparent))` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center num font-semibold" style={{ color }}>
          {children ?? Math.round(clamped)}
        </div>
      </div>
      {label && <div className="label-mono text-center">{label}</div>}
    </div>
  );
}
