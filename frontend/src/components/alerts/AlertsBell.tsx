import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import type { SignalEvent } from '../../types/models';
import { useAlerts } from './AlertsProvider';
import { eventTone, relativeTime, shortLabel } from './alertMeta';

function Row({ event, onOpen }: { event: SignalEvent; onOpen: () => void }) {
  const tone = eventTone(event);
  const unread = !event.read_at;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.07] ${unread ? 'bg-white/[0.07] shadow-[inset_2px_0_0_rgb(var(--c-mint-400))]' : ''}`}
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot} ${unread ? '' : 'opacity-50'}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-sm ${unread ? 'font-semibold text-white' : 'font-medium text-zinc-300'}`}>{event.name}</span>
            <span className="label-mono shrink-0">{event.ticker}</span>
          </span>
          <span className={`mt-0.5 line-clamp-2 block text-xs leading-relaxed ${unread ? 'text-zinc-300' : 'text-zinc-500'}`}>{event.message}</span>
          <span className="mt-1 flex items-center gap-2">
            <span className={`text-[11px] font-medium ${tone.text}`}>{shortLabel(event.to_action)}</span>
            <span className="text-[11px] text-zinc-500">{relativeTime(event.created_at)}</span>
          </span>
        </span>
        {unread && <span className="sr-only">읽지 않음</span>}
      </button>
    </li>
  );
}

export default function AlertsBell() {
  const { unreadCount, events, refresh, markRead, openEvent, openSettings } = useAlerts();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    refresh();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, refresh]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="알림"
        aria-label={unreadCount > 0 ? `알림 (읽지 않은 ${unreadCount}건)` : '알림'}
        aria-expanded={open}
        className="glass-pill relative flex h-9 w-9 items-center justify-center text-zinc-400 transition-colors hover:text-white"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-ink-950">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="알림"
          className="surface animate-fade-up fixed inset-x-3 top-16 z-40 flex max-h-[70vh] flex-col overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[380px]"
        >
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <h2 className="text-sm font-semibold text-white">알림</h2>
            <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" disabled={unreadCount === 0} onClick={() => markRead('all')}>
              모두 읽음
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {events.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <BellOff className="h-5 w-5 text-zinc-500" />
                <p className="text-sm text-zinc-400">아직 알림이 없습니다.</p>
                <p className="label-mono">매매 신호가 바뀌면 여기에 표시됩니다</p>
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {events.map((e) => (
                  <Row
                    key={e.id}
                    event={e}
                    onOpen={() => {
                      openEvent(e);
                      setOpen(false);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-white/[0.08] px-4 py-2.5 text-right">
            <button
              type="button"
              className="text-xs text-zinc-400 transition-colors hover:text-white"
              onClick={() => {
                setOpen(false);
                openSettings();
              }}
            >
              알림 설정
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
