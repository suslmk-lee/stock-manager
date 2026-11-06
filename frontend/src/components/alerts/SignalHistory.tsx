import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, History, Lightbulb } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { SignalEvent } from '../../types/models';
import { useAlerts } from './AlertsProvider';
import { clockTime, dayKey, dayLabel, eventTone, isCleared, isSuggestion, shortLabel, toneOf } from './alertMeta';

function HistoryItem({ event }: { event: SignalEvent }) {
  const cleared = isCleared(event);
  const to = eventTone(event);
  const suggestion = isSuggestion(event);
  const from = !suggestion && event.from_action ? toneOf(event.from_action) : null;
  return (
    <li className={`flex items-start gap-3 py-3 ${cleared ? 'opacity-60' : ''}`}>
      <span className="num w-11 shrink-0 pt-0.5 text-xs text-zinc-500">{clockTime(event.created_at)}</span>
      <span className="relative mt-1.5 flex shrink-0 items-center">
        {suggestion ? <Lightbulb className={`-ml-0.5 h-3 w-3 ${to.text}`} /> : <span className={`h-2 w-2 rounded-full ${to.dot}`} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm font-medium ${cleared ? 'text-zinc-400' : 'text-white'}`}>{event.name}</span>
          <span className="label-mono">{event.ticker}</span>
          <span className="inline-flex items-center gap-1">
            {from && (
              <>
                <span className={`badge ${from.badge}`}>{shortLabel(event.from_action)}</span>
                <ArrowRight className="h-3 w-3 text-zinc-500" />
              </>
            )}
            <span className={`badge ${to.badge}`}>{shortLabel(event.to_action)}</span>
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{event.message}</p>
      </div>
    </li>
  );
}

/**
 * 신호 이력.
 * - assetId: 그 종목의 이력만 보여 준다 (최근 이력 200건 안에서 거른다)
 * - embedded: 상세 패널 탭 안에 넣을 때 — 테두리·접기 머리글 없이 목록만
 */
export default function SignalHistory({ assetId, embedded = false }: { assetId?: number; embedded?: boolean } = {}) {
  const { events: recent } = useAlerts();
  const [open, setOpen] = useState(true);
  const [events, setEvents] = useState<SignalEvent[] | null>(null);
  const [error, setError] = useState(false);

  // 새 알림이 생기면(알림함 목록이 바뀌면) 이력도 다시 불러온다
  const latestId = recent[0]?.id ?? 0;
  const limit = assetId ? 200 : 50;
  useEffect(() => {
    let cancelled = false;
    apiClient
      .GetSignalEvents(limit, false)
      .then((r) => {
        if (!cancelled) {
          setEvents(r.events ?? []);
          setError(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load signal history:', err);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [latestId, limit]);

  const shown = useMemo(() => (events && assetId ? events.filter((e) => e.asset_id === assetId) : events), [events, assetId]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: SignalEvent[] }>();
    for (const e of shown ?? []) {
      const k = dayKey(e.created_at);
      if (!map.has(k)) map.set(k, { label: dayLabel(e.created_at), items: [] });
      map.get(k)!.items.push(e);
    }
    return [...map.values()];
  }, [shown]);

  const list =
    error && !shown ? (
      <p className="py-6 text-center text-sm text-zinc-400">신호 이력을 불러오지 못했습니다.</p>
    ) : !shown ? (
      <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
    ) : groups.length === 0 ? (
      <p className="py-6 text-center text-sm text-zinc-400">
        {assetId ? '이 종목의 신호 변화 기록이 없습니다.' : '아직 기록된 신호 변화가 없습니다.'}
      </p>
    ) : (
      groups.map((g) => (
        <div key={g.label} className="mt-1">
          <div className="label-mono mt-3 border-b border-white/[0.06] pb-1.5">{g.label}</div>
          <ul className="divide-y divide-white/[0.04]">
            {g.items.map((e) => (
              <HistoryItem key={e.id} event={e} />
            ))}
          </ul>
        </div>
      ))
    );

  if (embedded) return <div aria-label="신호 이력">{list}</div>;

  return (
    <section className="surface mt-6 p-4 sm:p-5" aria-label="신호 이력">
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex items-center gap-2.5">
          <History className="h-4 w-4 text-zinc-400" />
          <span className="text-base font-semibold tracking-tight text-white">신호 이력</span>
          {shown && <span className="label-mono">최근 {shown.length}건</span>}
        </span>
        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && <div className="mt-3">{list}</div>}
    </section>
  );
}
