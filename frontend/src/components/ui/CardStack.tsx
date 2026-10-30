import { Children, type ReactNode, useEffect, useRef } from 'react';

const GAP = 16; // 헤더 아래 여백
const PEEK = 10; // 뒤에 깔린 카드가 위로 드러나는 높이
const MAX_PEEK = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 스크롤하면 카드가 위에 차례로 쌓이고, 덮인 카드는 뒤로 작아지는 스택 목록.
export default function CardStack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const count = Children.count(children);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = () => Array.from(root.children) as HTMLElement[];
    let frame = 0;

    const update = () => {
      frame = 0;
      const els = items();
      const rects = els.map((el) => el.getBoundingClientRect());
      els.forEach((el, i) => {
        // 뒤 카드들이 이 카드를 덮은 정도 (카드 하나가 완전히 덮으면 1)
        let depth = 0;
        for (let j = i + 1; j < els.length; j++) {
          depth += clamp((rects[i].bottom - rects[j].top) / rects[i].height, 0, 1);
        }
        const card = el.firstElementChild as HTMLElement | null;
        if (!card) return;
        const d = Math.min(depth, 3);
        card.style.transform = d > 0 ? `scale(${1 - d * 0.04})` : '';
        card.style.filter = d > 0 ? `brightness(${1 - d * 0.15})` : '';
        card.style.opacity = depth > 2.5 ? String(clamp(3.5 - depth, 0, 1)) : '';
      });
    };

    const layout = () => {
      const header = document.querySelector<HTMLElement>('.app-header');
      const base = (header?.offsetHeight ?? 0) + GAP;
      items().forEach((el, i) => {
        const top = base + Math.min(i, MAX_PEEK) * PEEK;
        // 화면보다 긴 카드는 아랫부분까지 읽은 뒤에 멈춘다
        el.style.top = `${Math.min(top, window.innerHeight - el.offsetHeight - GAP)}px`;
      });
      update();
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const ro = new ResizeObserver(layout);
    items().forEach((el) => ro.observe(el));
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', layout);
    layout();
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', layout);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [count]);

  return (
    <div ref={ref} className="flex flex-col gap-4">
      {Children.map(children, (child) => (
        <div className="card-stack-item">
          <div className="card-stack-card">{child}</div>
        </div>
      ))}
    </div>
  );
}
