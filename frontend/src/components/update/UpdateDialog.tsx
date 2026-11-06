import { useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2, X } from 'lucide-react';
import Portal from '../ui/Portal';
import { desktop, type UpdateInfo, type UpdateProgress } from '../../platform/desktop';

const PHASE_LABEL: Record<UpdateProgress['phase'], string> = {
  download: '새 버전을 내려받는 중',
  extract: '설치 파일을 여는 중',
  verify: '앱 서명을 확인하는 중',
  restart: '설치 준비가 끝났습니다. 앱을 다시 시작합니다',
};

const fmtSize = (bytes?: number) => (bytes ? `${(bytes / 1024 / 1024).toFixed(0)}MB` : '');
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

/** 새 버전 안내 + 설치 (릴리스 노트, 내려받기 진행률, 실패 시 다시 시도) */
export default function UpdateDialog({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => desktop.onUpdateProgress(setProgress), []);

  useEffect(() => {
    if (installing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [installing, onClose]);

  const install = async () => {
    setError(null);
    setProgress({ phase: 'download', percent: 0 });
    setInstalling(true);
    try {
      await desktop.installUpdate(); // 성공하면 곧 앱이 종료되고 새 버전으로 다시 열린다
    } catch (err) {
      setInstalling(false);
      setProgress(null);
      setError(err instanceof Error ? err.message : typeof err === 'string' ? err : '설치하지 못했습니다');
    }
  };

  const pct = progress?.phase === 'download' ? Math.min(100, Math.round(progress.percent)) : progress ? 100 : 0;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !installing && onClose()}>
        <div role="dialog" aria-modal="true" aria-label="앱 업데이트" className="surface flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-white">새 버전 {info.latest}</h2>
              <p className="label-mono mt-1">
                지금 {info.current}
                {info.published_at && ` · ${fmtDate(info.published_at)} 공개`}
              </p>
            </div>
            {!installing && (
              <button type="button" onClick={onClose} className="btn-icon" aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="label-mono mb-2">바뀐 점</div>
            <div className="surface-inset whitespace-pre-wrap px-3.5 py-3 text-sm leading-relaxed text-zinc-300">{info.notes?.trim() || '릴리스 노트가 없습니다.'}</div>
            {!info.can_install && info.reason && <p className="mt-3 text-sm text-amber-200">{info.reason}</p>}
            {error && <p className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
          </div>

          {installing && progress && (
            <div className="border-t border-white/[0.07] px-5 py-3.5" role="status" aria-live="polite">
              <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-300">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {PHASE_LABEL[progress.phase]}
                </span>
                {progress.phase === 'download' && <span className="num">{pct}%</span>}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-mint-400 transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
            {info.url && (
              <button type="button" className="btn-ghost mr-auto !px-3 !py-1.5 !text-xs" disabled={installing} onClick={() => desktop.openReleasePage(info.url!)}>
                <ExternalLink className="h-3.5 w-3.5" />
                릴리스 페이지
              </button>
            )}
            <button type="button" className="btn-ghost" disabled={installing} onClick={onClose}>
              나중에
            </button>
            {info.can_install && (
              <button type="button" className="btn-primary" disabled={installing} onClick={install}>
                {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {error ? '다시 시도' : '지금 설치'}
                {!installing && info.asset_size ? <span className="num text-xs opacity-70">{fmtSize(info.asset_size)}</span> : null}
              </button>
            )}
          </div>
          {info.can_install && !installing && <p className="px-5 pb-3.5 text-[11px] text-zinc-500">설치하면 앱이 잠시 종료됐다가 새 버전으로 다시 열립니다.</p>}
        </div>
      </div>
    </Portal>
  );
}
