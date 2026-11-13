import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiClient } from '../../api/client';
import { onSignalsNew } from '../../api/events';
import type { SignalEvent } from '../../types/models';
import NotificationSettings from './NotificationSettings';
import ToastStack from './ToastStack';
import { isHoldingCheck, isSuggestion } from './alertMeta';

const isWeb = !(window as any).go;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const VISIBLE_RECHECK_MS = 5 * 60 * 1000;
const RECENT_LIMIT = 30;

export interface FocusRequest {
  assetId: number;
  nonce: number;
}

export interface CandidatesRequest {
  assetId?: number;
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
  /** 배당 후보 페이지로 이동 (assetId 가 있으면 그 종목을 강조/미리 선택) */
  openCandidates: (assetId?: number) => void;
  /** 마지막 배당 후보 이동 요청 — 페이지가 강조할 종목과 다시 그릴 기준(nonce) */
  candidatesRequest: CandidatesRequest | null;
  /** 배당 점수 화면에서 열 종목 (보유 확인 알림을 눌렀을 때) */
  divScoreRequest: FocusRequest | null;
  /** 프로필 지정/변경이 일어날 때마다 올라가는 값 — 신호 화면이 다시 불러오는 데 쓴다 */
  profilesVersion: number;
  /** 프로필 관리·배당 후보 페이지에서 지정이 바뀌었음을 알린다 */
  notifyProfilesChanged: () => void;
  /** 제안 알림의 종목을 제안된 프로필로 지정 */
  acceptSuggestion: (e: SignalEvent) => Promise<void>;
  /** 제안 알림을 무시 */
  dismissSuggestion: (e: SignalEvent) => Promise<void>;
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
  const [candidatesRequest, setCandidatesRequest] = useState<CandidatesRequest | null>(null);
  const [divScoreRequest, setDivScoreRequest] = useState<FocusRequest | null>(null);
  const [profilesVersion, setProfilesVersion] = useState(0);
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

  // 배당 후보는 팝업이 아니라 페이지(#candidates)로 연다. Dashboard 가 해시를 보고 페이지를 바꾼다.
  const openCandidates = useCallback((assetId?: number) => {
    nonceRef.current += 1;
    setCandidatesRequest({ assetId, nonce: nonceRef.current });
    window.location.hash = 'candidates';
  }, []);

  // 보유 확인 알림: 배당 점수 화면(#dividend-score)에서 그 종목을 연다 (내 보유 아래에서 바로 고친다)
  const openDivScore = useCallback((assetId: number) => {
    nonceRef.current += 1;
    setDivScoreRequest({ assetId, nonce: nonceRef.current });
    window.location.hash = 'dividend-score';
  }, []);

  const openEvent = useCallback(
    (e: SignalEvent) => {
      if (!e.read_at) markRead([e.id]);
      dismissToast(e.id);
      if (isSuggestion(e)) openCandidates(e.asset_id);
      else if (isHoldingCheck(e)) openDivScore(e.asset_id);
      else focusAsset(e.asset_id);
    },
    [markRead, dismissToast, focusAsset, openCandidates, openDivScore],
  );

  const notifyProfilesChanged = useCallback(() => setProfilesVersion((v) => v + 1), []);

  // 배당 후보 페이지를 떠나면 요청을 지운다 (나중에 메뉴로 다시 들어왔을 때 예전 종목을 또 강조하지 않도록)
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash !== '#candidates') setCandidatesRequest(null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const acceptSuggestion = useCallback(
    async (e: SignalEvent) => {
      if (!e.suggested_profile_id) {
        openCandidates(e.asset_id);
        return;
      }
      await apiClient.AssignSignalProfile(e.suggested_profile_id, [e.asset_id]);
      await markRead([e.id]);
      dismissToast(e.id);
      setProfilesVersion((v) => v + 1);
    },
    [markRead, dismissToast, openCandidates],
  );

  const dismissSuggestion = useCallback(
    async (e: SignalEvent) => {
      await apiClient.DismissProfileSuggestion(e.asset_id);
      await markRead([e.id]);
      dismissToast(e.id);
    },
    [markRead, dismissToast],
  );

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  const value = useMemo<AlertsContextValue>(
    () => ({ unreadCount, events, toasts, focusRequest, refresh, markRead, dismissToast, focusAsset, openEvent, openSettings, openCandidates, candidatesRequest, divScoreRequest, profilesVersion, notifyProfilesChanged, acceptSuggestion, dismissSuggestion }),
    [unreadCount, events, toasts, focusRequest, refresh, markRead, dismissToast, focusAsset, openEvent, openSettings, openCandidates, candidatesRequest, divScoreRequest, profilesVersion, notifyProfilesChanged, acceptSuggestion, dismissSuggestion],
  );

  return (
    <AlertsContext.Provider value={value}>
      {children}
      <ToastStack />
      <NotificationSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </AlertsContext.Provider>
  );
}
