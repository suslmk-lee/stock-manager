import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  format: (v: number) => string;
  duration?: number; // ms
  className?: string;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 숫자를 이전 값(최초엔 0)에서 새 값까지 부드럽게 증가/감소시키며 표시한다.
export default function CountUp({ value, format, duration = 900, className }: CountUpProps) {
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? value : 0));
  const displayRef = useRef(display);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (prefersReducedMotion()) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }
    const from = displayRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const next = from + (value - from) * easeOutCubic(t);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  // tabular-nums: 자릿수 폭 고정으로 애니메이션 중 글자 흔들림 방지
  return <span className={`tabular-nums ${className ?? ''}`}>{format(display)}</span>;
}
