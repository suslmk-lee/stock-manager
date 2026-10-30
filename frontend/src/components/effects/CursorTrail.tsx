import { useEffect, useRef } from 'react';
import { useAppearance } from '../../appearance/AppearanceContext';

// 마우스 포인터를 따라 트레일이 이어지는 장식 효과 (설정에서 켤 때만 동작)
// 프리셋: dots(점 체인) / ribbon(리본) / pixel(격자 사각형) / ghost(화살표 잔상) / comet(혜성)
const SETTLE_EPS = 0.1;

type Rgb = [number, number, number];
type Pt = { x: number; y: number };
type Square = { cx: number; cy: number; born: number };
type Particle = { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number };

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as Rgb;
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// 클래식 화살표 커서 실루엣 (끝점이 원점, 높이 1 기준)
const ARROW: Array<[number, number]> = [
  [0, 0], [0, 0.85], [0.2, 0.67], [0.33, 0.97], [0.45, 0.91], [0.32, 0.62], [0.57, 0.62],
];

function readRgb(name: string, fallback: Rgb): Rgb {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? (v as Rgb) : fallback;
}

export default function CursorTrail() {
  const { settings } = useAppearance();
  const { enabled, nodes, ease, headSize, taper, gradient, style } = settings.cursorTrail;
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
    const pts: Pt[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
    const target = { x: 0, y: 0 };
    const squares: Square[] = [];
    const particles: Particle[] = [];
    let lastCell: Pt | null = null; // pixel: 마지막으로 지난 격자 칸
    let moved = false; // comet: 직전 프레임 이후 포인터가 움직였는지
    let vel = { x: 0, y: 0 }; // comet: 머리 이동 속도
    const cell = Math.max(6, Math.round(headSize / 2));
    const pixelLife = (nodes * 28) / (0.4 + ease); // ms
    const maxSquares = Math.round(nodes * 3);
    const cometLife = nodes * 30; // ms
    const maxParticles = Math.round(nodes * 6);
    let visible = false; // 포인터가 창 안에 있고 위치를 받았는지
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const clear = () => ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const drawDots = () => {
      // 꼬리부터 그려 머리가 위에 오게 한다
      for (let i = n - 1; i >= 0; i--) {
        const t = i / (n - 1);
        const r = Math.max(1, headSize * (1 - taper * t)) / 2;
        const col = gradient ? mix(c1, c2, t) : c1;
        ctx.globalAlpha = 1 - 0.5 * t;
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    // 점 목록을 중점 기반 2차 곡선으로 이어 그린다 (현재 경로에 이어붙임)
    const curveThrough = (P: Pt[], first: boolean) => {
      if (first) ctx.moveTo(P[0].x, P[0].y); else ctx.lineTo(P[0].x, P[0].y);
      for (let i = 1; i < P.length - 1; i++) {
        ctx.quadraticCurveTo(P[i].x, P[i].y, (P[i].x + P[i + 1].x) / 2, (P[i].y + P[i + 1].y) / 2);
      }
      ctx.lineTo(P[P.length - 1].x, P[P.length - 1].y);
    };

    const drawRibbon = () => {
      const head = pts[0];
      const tail = pts[n - 1];
      const left: Pt[] = [];
      const right: Pt[] = [];
      let nx = 0, ny = 1;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(n - 1, i + 1)];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) { nx = -dy / len; ny = dx / len; }
        const t = i / (n - 1);
        const hw = Math.max(0.5, headSize * (1 - taper * t)) / 2;
        left.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
        right.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
      }
      const g = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
      const end = gradient ? c2 : c1;
      g.addColorStop(0, rgba(c1, 0.95));
      g.addColorStop(1, rgba(end, 0.08));
      ctx.fillStyle = Math.hypot(head.x - tail.x, head.y - tail.y) < 0.5 ? rgba(c1, 0.95) : g;
      ctx.beginPath();
      curveThrough(left, true);
      curveThrough(right.slice().reverse(), false);
      ctx.closePath();
      ctx.fill();
    };

    const drawPixel = (now: number) => {
      for (let i = 0; i < squares.length; i++) {
        const sq = squares[i];
        const t = (now - sq.born) / pixelLife; // 0 → 1
        if (t >= 1) continue;
        const size = Math.max(1, Math.round(cell * (1 - taper * t)));
        const col = gradient ? mix(c1, c2, t) : c1;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = rgba(col, 1);
        // 칸 중앙 기준, 정수 좌표로 또렷하게
        const off = Math.round((cell - size) / 2);
        ctx.fillRect(sq.cx * cell + off, sq.cy * cell + off, size, size);
      }
      ctx.globalAlpha = 1;
    };

    const drawGhost = () => {
      const h = Math.max(8, headSize);
      // 네이티브 커서가 머리 자리를 차지하므로 index 1부터, 노드가 많으면 하나 걸러 그린다
      const stepI = n > 16 ? 2 : 1;
      for (let i = n - 1; i >= 1; i--) {
        if (i % stepI !== 0) continue;
        const t = i / (n - 1);
        const sc = h * (1 - 0.4 * taper * t);
        const col = gradient ? mix(c1, c2, t) : c1;
        const alpha = Math.max(0.04, 0.6 * (1 - t * (0.4 + 0.6 * taper)));
        ctx.beginPath();
        ARROW.forEach(([ax, ay], k) => {
          const x = pts[i].x + ax * sc, y = pts[i].y + ay * sc;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = rgba(col, 1);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = rgba(col, 1);
        ctx.lineWidth = 1;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const drawComet = (now: number) => {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const t = (now - p.born) / p.life;
        if (t >= 1) continue;
        const col = gradient ? mix(c1, c2, t) : c1;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * (1 - t * 0.6)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const r = Math.max(2, headSize / 2);
      const hx = target.x, hy = target.y;
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 2);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.35, rgba(c1, 0.8));
      g.addColorStop(1, rgba(gradient ? c2 : c1, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hx, hy, r * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    };

    const draw = (now: number) => {
      clear();
      if (!visible) return;
      if (style === 'ribbon') drawRibbon();
      else if (style === 'pixel') drawPixel(now);
      else if (style === 'ghost') drawGhost();
      else if (style === 'comet') drawComet(now);
      else drawDots();
    };

    // 수명이 다한 사각형·입자 제거
    const prune = (now: number) => {
      for (let i = squares.length - 1; i >= 0; i--) if (now - squares[i].born >= pixelLife) squares.splice(i, 1);
      for (let i = particles.length - 1; i >= 0; i--) if (now - particles[i].born >= particles[i].life) particles.splice(i, 1);
    };

    const spawnParticles = (now: number) => {
      if (Math.hypot(vel.x, vel.y) < 0.5) return;
      const count = 1 + Math.floor(nodes / 10);
      const size = Math.max(1, (headSize * (1 - taper)) / 2);
      for (let k = 0; k < count && particles.length < maxParticles; k++) {
        const back = 0.08 + Math.random() * 0.1;
        particles.push({
          x: target.x + (Math.random() - 0.5) * headSize * 0.5,
          y: target.y + (Math.random() - 0.5) * headSize * 0.5,
          vx: -vel.x * back + (Math.random() - 0.5) * 0.6,
          vy: -vel.y * back + (Math.random() - 0.5) * 0.6,
          born: now,
          life: cometLife * (0.6 + Math.random() * 0.4),
          size: size * (0.6 + Math.random() * 0.4),
        });
      }
    };

    const tick = () => {
      raf = 0;
      const now = performance.now();
      let animating = false;
      pts[0].x = target.x;
      pts[0].y = target.y;
      for (let i = 1; i < n; i++) {
        const dx = pts[i - 1].x - pts[i].x;
        const dy = pts[i - 1].y - pts[i].y;
        pts[i].x += dx * ease;
        pts[i].y += dy * ease;
        if (Math.abs(dx) > SETTLE_EPS || Math.abs(dy) > SETTLE_EPS) animating = true;
      }
      if (style === 'pixel') {
        prune(now);
        animating = squares.length > 0; // 사각형이 남아 있는 동안만 루프 유지
      } else if (style === 'comet') {
        if (moved) { spawnParticles(now); moved = false; }
        else vel = { x: 0, y: 0 };
        for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy *= 0.96; }
        prune(now);
        animating = particles.length > 0;
      }
      draw(now);
      if (animating) raf = requestAnimationFrame(tick); // 다 모이면 루프 중단
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      vel = { x: e.clientX - target.x, y: e.clientY - target.y };
      target.x = e.clientX;
      target.y = e.clientY;
      moved = true;
      if (style === 'pixel') {
        // 지나온 칸마다 사각형 생성 (빠르게 움직여도 끊기지 않게 보간)
        const cx = Math.floor(e.clientX / cell), cy = Math.floor(e.clientY / cell);
        const from = lastCell ?? { x: cx, y: cy };
        const steps = Math.min(40, Math.max(Math.abs(cx - from.x), Math.abs(cy - from.y)));
        const now = performance.now();
        for (let k = lastCell ? 1 : 0; k <= Math.max(1, steps); k++) {
          const f = steps ? k / steps : 1;
          const sx = Math.round(from.x + (cx - from.x) * f), sy = Math.round(from.y + (cy - from.y) * f);
          if (lastCell && sx === lastCell.x && sy === lastCell.y) continue;
          squares.push({ cx: sx, cy: sy, born: now });
          lastCell = { x: sx, y: sy };
        }
        if (squares.length > maxSquares) squares.splice(0, squares.length - maxSquares);
      }
      if (!visible) {
        // 처음 나타날 때는 모든 점을 포인터 위치에서 시작
        pts.forEach((p) => { p.x = e.clientX; p.y = e.clientY; });
        visible = true;
        vel = { x: 0, y: 0 };
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const hide = () => {
      visible = false;
      lastCell = null;
      squares.length = 0;
      particles.length = 0;
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
  }, [active, nodes, ease, headSize, taper, gradient, style, settings.themeId]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999] h-screen w-screen"
    />
  );
}
