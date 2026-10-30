import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { NotificationSetting, NotifyIntervalMinutes } from '../../types/models';
import Switch from '../ui/Switch';

const isWeb = !(window as any).go;

const INTERVALS: { value: NotifyIntervalMinutes; label: string }[] = [
  { value: 15, label: '15분' },
  { value: 30, label: '30분' },
  { value: 60, label: '1시간' },
  { value: 180, label: '3시간' },
  { value: 360, label: '6시간' },
];

const DEFAULTS: NotificationSetting = {
  enabled: true,
  interval_minutes: 60,
  os_notify: true,
  notify_sell: true,
  notify_buy: true,
  notify_conflict: true,
};

function Row({ title, note, children, dim }: { title: string; note?: string; children: React.ReactNode; dim?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3 ${dim ? 'opacity-50' : ''}`}>
      <div className="min-w-0">
        <div className="text-sm text-white">{title}</div>
        {note && <div className="mt-0.5 text-xs text-zinc-500">{note}</div>}
      </div>
      {children}
    </div>
  );
}

export default function NotificationSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<NotificationSetting>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    apiClient
      .GetNotificationSettings()
      .then((s) => !cancelled && setDraft({ ...DEFAULTS, ...s }))
      .catch((err) => {
        console.error('Failed to load notification settings:', err);
        if (!cancelled) setError('설정을 불러오지 못했습니다.');
      })
      .finally(() => !cancelled && setLoading(false));
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof NotificationSetting>(k: K, v: NotificationSetting[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.SaveNotificationSettings(draft);
      onClose();
    } catch (err) {
      console.error('Failed to save notification settings:', err);
      const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      setError(detail ? `저장하지 못했습니다: ${detail}` : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const off = !draft.enabled;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="알림 설정" className="surface flex max-h-[85vh] w-full max-w-md flex-col outline-none">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
          <h2 className="text-base font-semibold text-white">알림 설정</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 divide-y divide-white/[0.06] overflow-y-auto px-5 py-2">
          <Row title="알림 사용" note="매매 신호가 바뀌면 알려줍니다">
            <Switch checked={draft.enabled} onChange={(v) => set('enabled', v)} label="알림 사용" disabled={loading} />
          </Row>

          <div className={`py-3 ${off ? 'opacity-50' : ''}`}>
            <div className="text-sm text-white">점검 주기</div>
            <div className="glass-pill mt-2 flex overflow-x-auto p-1" role="group" aria-label="점검 주기">
              {INTERVALS.map((i) => (
                <button
                  key={i.value}
                  type="button"
                  disabled={off}
                  onClick={() => set('interval_minutes', i.value)}
                  className={`pill-item flex-1 !px-2.5 !py-1 !text-xs ${draft.interval_minutes === i.value ? 'pill-item-active' : ''}`}
                >
                  {i.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">데스크톱 앱이 켜져 있을 때 백그라운드로 점검 · 웹은 열려 있을 때 확인</p>
          </div>

          <Row title="Windows 알림 표시" note={isWeb ? '데스크톱 앱 전용' : undefined} dim={off || isWeb}>
            <Switch checked={draft.os_notify} onChange={(v) => set('os_notify', v)} label="Windows 알림 표시" disabled={off || isWeb} />
          </Row>

          <div className={`py-3 ${off ? 'opacity-50' : ''}`}>
            <div className="text-sm text-white">알릴 신호</div>
            <div className="mt-1 divide-y divide-white/[0.04]">
              {(
                [
                  ['notify_sell', '매도', 'bg-rose-400'],
                  ['notify_buy', '매수', 'bg-mint-400'],
                  ['notify_conflict', '충돌', 'bg-amber-400'],
                ] as const
              ).map(([key, label, dot]) => (
                <div key={key} className="flex items-center justify-between py-2.5">
                  <span className="flex items-center gap-2 text-sm text-zinc-300">
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    {label}
                  </span>
                  <Switch checked={draft[key]} onChange={(v) => set(key, v)} label={`${label} 신호 알림`} disabled={off} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-5 py-3.5">
          <span className="min-w-0 truncate text-xs text-rose-300">{error}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving || loading}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
