// 브랜드: 앱 아이콘(배당 동전 막대 차트)과 두 굵기 워드마크
// 마크 그림은 images/brand-mark.svg = build/appicon.svg 에서 바깥 여백과 그림자만 잘라 낸 것 (아이콘을 바꾸면 같이 바꾼다)
// 밝은 테마용 images/brand-mark-light.svg 는 같은 그림에 밝은 타일·진한 초록 화살표 (같이 바꾼다)
// wordmark: responsive = 좁은 화면(440px 미만)에서 숨김, show = 항상 표시, hide = 마크만
// tagline: 워드마크 아래 "Portfolio · Dividend" 줄 (좁은 사이드바에서는 끈다)
export default function Brand({
  wordmark = 'responsive',
  tagline = true,
}: {
  wordmark?: 'responsive' | 'show' | 'hide';
  tagline?: boolean;
}) {
  return (
    <div className="flex select-none items-center gap-3">
      {/* 어두운 테마는 앱 아이콘 그대로, 밝은 테마는 밝은 타일 (index.css 의 .brand-mark-*) */}
      <img
        src="/brand-mark.svg"
        alt=""
        width={34}
        height={34}
        draggable={false}
        className="brand-mark-dark h-[34px] w-[34px] shrink-0 drop-shadow-[0_4px_12px_rgb(0_0_0/0.45)]"
      />
      <img
        src="/brand-mark-light.svg"
        alt=""
        width={34}
        height={34}
        draggable={false}
        className="brand-mark-light h-[34px] w-[34px] shrink-0 drop-shadow-[0_2px_6px_rgb(15_23_42/0.14)]"
      />
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
