import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiClient } from '../../api/client';
import { onSignalsNew } from '../../api/events';
import type { SignalEvent } from '../../types/models';
import NotificationSettings from './NotificationSettings';
import ToastStack from './ToastStack';

const isWeb = !(window as any).go;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const VISIBLE_RECHECK_MS = 5 * 60 * 1000;
const RECENT_LIMIT = 30;

export interface FocusRequest {
  assetId: number;
  nonce: number;
}

interface AlertsContextValue {
  unreadCount: number;
  events: SignalEvent[];
  toasts: SignalEvent[];
  focusRequest: FocusRequest | null;
  refresh: () => Promise<void>;
  markRead: (target: number[] | 'all') => Promise<void>;
  dismissToast: (id: number) => void;
  focusAsset: (assetId: number) => void;
  /** 알림 항목(토스트/알림함 행)을 눌렀을 때: 읽음 처리 + 해당 종목으로 이동 */
  openEvent: (e: SignalEvent) => void;
  openSettings: () => void;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

export function useAlerts(): AlertsContextValue {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error('useAlerts must be used within AlertsProvider');
  return ctx;
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [events, setEvents] = useState<SignalEvent[]>([]);
  const [toasts, setToasts] = useState<SignalEvent[]>([]);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastCheckRef = useRef(0);
  const nonceRef = useRef(0);
  const initRef = useRef(false);

  const pushToasts = useCallback((list: SignalEvent[]) => {
    if (list.length === 0) return;
    setToasts((prev) => {
      const seen = new Set(prev.map((t) => t.id));
      return [...prev, ...list.filter((e) => !seen.has(e.id))];
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await apiClient.GetSignalEvents(RECENT_LIMIT, false);
      setEvents(r.events ?? []);
      setUnreadCount(r.unread_count ?? 0);
    } catch (err) {
      console.error('Failed to load signal events:', err);
    }
  }, []);

  const refreshCount = useCallback(async () => {
    try {
      const r = await apiClient.GetUnreadSignalCount();
      setUnreadCount(r.unread_count ?? 0);
    } catch (err) {
      console.error('Failed to load unread count:', err);
    }
  }, []);

  const runCheck = useCallback(async () => {
    lastCheckRef.current = Date.now();
    try {
      const r = await apiClient.CheckSignals();
      setUnreadCount(r.unread_count ?? 0);
      const fresh = r.new_events ?? [];
      if (fresh.length > 0) {
        pushToasts(fresh);
        refresh();
      }
    } catch (err) {
      console.error('Signal check failed:', err);
    }
  }, [pushToasts, refresh]);

  // 최초 로드
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    refresh();
    if (isWeb) runCheck();
    else refreshCount();
  }, [refresh, refreshCount, runCheck]);

  // 데스크톱: Go 백그라운드 점검이 보내는 이벤트
  useEffect(() => {
    if (isWeb) return;
    return onSignalsNew((fresh) => {
      pushToasts(fresh);
      refresh();
    });
  }, [pushToasts, refresh]);

  // 웹: 탭이 보이는 동안 10분마다, 다시 보이게 될 때 5분이 지났으면 점검
  useEffect(() => {
    if (!isWeb) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') runCheck();
    }, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheckRef.current > VISIBLE_RECHECK_MS) runCheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [runCheck]);

  // 창이 다시 포커스를 받으면 안 읽은 수 갱신
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const markRead = useCallback(async (target: number[] | 'all') => {
    const nowIso = new Date().toISOString();
    const all = target === 'all';
    const ids = all ? [] : target;
    setEvents((prev) => prev.map((e) => (all || ids.includes(e.id) ? { ...e, read_at: e.read_at ?? nowIso } : e)));
    try {
      const r = await apiClient.MarkSignalEventsRead(ids, all);
      setUnreadCount(r.unread_count ?? 0);
    } catch (err) {
      console.error('Failed to mark read:', err);
      refresh();
    }
  }, [refresh]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const focusAsset = useCallback((assetId: number) => {
    nonceRef.current += 1;
    setFocusRequest({ assetId, nonce: nonceRef.current });
  }, []);

  const openEvent = useCallback(
    (e: SignalEvent) => {
      if (!e.read_at) markRead([e.id]);
      dismissToast(e.id);
      focusAsset(e.asset_id);
    },
    [markRead, dismissToast, focusAsset],
  );

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  const value = useMemo<AlertsContextValue>(
    () => ({ unreadCount, events, toasts, focusRequest, refresh, markRead, dismissToast, focusAsset, openEvent, openSettings }),
    [unreadCount, events, toasts, focusRequest, refresh, markRead, dismissToast, focusAsset, openEvent, openSettings],
  );

  return (
    <AlertsContext.Provider value={value}>
      {children}
      <ToastStack />
      <NotificationSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </AlertsContext.Provider>
  );
}
