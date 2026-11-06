import { useId } from 'react';

// 브랜드: 막대 + 상승선 마크와 두 굵기 워드마크 (테마 색을 따른다)
// wordmark: responsive = 좁은 화면(440px 미만)에서 숨김, show = 항상 표시, hide = 마크만
// tagline: 워드마크 아래 "Portfolio · Dividend" 줄 (좁은 사이드바에서는 끈다)
export default function Brand({
  wordmark = 'responsive',
  tagline = true,
}: {
  wordmark?: 'responsive' | 'show' | 'hide';
  tagline?: boolean;
}) {
  // useId 의 ':' 는 일부 WebKit 에서 url(#…) 참조를 깨뜨리므로 뺀다
  const gid = `brand-${useId().replace(/:/g, '')}`;
  return (
    <div className="flex select-none items-center gap-3">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden className="shrink-0 drop-shadow-[0_4px_14px_rgb(var(--c-mint-400)/0.35)]">
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: 'rgb(var(--c-mint-500))' }} />
            <stop offset="1" style={{ stopColor: 'rgb(var(--c-sky-300))' }} />
          </linearGradient>
        </defs>
        <rect x="4" y="20" width="6" height="10" rx="2" fill={`url(#${gid})`} opacity="0.4" />
        <rect x="14" y="14" width="6" height="16" rx="2" fill={`url(#${gid})`} opacity="0.7" />
        <rect x="24" y="8" width="6" height="22" rx="2" fill={`url(#${gid})`} />
        <path
          d="M3 15.5 L11 10 L17 12.5 L28.5 3.5"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ stroke: 'rgb(var(--c-white))' }}
        />
        <circle cx="28.5" cy="3.5" r="2.2" style={{ fill: 'rgb(var(--c-white))' }} />
      </svg>
      {wordmark !== 'hide' && (
        <div className={`leading-none ${wordmark === 'responsive' ? 'hidden min-[440px]:block' : ''}`}>
          <div className="whitespace-nowrap text-[17px] tracking-tight text-white">
            <span className="font-semibold">Stock</span> <span className="font-light text-zinc-400">Manager</span>
          </div>
          {tagline && <div className="label-mono mt-1.5 !text-[10px] uppercase tracking-[0.2em]">Portfolio · Dividend</div>}
        </div>
      )}
    </div>
  );
}
