import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

// 모달을 body 바로 아래에 렌더링한다.
// 카드의 backdrop-filter·transform 이 position: fixed 의 기준을 바꿔 모달이 화면 중앙에서 벗어나는 것을 막는다.
export default function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
