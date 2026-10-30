import { useEffect } from 'react';
import { useAppearance } from '../../appearance/AppearanceContext';

// 카드 입체감: 마우스를 올린 카드를 포인터 쪽으로 기울이고 살짝 띄운다 (모양 설정에서 켤 때만)
const BASE_WIDTH = 480; // 이보다 넓은 카드는 기울기를 줄여 과하지 않게

export default function CardTilt() {
  const { settings } = useAppearance();
  const { enabled, scope, tilt, lift } = settings.cardDepth;
  const active = enabled && (tilt > 0 || lift > 0);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const selector = scope === 'all' ? '.surface, .hero-grain' : '.hero-grain';
    let current: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;

    const release = (el: HTMLElement) => {
      el.style.transition = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = '';
    };

    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const target = e.target instanceof Element ? (e.target.closest(selector) as HTMLElement | null) : null;
      // 모달·알림 드롭다운처럼 화면에 고정된 창은 움직이지 않는다
      const el =
        target && (target === current || (!target.closest('[role=dialog]') && getComputedStyle(target).position !== 'fixed'))
          ? target
          : null;
      if (current && current !== el) release(current);
      current = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      const k = Math.min(1, BASE_WIDTH / r.width);
      el.style.transition = 'transform 0.12s ease-out';
      el.style.transform = `perspective(1000px) rotateX(${(-py * 2 * tilt * k).toFixed(2)}deg) rotateY(${(px * 2 * tilt * k).toFixed(2)}deg) translateY(${-lift}px)`;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (current) release(current);
      current = null;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
      if (frame) cancelAnimationFrame(frame);
      onLeave();
    };
  }, [active, scope, tilt, lift]);

  return null;
}
