import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PageSlots {
  lead: HTMLElement | null;
  actions: HTMLElement | null;
}

const PageSlotsContext = createContext<PageSlots>({ lead: null, actions: null });

export const PageSlotsProvider = PageSlotsContext.Provider;

/**
 * 페이지의 머리말 도구를 상단 바로 올린다.
 * - lead: 페이지 제목 바로 옆 (계좌 선택처럼 페이지 범위를 정하는 것)
 * - children: 상단 바 오른쪽 (추가·새로고침 같은 동작 버튼, 필터)
 * 포털이라 상태와 이벤트는 그대로 페이지 컴포넌트에 남는다.
 */
export function PageActions({ lead, children }: { lead?: ReactNode; children?: ReactNode }) {
  const slots = useContext(PageSlotsContext);
  return (
    <>
      {lead && slots.lead ? createPortal(lead, slots.lead) : null}
      {children && slots.actions ? createPortal(children, slots.actions) : null}
    </>
  );
}
