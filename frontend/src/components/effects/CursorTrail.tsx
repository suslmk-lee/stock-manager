import { useEffect, useRef } from 'react';
import { useAppearance } from '../../appearance/AppearanceContext';

// 마우스 포인터를 따라 점 체인이 이어지는 장식 효과 (설정에서 켤 때만 동작)
const SETTLE_EPS = 0.1;

function readRgb(name: string, fallback: [number, number, number]): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? (v as [number, number, number]) : fallback;
}

export default function CursorTrail() {
  const { settings } = useAppearance();
  const { enabled, nodes, ease, headSize, taper, gradient } = settings.cursorTrail;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const active = enabled && !reduced;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const c1 = readRgb('--c-mint-400', [45, 212, 191]);
    const c2 = readRgb('--c-sky-400', [56, 189, 248]);
    const n = Math.max(2, Math.round(nodes));
    const pts = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
    const target = { x: 0, y: 0 };
    let visible = false; // 포인터가 창 안에 있고 위치를 받았는지
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const clear = () => ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const draw = () => {
      clear();
      if (!visible) return;
      // 꼬리부터 그려 머리가 위에 오게 한다
      for (let i = n - 1; i >= 0; i--) {
        const t = i / (n - 1);
        const r = Math.max(1, headSize * (1 - taper * t)) / 2;
        const col = gradient ? c1.map((v, k) => Math.round(v + (c2[k] - v) * t)) : c1;
        ctx.globalAlpha = 1 - 0.5 * t;
        ctx.fillStyle = `rgb(${col[0]} ${col[1]} ${col[2]})`;
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const tick = () => {
      raf = 0;
      let moving = false;
      pts[0].x = target.x;
      pts[0].y = target.y;
      for (let i = 1; i < n; i++) {
        const dx = pts[i - 1].x - pts[i].x;
        const dy = pts[i - 1].y - pts[i].y;
        pts[i].x += dx * ease;
        pts[i].y += dy * ease;
        if (Math.abs(dx) > SETTLE_EPS || Math.abs(dy) > SETTLE_EPS) moving = true;
      }
      draw();
      if (moving) raf = requestAnimationFrame(tick); // 다 모이면 루프 중단
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      target.x = e.clientX;
      target.y = e.clientY;
      if (!visible) {
        // 처음 나타날 때는 모든 점을 포인터 위치에서 시작
        pts.forEach((p) => { p.x = e.clientX; p.y = e.clientY; });
        visible = true;
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const hide = () => {
      visible = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      clear();
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) hide();
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('mouseout', onOut);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('blur', hide);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, nodes, ease, headSize, taper, gradient, settings.themeId]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999] h-screen w-screen"
    />
  );
}
