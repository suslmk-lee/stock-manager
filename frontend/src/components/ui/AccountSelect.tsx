import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { Account } from '../../types/models';
import { getAccountTypeMeta, isRestrictedAccount } from '../../utils/accountType';
import BrokerLogo from './BrokerLogo';

/**
 * 계좌 고르기 — 브라우저 기본 select 대신 증권사 로고와 계좌 유형을 보여 주는 목록.
 * 인출 가능 / 인출 제한(연금·IRP·DC)으로 나누고, 계좌가 많으면 위에 검색 칸을 둔다.
 * 키보드: ↑↓ 이동, Enter 선택, Esc 닫기. 목록은 body 에 띄워 모달 스크롤 영역에 잘리지 않는다.
 */
interface AccountSelectProps {
  accounts: Account[];
  /** 고른 계좌 id (0 이나 없는 id = 고르지 않음) */
  value: number;
  onChange: (id: number) => void;
  /** 고르지 않았을 때 보이는 글자 */
  placeholder?: string;
  /** 목록 맨 위에 '고르지 않음' 항목을 둔다 (값 0) */
  emptyOption?: string;
  ariaLabel?: string;
  /** sm = 상단 바용 낮은 높이 */
  size?: 'sm' | 'md';
  className?: string;
}

const SEARCH_FROM = 8; // 계좌가 이만큼 넘으면 검색 칸

function TypeChip({ account }: { account: Account }) {
  const meta = getAccountTypeMeta(account);
  if (meta.value === 'General') return null;
  return <span className={`badge shrink-0 !px-1.5 !py-0 text-[10px] ${meta.badgeClass}`}>{meta.short}</span>;
}

export default function AccountSelect({ accounts, value, onChange, placeholder = '계좌 선택', emptyOption, ariaLabel = '계좌', size = 'md', className = '' }: AccountSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = accounts.find((a) => a.id === value) ?? null;

  // 목록: (고르지 않음) + 인출 가능 + 인출 제한. 검색어는 계좌 이름·증권사·유형에서 찾는다
  type Row = { kind: 'empty' } | { kind: 'group'; label: string } | { kind: 'account'; account: Account };
  const { rows, options } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (a: Account) => !q || `${a.name} ${a.broker} ${getAccountTypeMeta(a).label}`.toLowerCase().includes(q);
    const liquid = accounts.filter((a) => !isRestrictedAccount(a) && hit(a));
    const restricted = accounts.filter((a) => isRestrictedAccount(a) && hit(a));
    const rows: Row[] = [];
    const options: number[] = []; // 키보드로 오가는 값 순서
    if (emptyOption && !q) {
      rows.push({ kind: 'empty' });
      options.push(0);
    }
    const both = liquid.length > 0 && restricted.length > 0;
    if (liquid.length) {
      if (both) rows.push({ kind: 'group', label: '인출 가능' });
      liquid.forEach((a) => {
        rows.push({ kind: 'account', account: a });
        options.push(a.id);
      });
    }
    if (restricted.length) {
      if (both || !liquid.length) rows.push({ kind: 'group', label: '인출 제한 (연금 · IRP · DC)' });
      restricted.forEach((a) => {
        rows.push({ kind: 'account', account: a });
        options.push(a.id);
      });
    }
    return { rows, options };
  }, [accounts, query, emptyOption]);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 340), vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const wanted = 460;
    if (below >= Math.min(wanted, 260) || below >= above) {
      setPos({ top: r.bottom + 6, left, width, maxH: Math.min(wanted, below) });
    } else {
      const maxH = Math.min(wanted, above);
      setPos({ top: r.top - 6 - maxH, left, width, maxH });
    }
  }, []);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openList = () => {
    const idx = options.indexOf(value);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const pick = (id: number) => {
    onChange(id);
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
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // 검색 칸이 있으면 바로 입력, 없으면 목록에서 키보드로
    (searchRef.current ?? listRef.current)?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, close, place]);

  // 검색하면 첫 항목부터
  useEffect(() => setActive(0), [query]);

  // 키보드로 옮긴 항목이 보이게
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-opt="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active] !== undefined) pick(options[active]);
    }
  };

  const logoBox = size === 'sm' ? 'h-6 w-11 !rounded-md' : 'h-7 w-12 !rounded-md';

  let optIndex = -1;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openList();
          }
        }}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`input-field flex min-w-0 items-center gap-2.5 text-left ${size === 'sm' ? '!w-auto !py-1 !pl-1.5 !pr-2.5' : '!py-1.5 !pl-2'} ${className}`}
      >
        {selected ? (
          <>
            <BrokerLogo broker={selected.broker} className={logoBox} />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate text-sm font-medium text-white">{selected.name}</span>
              <span className="hidden truncate text-xs text-zinc-500 sm:inline">{selected.broker}</span>
              <TypeChip account={selected} />
            </span>
          </>
        ) : (
          <span className="flex-1 truncate px-1 text-sm text-zinc-500">{value === 0 && emptyOption ? emptyOption : placeholder}</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="surface fixed z-[70] flex flex-col overflow-hidden p-1.5 shadow-[0_18px_50px_rgb(0_0_0/0.55)]"
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
            onKeyDown={onKey}
            onClick={(e) => e.stopPropagation()}
          >
            {accounts.length > SEARCH_FROM && (
              <div className="relative shrink-0 p-1 pb-1.5">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="계좌 · 증권사 검색"
                  aria-label="계좌 검색"
                  className="input-field !py-1.5 !pl-8 text-sm"
                />
              </div>
            )}
            <div ref={listRef} tabIndex={-1} role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto outline-none">
              {rows.length === 0 && <p className="px-3 py-6 text-center text-sm text-zinc-500">찾는 계좌가 없습니다</p>}
              {rows.map((row, i) => {
                if (row.kind === 'group') {
                  return (
                    <p key={`g-${i}`} className="label-mono px-2.5 pb-1 pt-2.5">
                      {row.label}
                    </p>
                  );
                }
                optIndex += 1;
                const idx = optIndex;
                const id = row.kind === 'empty' ? 0 : row.account.id;
                const isSel = id === value;
                const isActive = idx === active;
                return (
                  <button
                    key={row.kind === 'empty' ? 'empty' : row.account.id}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    data-opt={idx}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => pick(id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${isActive ? 'bg-white/[0.06]' : ''} ${isSel ? 'text-white' : 'text-zinc-200'}`}
                  >
                    {row.kind === 'empty' ? (
                      <span className="flex-1 px-1 py-1.5 text-sm text-zinc-400">{emptyOption}</span>
                    ) : (
                      <>
                        <BrokerLogo broker={row.account.broker} className="h-8 w-16 !rounded-md" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className={`truncate text-sm ${isSel ? 'font-semibold' : 'font-medium'}`}>{row.account.name}</span>
                            <TypeChip account={row.account} />
                          </span>
                          <span className="block truncate text-xs text-zinc-500">
                            {row.account.broker}
                            {row.account.currency ? ` · ${row.account.currency}` : ''}
                          </span>
                        </span>
                      </>
                    )}
                    {isSel && <Check className="h-4 w-4 shrink-0 text-mint-300" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
