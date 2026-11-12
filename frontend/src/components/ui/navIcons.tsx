import type { ReactElement } from 'react';

// 메뉴 · 화면 제목 아이콘 — quantum-mate 의 "어긋난 두 색" 아이콘 방식.
// 직접 그린 24 격자 선(글자색) 위에, 테마 강조색 면을 오른쪽 아래로 1.2 어긋나게 겹친다.
// 범용 아이콘(lucide)을 그대로 쓰면 템플릿처럼 보여서 메뉴와 화면 제목에만 쓴다.
// 버튼 안의 작은 기능 아이콘(닫기·추가·화살표 등)은 lucide 그대로.
// l = 선, f = 면. 문자열은 이 파일의 상수만 넣는다 (밖에서 받은 값을 넣지 않는다).

export type NavIcon = (p: { className?: string }) => ReactElement;

export const NAV_ICON_PATHS = {
  // 계좌: 지갑 (면 = 잠금 단추)
  wallet: [
    '<path d="M18.5 7.5V6a1.5 1.5 0 0 0-1.5-1.5H5.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-13"/><path d="M20.5 11.5h-3a2 2 0 0 0 0 4h3"/>',
    '<rect x="14" y="10.5" width="6.5" height="6" rx="2.5"/>',
  ],
  // 주식/ETF: 오르는 선 (면 = 선 아래)
  trend: [
    '<path d="M3.5 17.5l5-5 3.5 3.5 8-8M15 8h5v5"/>',
    '<path d="M4 20l4.5-5 3.5 3.5 7.5-7.5V20z"/>',
  ],
  // 매매 기록: 사고파는 두 화살표 (면 = 출발점)
  trades: [
    '<path d="M4 8h15M15.5 4.5 19 8l-3.5 3.5M20 16H5M8.5 12.5 5 16l3.5 3.5"/>',
    '<circle cx="5.5" cy="8" r="2.2"/><circle cx="18.5" cy="16" r="2.2"/>',
  ],
  // 모으기: 쌓이는 동전 + 더하기 (면 = 맨 위 동전)
  accumulate: [
    '<ellipse cx="10" cy="6.5" rx="6" ry="2.5"/><path d="M4 6.5V11c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6.5M4 11v4.5c0 1.4 2.7 2.5 6 2.5.9 0 1.8-.1 2.5-.2"/><path d="M18.5 14v6M15.5 17h6"/>',
    '<ellipse cx="10" cy="6.5" rx="6" ry="2.5"/>',
  ],
  // 자산 추이: 틀 안의 선 그래프 (면 = 선 아래)
  chart: [
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 15.5l3.2-3.5 2.8 2 4-5"/>',
    '<path d="M7 15.5l3.2-3.5 2.8 2 4-5V16H7z"/>',
  ],
  // 배당 기록: 동전 (면 = 사분원)
  coin: [
    '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.3c-.4-.9-1.4-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2 0 2.7 5.3 1.4 5.3 4.2 0 1.2-1.1 2-2.7 2-1.3 0-2.3-.6-2.7-1.5M12 6.3v1.6M12 16.1v1.6"/>',
    '<path d="M12 3.5A8.5 8.5 0 0 1 20.5 12H12z"/>',
  ],
  // 배당 분석: 막대 그래프 (면 = 가운데 막대)
  bars: [
    '<path d="M3.5 20.5h17"/><rect x="5" y="12" width="3.5" height="8.5" rx="1"/><rect x="10.25" y="7.5" width="3.5" height="13" rx="1"/><rect x="15.5" y="4" width="3.5" height="16.5" rx="1"/>',
    '<rect x="10.25" y="7.5" width="3.5" height="13" rx="1"/>',
  ],
  // 매매 신호: 레이더 (면 = 훑는 부채꼴)
  radar: [
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/><circle cx="15.5" cy="15" r=".6"/>',
    '<path d="M12 3.5A8.5 8.5 0 0 1 18 6l-6 6z"/>',
  ],
  // 전략 프로필: 조절 막대 (면 = 가운데 손잡이)
  sliders: [
    '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    '<circle cx="9" cy="12" r="2.5"/>',
  ],
  // 배당 후보: 목록 + 동전 (면 = 동전)
  candidates: [
    '<path d="M4 6.5h11M4 11.5h7M4 16.5h5"/><circle cx="16.5" cy="15.5" r="4"/><path d="M16.5 13.8v3.4"/>',
    '<circle cx="16.5" cy="15.5" r="4"/>',
  ],
  // 모양 설정: 팔레트 (면 = 물감 하나)
  palette: [
    '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.7-.7 1.7-1.6 0-1.2-1.2-1.6-1.2-2.8 0-1 .8-1.6 1.7-1.6h2.3a4 4 0 0 0 4-4c0-4.1-3.8-7-8.5-7z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
    '<circle cx="7.5" cy="11.5" r="2.4"/>',
  ],
} as const satisfies Record<string, readonly [string, string]>;

const make =
  ([l, f]: readonly [string, string]): NavIcon =>
  ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g fill="rgb(var(--c-mint-400))" opacity={0.7} transform="translate(1.2 1.2)" dangerouslySetInnerHTML={{ __html: f }} />
      <g fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: l }} />
    </svg>
  );

export const IconWallet = make(NAV_ICON_PATHS.wallet);
export const IconTrend = make(NAV_ICON_PATHS.trend);
export const IconTrades = make(NAV_ICON_PATHS.trades);
export const IconAccumulate = make(NAV_ICON_PATHS.accumulate);
export const IconChart = make(NAV_ICON_PATHS.chart);
export const IconCoin = make(NAV_ICON_PATHS.coin);
export const IconBars = make(NAV_ICON_PATHS.bars);
export const IconRadar = make(NAV_ICON_PATHS.radar);
export const IconSliders = make(NAV_ICON_PATHS.sliders);
export const IconCandidates = make(NAV_ICON_PATHS.candidates);
export const IconPalette = make(NAV_ICON_PATHS.palette);
