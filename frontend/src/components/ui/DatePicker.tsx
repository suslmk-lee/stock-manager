import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * 날짜 입력 (YYYY-MM-DD).
 * 브라우저 기본 달력 대신 크게 보이는 달력을 띄우고, 날짜를 누르면 바로 입력하고 닫는다.
 * - 머리의 "2026년 11월"을 누르면 월 선택으로 바뀐다 (지난 날짜를 빨리 고를 때)
 * - 키보드: ←→↑↓ 하루·일주일, PageUp/PageDown 한 달, Enter 선택, Esc 닫기
 * 달력은 body 에 띄워 모달의 스크롤 영역에 잘리지 않는다.
 */
interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  /** 비울 수 있는 칸이면 달력에 '지우기'를 보여 준다 */
  clearable?: boolean;
  /** 입력칸 버튼에 더할 클래스 (input-field 는 기본) */
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
const toStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
};

/** 2026. 11. 9. (월) */
export function formatDateLabel(s: string): string {
  const d = parse(s);
  if (!d) return s;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. (${WEEKDAYS[d.getDay()]})`;
}

const POPOVER_W = 320;
const POPOVER_H = 392;

export default function DatePicker({ value, onChange, min, max, placeholder = '날짜 선택', clearable, className = '', ariaLabel, disabled }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'days' | 'months'>('days');
  const [cursor, setCursor] = useState<Date>(() => parse(value) ?? new Date()); // 키보드로 옮기는 날 (보이는 달도 이 날 기준)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());

  const today = toStr(new Date());
  const outOfRange = useCallback((s: string) => (!!min && s < min) || (!!max && s > max), [min, max]);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - POPOVER_W - 8));
    const below = r.bottom + 6;
    const top = below + POPOVER_H > vh - 8 && r.top - 6 - POPOVER_H > 8 ? r.top - 6 - POPOVER_H : Math.max(8, Math.min(below, vh - POPOVER_H - 8));
    setPos({ top, left });
  }, []);

  const openPicker = () => {
    if (disabled) return;
    setCursor(parse(value) ?? new Date());
    setView('days');
    setOpen(true);
  };
  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);
  const pick = (s: string) => {
    if (outOfRange(s)) return;
    onChange(s);
    close(true);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // 모달의 Esc 닫기보다 달력이 먼저 닫힌다
        close(true);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, close, place]);

  // 열리면(또는 키보드로 옮기면) 해당 날짜 칸에 초점
  useEffect(() => {
    if (open && view === 'days') dayRefs.current.get(toStr(cursor))?.focus({ preventScroll: true });
  }, [open, view, cursor]);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const move: Record<string, () => Date> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
    };
    if (move[e.key]) {
      e.preventDefault();
      setCursor(move[e.key]());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(toStr(cursor));
    }
  };

  // 보이는 달의 6주 (일요일 시작)
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  const navBtn = 'inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPicker())}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`input-field flex items-center justify-between gap-2 text-left disabled:opacity-50 ${className}`}
      >
        <span className={`num truncate ${value ? '' : 'text-zinc-600'}`}>{value ? formatDateLabel(value) : placeholder}</span>
        <CalendarDays className="h-4 w-4 shrink-0 text-zinc-500" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="날짜 선택"
            className="surface fixed z-[70] p-3 shadow-[0_18px_50px_rgb(0_0_0/0.55)]"
            style={{ top: pos.top, left: pos.left, width: POPOVER_W }}
            onClick={(e) => e.stopPropagation()}
          >
            {view === 'days' ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <button type="button" className={navBtn} onClick={() => setCursor(addMonths(cursor, -1))} aria-label="이전 달">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button type="button" className="rounded-xl px-3 py-1.5 text-[15px] font-semibold text-white transition-colors hover:bg-white/[0.08]" onClick={() => setView('months')} title="월 고르기">
                    {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
                  </button>
                  <button type="button" className={navBtn} onClick={() => setCursor(addMonths(cursor, 1))} aria-label="다음 달">
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 pb-1">
                  {WEEKDAYS.map((w, i) => (
                    <span key={w} className={`py-1 text-center text-xs font-medium ${i === 0 ? 'text-rose-300' : i === 6 ? 'text-sky-300' : 'text-zinc-500'}`}>
                      {w}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1" role="grid" onKeyDown={onGridKey}>
                  {cells.map((d) => {
                    const s = toStr(d);
                    const inMonth = d.getMonth() === cursor.getMonth();
                    const selected = s === value;
                    const isToday = s === today;
                    const isCursor = s === toStr(cursor);
                    const blocked = outOfRange(s);
                    const dow = d.getDay();
                    return (
                      <button
                        key={s}
                        ref={(el) => {
                          if (el) dayRefs.current.set(s, el);
                          else dayRefs.current.delete(s);
                        }}
                        type="button"
                        role="gridcell"
                        aria-selected={selected}
                        aria-label={formatDateLabel(s)}
                        tabIndex={isCursor ? 0 : -1}
                        disabled={blocked}
                        onClick={() => pick(s)}
                        className={`num h-10 rounded-xl text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70 disabled:cursor-not-allowed disabled:opacity-25 ${
                          selected
                            ? 'bg-mint-400 font-semibold text-ink-950'
                            : `${isToday ? 'ring-1 ring-inset ring-mint-400/60 ' : ''}hover:bg-white/[0.08] ${
                                !inMonth ? 'text-zinc-600' : dow === 0 ? 'text-rose-300' : dow === 6 ? 'text-sky-300' : 'text-zinc-100'
                              }`
                        }`}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <button type="button" className={navBtn} onClick={() => setCursor(addMonths(cursor, -12))} aria-label="이전 해">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className="text-[15px] font-semibold text-white">{cursor.getFullYear()}년</span>
                  <button type="button" className={navBtn} onClick={() => setCursor(addMonths(cursor, 12))} aria-label="다음 해">
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 py-2">
                  {Array.from({ length: 12 }, (_, m) => {
                    const active = m === cursor.getMonth();
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setCursor(new Date(cursor.getFullYear(), m, Math.min(cursor.getDate(), new Date(cursor.getFullYear(), m + 1, 0).getDate())));
                          setView('days');
                        }}
                        className={`h-[60px] rounded-xl text-[15px] transition-colors ${active ? 'bg-mint-400/20 font-semibold text-white ring-1 ring-inset ring-mint-400/50' : 'text-zinc-200 hover:bg-white/[0.08]'}`}
                      >
                        {m + 1}월
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-white/[0.07] pt-2.5">
              <button type="button" className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-mint-300 transition-colors hover:bg-mint-400/10 disabled:opacity-30" onClick={() => pick(today)} disabled={outOfRange(today)}>
                오늘
              </button>
              <div className="flex gap-1">
                {clearable && value && (
                  <button
                    type="button"
                    className="rounded-lg px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white"
                    onClick={() => {
                      onChange('');
                      close(true);
                    }}
                  >
                    지우기
                  </button>
                )}
                <button type="button" className="rounded-lg px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white" onClick={() => close(true)}>
                  닫기
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
