import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { desktop, type UpdateInfo } from '../../platform/desktop';
import UpdateDialog from './UpdateDialog';

const FIRST_CHECK_DELAY_MS = 8 * 1000; // 앱을 켜고 잠시 뒤
const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // 이후 3시간마다
const NOTICE_MS = 4000;

export interface UpdateNotice {
  kind: 'latest' | 'error' | 'unsupported';
  message: string;
}

interface UpdateContextValue {
  /** 데스크톱 앱이고 업데이트 기능이 있는 빌드인지 */
  enabled: boolean;
  info: UpdateInfo | null;
  available: boolean;
  checking: boolean;
  /** 직접 확인했을 때 잠깐 보여 줄 결과 (최신 버전 / 확인 실패 등) */
  notice: UpdateNotice | null;
  /** 새 버전 확인. manual 이면 결과를 notice 로 알린다 */
  check: (manual?: boolean) => Promise<void>;
  openDialog: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function useUpdates(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error('useUpdates must be used within UpdateProvider');
  return ctx;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : typeof err === 'string' && err ? err : '확인하지 못했습니다');

export function UpdateProvider({ children }: { children: ReactNode }) {
  const enabled = useMemo(() => desktop.updatesSupported(), []);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<UpdateNotice | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const busy = useRef(false);

  const check = useCallback(
    async (manual = false) => {
      if (!enabled || busy.current) return;
      busy.current = true;
      setChecking(true);
      if (manual) setNotice(null);
      try {
        const res = await desktop.checkForUpdate();
        setInfo(res);
        if (manual) {
          if (!res.supported) setNotice({ kind: 'unsupported', message: res.reason || '이 빌드는 업데이트를 확인하지 않습니다' });
          else if (!res.available) setNotice({ kind: 'latest', message: '최신 버전입니다' });
          else setDialogOpen(true); // 직접 확인해서 찾았으면 바로 보여 준다
        }
      } catch (err) {
        console.error('Update check failed:', err);
        if (manual) setNotice({ kind: 'error', message: errText(err) });
      } finally {
        busy.current = false;
        setChecking(false);
      }
    },
    [enabled],
  );

  // 앱을 켜면 한 번, 이후 3시간마다 확인
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => check(false), FIRST_CHECK_DELAY_MS);
    const timer = window.setInterval(() => check(false), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, check]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  const value = useMemo<UpdateContextValue>(
    () => ({ enabled, info, available: !!info?.available, checking, notice, check, openDialog: () => setDialogOpen(true) }),
    [enabled, info, checking, notice, check],
  );

  return (
    <UpdateContext.Provider value={value}>
      {children}
      {dialogOpen && info?.available && <UpdateDialog info={info} onClose={() => setDialogOpen(false)} />}
    </UpdateContext.Provider>
  );
}
