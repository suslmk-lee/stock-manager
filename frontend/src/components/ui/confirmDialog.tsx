import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 앱 안에서 그리는 확인 창 — window.confirm 대신.
 * 맥 앱(Wails 의 WKWebView)은 confirm 창을 띄워 주지 않고 바로 '취소'로 돌려줘서, confirm 을 거친 삭제 버튼이 눌리지 않았다.
 * 첫 줄은 제목, 나머지 줄은 설명으로 보인다.
 */
export function askConfirm(message: string, opts: { confirmText?: string; danger?: boolean } = {}): Promise<boolean> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  return new Promise<boolean>((resolve) => {
    const close = (ok: boolean) => {
      root.unmount();
      host.remove();
      resolve(ok);
    };
    root.render(<ConfirmDialog message={message} confirmText={opts.confirmText ?? '삭제'} danger={opts.danger ?? true} onClose={close} />);
  });
}

function ConfirmDialog({ message, confirmText, danger, onClose }: { message: string; confirmText: string; danger: boolean; onClose: (ok: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const [title, ...rest] = message.split('\n');
  const body = rest.join('\n').trim();

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose(false);
      }
    };
    // 캡처 단계에서 받아 뒤에 열린 모달의 Esc 처리보다 먼저 (확인 창만 닫히게)
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => onClose(false)}>
      <div className="surface w-full max-w-sm px-5 py-5" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <p className="text-[15px] font-semibold text-white">{title}</p>
        {body && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-400">{body}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => onClose(false)} className="btn-ghost flex-1 px-4 py-2">
            취소
          </button>
          <button ref={okRef} type="button" onClick={() => onClose(true)} className={`${danger ? 'btn-danger' : 'btn-primary'} flex-1 px-4 py-2`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
