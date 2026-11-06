import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SignalTaxSummary } from '../../types/models';
import { TaxPanel, fmtKrw, fmtNum } from './SignalCard';

/**
 * 상단 바의 해외주식 양도세 요약 알약. 누르면 상세 패널이 아래로 떠서 열린다
 * (본문을 밀어내지 않도록 겹쳐 띄운다). 연말 절세 구간이면 알약에 표시만 한다.
 */
export default function TaxPill({ tax }: { tax: SignalTaxSummary }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const exemption = tax.exemption_krw || 2500000;
  const usedPct = (Math.max(tax.net_krw, 0) / exemption) * 100;
  const over = usedPct > 100;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="glass-pill inline-flex h-8 items-center gap-2 whitespace-nowrap px-3 text-xs text-zinc-300 transition-colors hover:text-white"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${over ? 'bg-amber-400' : 'bg-mint-400'}`} />
        양도세 공제 <span className={`num ${over ? 'text-amber-300' : 'text-mint-300'}`}>{fmtNum(usedPct, 0)}%</span>
        <span className="text-zinc-600">·</span>
        예상 <span className={`num ${tax.estimated_tax_krw > 0 ? 'text-rose-300' : 'text-zinc-200'}`}>{fmtKrw(tax.estimated_tax_krw)}</span>
        {tax.harvest_window && (
          <>
            <span className="text-zinc-600">·</span>
            <span className="text-amber-300">절세 구간</span>
          </>
        )}
        <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="dialog" aria-label="해외주식 양도세" className="animate-fade-up absolute left-0 top-full z-40 mt-2 w-[min(560px,calc(100vw-2rem))]">
          <TaxPanel tax={tax} className="surface !bg-ink-900 p-4 shadow-2xl sm:p-5" />
        </div>
      )}
    </div>
  );
}
