import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { SignalEvent } from '../../types/models';
import { useAlerts } from './AlertsProvider';
import { eventTone, shortLabel } from './alertMeta';

const MAX_VISIBLE = 3;
const DURATION_MS = 6000;

function Toast({ event }: { event: SignalEvent }) {
  const { dismissToast, openEvent } = useAlerts();
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(DURATION_MS);

  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const t = window.setTimeout(() => dismissToast(event.id), remainingRef.current);
    return () => {
      window.clearTimeout(t);
      remainingRef.current = Math.max(800, remainingRef.current - (Date.now() - start));
    };
  }, [paused, dismissToast, event.id]);

  const tone = eventTone(event);

  return (
    <div
      role="status"
      className="toast-in surface pointer-events-auto flex w-full max-w-sm items-start gap-3 !rounded-2xl p-3.5 shadow-2xl sm:w-80"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => openEvent(event)}>
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">{event.name}</span>
            <span className={`badge shrink-0 ${tone.badge}`}>{shortLabel(event.to_action)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-zinc-400">{event.message}</span>
        </span>
      </button>
      <button type="button" className="btn-icon !h-6 !w-6 shrink-0" aria-label="알림 닫기" onClick={() => dismissToast(event.id)}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function ToastStack() {
  const { toasts } = useAlerts();
  const visible = toasts.slice(0, MAX_VISIBLE);
  if (visible.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end">
      {visible.map((e) => (
        <Toast key={e.id} event={e} />
      ))}
    </div>
  );
}
