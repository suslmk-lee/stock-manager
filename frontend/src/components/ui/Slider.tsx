import type { CSSProperties } from 'react';
import './slider.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  ariaLabel: string;
  disabled?: boolean;
}

// 네이티브 range 기반 슬라이더 + 오른쪽 값 상자
export default function Slider({ value, min, max, step = 1, onChange, format, ariaLabel, disabled }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <input
        type="range"
        className="ui-slider flex-1 min-w-0"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%` } as CSSProperties}
      />
      <span className="ui-slider-value">{format ? format(value) : String(value)}</span>
    </div>
  );
}
