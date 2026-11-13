import { useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { DivScoreWeights } from '../../types/models';
import Portal from '../ui/Portal';
import { DEFAULT_WEIGHTS, PART_HELP, PART_KEYS, PART_LABEL } from './scoreText';

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '저장하지 못했습니다.');

/** 배점 설정 — 항목마다 0~100, 합이 100 이 아니어도 비율로 쓴다. 바꾸면 지난 달 순위도 같은 기준으로 다시 매긴다. */
export default function ScoreSettings({ initial, onClose, onSaved }: { initial: DivScoreWeights; onClose: () => void; onSaved: () => void }) {
  const [w, setW] = useState<DivScoreWeights>({ ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = PART_KEYS.reduce((s, k) => s + (w[k] || 0), 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.UpdateDividendScoreSettings(w);
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[92vh] w-full max-w-lg flex-col" role="dialog" aria-modal="true" aria-label="배점 설정">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div>
              <h3 className="section-title">배점 설정</h3>
              <p className="mt-0.5 text-xs text-zinc-500">항목별 비율 · 합이 100이 아니어도 비율로 계산합니다. 지난 달 순위도 같은 기준으로 다시 매겨집니다.</p>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-5 overflow-y-auto px-5 py-5">
            {PART_KEYS.map((k) => {
              const share = total > 0 ? ((w[k] || 0) / total) * 100 : 0;
              return (
                <div key={k}>
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor={`w-${k}`} className="text-sm font-medium text-zinc-100">
                      {PART_LABEL[k]}
                    </label>
                    <span className="num text-xs text-zinc-400">
                      <input
                        inputMode="numeric"
                        aria-label={`${PART_LABEL[k]} 배점`}
                        className="input-field num !inline-block !w-16 !px-2 !py-1 text-right"
                        value={w[k]}
                        onChange={(e) => setW({ ...w, [k]: Math.min(100, Number(e.target.value.replace(/\D/g, '') || 0)) })}
                      />{' '}
                      <span className="inline-block w-12 text-right text-mint-300">{share.toFixed(0)}%</span>
                    </span>
                  </div>
                  <input id={`w-${k}`} type="range" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="mt-2 w-full accent-[rgb(var(--c-mint-400))]" />
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{PART_HELP[k]}</p>
                </div>
              );
            })}
            {total === 0 && <p className="text-xs text-rose-300">하나 이상 0보다 크게 넣어 주세요.</p>}
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-5 py-3.5">
            <button type="button" className="btn-ghost !px-3 !text-xs" onClick={() => setW({ ...DEFAULT_WEIGHTS })}>
              <RotateCcw className="h-3.5 w-3.5" />
              기본값 {PART_KEYS.map((k) => DEFAULT_WEIGHTS[k]).join('·')}
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                취소
              </button>
              <button type="button" className="btn-primary" onClick={save} disabled={busy || total === 0}>
                {busy ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
