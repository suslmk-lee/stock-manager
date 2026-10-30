import { useEffect, useRef } from 'react';
import { useAppearance } from '../../appearance/AppearanceContext';

// 네이티브 커서를 대체하는 포인터 프리셋 (설정에서 'native'가 아닐 때만 동작)
const SETTLE_EPS = 0.05;
const INTERACTIVE = 'a, button, [role=button], [role=switch], select, label, summary, input[type=checkbox], input[type=range]';
const TEXT_INPUT = 'input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=""], [contenteditable=true]';

// 네이티브 커서 숨김 규칙: 텍스트 입력류는 기본 캐럿 커서를 유지한다
const HIDE_CSS = `
html[data-cursor=custom], html[data-cursor=custom] * { cursor: none !important; }
html[data-cursor=custom] input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=button]):not([type=submit]),
html[data-cursor=custom] textarea,
html[data-cursor=custom] [contenteditable=""],
html[data-cursor=custom] [contenteditable=true],
html[data-cursor=custom] [contenteditable=true] * { cursor: text !important; }
html[data-cursor=custom] select { cursor: default !important; }
`;

function readRgb(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? `rgb(${v[0]} ${v[1]} ${v[2]})` : fallback;
}

export default function CursorPointer() {
  const { settings } = useAppearance();
  const style = settings.cursorPointer.style;
  const rootRef = useRef<HTMLDivElement>(null);
  const active = style !== 'native';

  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return;
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const accent = readRgb('--c-mint-400', 'rgb(45 212 191)');
    const q = (k: string) => root.querySelector<HTMLElement>(`[data-k=${k}]`);

    const styleEl = document.createElement('style');
    styleEl.textContent = HIDE_CSS;
    document.head.appendChild(styleEl);
    document.documentElement.setAttribute('data-cursor', 'custom');

    const target = { x: 0, y: 0 };
    const pos = { x: 0, y: 0 };
    let vx = 0, vy = 0; // 평활화된 속도
    let ringScale = 1, ringTarget = 1, pressed = false;
    let look = { x: 0, y: 0 }; // 눈동자 방향 (평활화)
    let shown = false, raf = 0, blinkTimer = 0;
    const ease = reduced ? 1 : style === 'squish' ? 0.35 : 0.18;

    const dot = q('dot'), ring = q('ring'), blob = q('blob');
    const lineH = q('lh'), lineV = q('lv'), reticle = q('ret'), label = q('lbl');
    const eyes = q('eyes'), pupils = [q('p0'), q('p1')], lids = [q('e0'), q('e1')];

    const setVisible = (v: boolean) => { root.style.opacity = v ? '1' : '0'; };

    const render = () => {
      if (style === 'dot-ring') {
        if (dot) dot.style.transform = `translate3d(${target.x}px,${target.y}px,0) translate(-50%,-50%)`;
        if (ring) ring.style.transform = `translate3d(${pos.x}px,${pos.y}px,0) translate(-50%,-50%) scale(${ringScale})`;
      } else if (style === 'squish' && blob) {
        const speed = Math.hypot(vx, vy);
        const stretch = reduced ? 0 : Math.min(speed / 40, 0.8);
        const ang = (Math.atan2(vy, vx) * 180) / Math.PI;
        blob.style.transform = `translate3d(${pos.x}px,${pos.y}px,0) translate(-50%,-50%) rotate(${ang}deg) scale(${1 + stretch},${1 / (1 + stretch * 0.6)})`;
      } else if (style === 'crosshair') {
        if (lineH) lineH.style.transform = `translate3d(0,${target.y}px,0)`;
        if (lineV) lineV.style.transform = `translate3d(${target.x}px,0,0)`;
        if (reticle) reticle.style.transform = `translate3d(${target.x}px,${target.y}px,0) translate(-50%,-50%)`;
        if (label) {
          label.style.transform = `translate3d(${target.x + 12}px,${target.y + 12}px,0)`;
          label.textContent = `${Math.round(target.x)}, ${Math.round(target.y)}`;
        }
      } else if (style === 'eyes' && eyes) {
        eyes.style.transform = `translate3d(${pos.x}px,${pos.y}px,0) translate(-50%,-115%)`;
        pupils.forEach((p) => { if (p) p.style.transform = `translate(${look.x * 2.5}px,${look.y * 3}px)`; });
      }
    };

    const tick = () => {
      raf = 0;
      let moving = false;
      const dx = target.x - pos.x, dy = target.y - pos.y;
      pos.x += dx * ease;
      pos.y += dy * ease;
      if (!reduced && (Math.abs(dx) > SETTLE_EPS || Math.abs(dy) > SETTLE_EPS)) moving = true;

      // 속도: 이동량을 평활화해 정지하면 0으로 수렴
      vx += (dx * ease - vx) * 0.35;
      vy += (dy * ease - vy) * 0.35;
      if (reduced) { vx = 0; vy = 0; }
      else if (Math.hypot(vx, vy) > 0.05) moving = true;
      else { vx = 0; vy = 0; }

      if (style === 'dot-ring') {
        const goal = pressed ? ringTarget * 0.7 : ringTarget;
        ringScale = reduced ? goal : ringScale + (goal - ringScale) * 0.25;
        if (Math.abs(goal - ringScale) > 0.005) moving = true;
      }
      if (style === 'eyes') {
        const sp = Math.hypot(dx, dy);
        const gx = sp > 0.5 ? dx / sp : 0, gy = sp > 0.5 ? dy / sp : 0;
        look.x += (gx - look.x) * 0.2;
        look.y += (gy - look.y) * 0.2;
        if (Math.hypot(look.x, look.y) > 0.01) moving = true;
        else look = { x: 0, y: 0 };
      }
      render();
      if (moving) raf = requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

    const applyHover = (t: EventTarget | null) => {
      const el = t instanceof Element ? t : null;
      setVisible(shown && !el?.closest(TEXT_INPUT));
      if (style === 'dot-ring') {
        ringTarget = el?.closest(INTERACTIVE) ? 1.6 : 1;
        if (ring) ring.style.background = ringTarget > 1 ? `color-mix(in srgb, ${accent} 15%, transparent)` : 'transparent';
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      target.x = e.clientX;
      target.y = e.clientY;
      if (!shown) { pos.x = e.clientX; pos.y = e.clientY; shown = true; }
      applyHover(e.target);
      kick();
    };
    const onDown = (e: PointerEvent) => { if (e.pointerType === 'touch') return; pressed = true; kick(); };
    const onUp = () => { pressed = false; kick(); };
    const hide = () => { shown = false; setVisible(false); };
    const onOut = (e: MouseEvent) => { if (!e.relatedTarget) hide(); };

    // 눈 깜빡임 (모션 감소 시 생략)
    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        lids.forEach((l) => { if (l) l.style.transform = 'scaleY(0.1)'; });
        blinkTimer = window.setTimeout(() => {
          lids.forEach((l) => { if (l) l.style.transform = 'scaleY(1)'; });
          scheduleBlink();
        }, 120);
      }, 4000 + Math.random() * 2000);
    };
    if (style === 'eyes' && !reduced) scheduleBlink();

    setVisible(false);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('mouseout', onOut);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('blur', hide);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(blinkTimer);
      document.documentElement.removeAttribute('data-cursor');
      styleEl.remove();
    };
  }, [active, style, settings.themeId]);

  if (!active) return null;

  const accent = 'rgb(var(--c-mint-400))';
  const abs = 'absolute left-0 top-0 pointer-events-none will-change-transform';
  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden"
      style={{ opacity: 0 }}
    >
      {style === 'dot-ring' && (
        <>
          <div data-k="ring" className={`${abs} h-8 w-8 rounded-full`} style={{ border: `1.5px solid ${accent}`, transition: 'background 150ms' }} />
          <div data-k="dot" className={`${abs} h-1.5 w-1.5 rounded-full`} style={{ background: accent }} />
        </>
      )}
      {style === 'squish' && (
        <div data-k="blob" className={`${abs} h-[18px] w-[18px] rounded-full`} style={{ background: accent, opacity: 0.9 }} />
      )}
      {style === 'crosshair' && (
        <>
          <div data-k="lh" className={`${abs} h-px w-full`} style={{ background: accent, opacity: 0.35 }} />
          <div data-k="lv" className={`${abs} h-full w-px`} style={{ background: accent, opacity: 0.35 }} />
          <div data-k="ret" className={`${abs} h-3.5 w-3.5`} style={{ border: `1px solid ${accent}` }} />
          <div data-k="lbl" className={`${abs} font-mono text-[10px] leading-none`} style={{ color: accent, fontFamily: 'var(--font-mono, ui-monospace, monospace)' }} />
        </>
      )}
      {style === 'eyes' && (
        <div data-k="eyes" className={`${abs} flex gap-0.5`}>
          {[0, 1].map((i) => (
            <div
              key={i}
              data-k={`e${i}`}
              className="relative flex h-[18px] w-[12px] items-center justify-center rounded-full"
              style={{ background: '#f4f4f5', border: '1px solid #27272a', transition: 'transform 80ms' }}
            >
              <div data-k={`p${i}`} className="h-[6px] w-[6px] rounded-full" style={{ background: '#18181b' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
