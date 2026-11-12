import { useEffect, useRef } from 'react';
import { Delete } from 'lucide-react';
import { PIN_LENGTH } from './pin';

interface PinPadProps {
  value: string;
  onChange: (v: string) => void;
  /** 6자리가 채워지는 순간 */
  onComplete?: (v: string) => void;
  disabled?: boolean;
  /** 값이 바뀔 때마다 점이 좌우로 흔들린다 (틀렸을 때) */
  shake?: number;
  /** 점 아래 숫자판을 보여 줄지 (키보드 입력은 언제나 받는다) */
  keypad?: boolean;
  label: string;
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/** 6자리 PIN 입력: 점 6개 + 숫자판. 키보드 숫자·Backspace·Esc(지우기)도 받는다. */
export default function PinPad({ value, onChange, onComplete, disabled = false, shake = 0, keypad = true, label }: PinPadProps) {
  const dotsRef = useRef<HTMLDivElement>(null);
  // 키보드 처리기가 늘 최신 값을 보도록
  const state = useRef({ value, disabled, onChange, onComplete });
  state.current = { value, disabled, onChange, onComplete };

  const press = (key: string) => {
    const { value: v, disabled: off, onChange: change, onComplete: complete } = state.current;
    if (off) return;
    if (key === 'back') return change(v.slice(0, -1));
    if (key === 'clear') return change('');
    if (!/^\d$/.test(key) || v.length >= PIN_LENGTH) return;
    const next = v + key;
    change(next);
    if (next.length === PIN_LENGTH) complete?.(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Escape') press('clear');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!shake) return;
    dotsRef.current?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
      { duration: 380, easing: 'ease-out' },
    );
  }, [shake]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
  return (
    <div className={disabled ? 'opacity-60' : ''}>
      <div ref={dotsRef} className="flex justify-center gap-3.5" role="status" aria-label={`${label}: ${PIN_LENGTH}자리 중 ${value.length}자리 입력`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full border transition-colors duration-150 ${
              i < value.length ? 'border-mint-400 bg-mint-400 shadow-[0_0_10px_rgb(var(--c-mint-400)/0.45)]' : 'border-white/25 bg-transparent'
            }`}
          />
        ))}
      </div>
      {keypad && (
        <div className="mx-auto mt-8 grid w-fit grid-cols-3 gap-x-5 gap-y-3.5">
          {keys.map((k, i) =>
            k === '' ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onClick={() => press(k)}
                aria-label={k === 'back' ? '한 자리 지우기' : k}
                className={`flex h-16 w-16 items-center justify-center rounded-full transition-colors active:scale-95 disabled:cursor-not-allowed ${
                  k === 'back' ? 'text-zinc-400 hover:text-white' : 'num border border-white/[0.08] bg-white/[0.04] text-2xl font-light text-white hover:bg-white/[0.09]'
                }`}
              >
                {k === 'back' ? <Delete className="h-6 w-6" strokeWidth={1.5} /> : k}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
