import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface SplitViewProps {
  list: ReactNode;
  detail: ReactNode;
  /** 좁은 화면에서 상세를 보여 줄지 (보통 "선택된 항목이 있음") */
  showDetail: boolean;
  /** 좁은 화면의 상세에서 목록으로 돌아가기 */
  onBack: () => void;
  backLabel?: string;
  /** 넓은 화면에서 목록 칸 폭(px) */
  listWidth?: number;
  /** 이 폭(px) 이상이면 목록과 상세를 나란히 놓는다 */
  minSplitWidth?: number;
  /** 나란히 놓는지 여부가 바뀔 때 (부모가 기본 선택 등을 정할 때 쓴다) */
  onSplitChange?: (split: boolean) => void;
}

/**
 * 목록-상세 2단 배치.
 * - 넓은 화면: 왼쪽 목록 + 오른쪽 상세. 두 칸이 창 높이에 맞춰 각자 스크롤한다.
 * - 좁은 화면: 목록 화면과 상세 화면을 전환한다 (상세 위에 '목록으로' 버튼).
 * 높이는 Dashboard 가 상단 바 높이를 --app-header-h 로 알려 준다.
 */
export default function SplitView({
  list,
  detail,
  showDetail,
  onBack,
  backLabel = '목록으로',
  listWidth = 480,
  minSplitWidth = 900,
  onSplitChange,
}: SplitViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  // null = 아직 폭을 재지 않음. 그리기 전에 재서 첫 화면부터 맞는 배치를 쓴다.
  const [split, setSplit] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSplit(el.clientWidth >= minSplitWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minSplitWidth]);

  useEffect(() => {
    if (split !== null) onSplitChange?.(split);
  }, [split, onSplitChange]);

  return (
    <div ref={ref}>
      {split === null ? null : split ? (
        <div className="surface flex min-h-[520px] overflow-hidden" style={{ height: 'calc(100vh - var(--app-header-h, 56px) - 3rem)' }}>
          <div className="flex min-h-0 shrink-0 flex-col border-r border-white/[0.07]" style={{ width: listWidth }}>
            {list}
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-6">{detail}</div>
        </div>
      ) : showDetail ? (
        <div className="surface p-4 sm:p-5">
          <button type="button" onClick={onBack} className="btn-ghost mb-4 !px-3 !py-1.5 !text-xs">
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </button>
          {detail}
        </div>
      ) : (
        <div className="surface overflow-hidden">{list}</div>
      )}
    </div>
  );
}
