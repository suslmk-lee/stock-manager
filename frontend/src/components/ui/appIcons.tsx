import type { ReactElement } from 'react';

// 앱 아이콘 — quantum-mate 의 "어긋난 두 색" 아이콘 방식.
// 직접 그린 24 격자 선(글자색) 위에, 색 면을 오른쪽 아래로 1.2 어긋나게 겹친다. 타일(배경 상자)은 쓰지 않는다.
// 메뉴 · 화면 제목 · 카드 머리 아이콘에 쓴다. 버튼 안의 작은 기능 아이콘(닫기·추가·화살표 등)은 lucide 그대로.
// l = 선, f = 면. 문자열은 이 파일의 상수만 넣는다 (밖에서 받은 값을 넣지 않는다).

/** 면 색: accent = 테마 강조색(기본), 나머지는 상태 색 (매수·이익 = accent, 매도·손실 = rose 등) */
export type IconTone = 'accent' | 'amber' | 'sky' | 'rose' | 'emerald';
export type AppIcon = (p: { className?: string; tone?: IconTone }) => ReactElement;

const TONE_VAR: Record<IconTone, string> = {
  accent: '--c-mint-400',
  amber: '--c-amber-400',
  sky: '--c-sky-400',
  rose: '--c-rose-400',
  emerald: '--c-emerald-400',
};

export const ICON_PATHS = {
  // ── 메뉴 ──
  // 계좌: 지갑 (면 = 잠금 단추)
  wallet: [
    '<path d="M18.5 7.5V6a1.5 1.5 0 0 0-1.5-1.5H5.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-13"/><path d="M20.5 11.5h-3a2 2 0 0 0 0 4h3"/>',
    '<rect x="14" y="10.5" width="6.5" height="6" rx="2.5"/>',
  ],
  // 주식/ETF · 이익: 오르는 선 (면 = 선 아래)
  trend: [
    '<path d="M3.5 17.5l5-5 3.5 3.5 8-8M15 8h5v5"/>',
    '<path d="M4 20l4.5-5 3.5 3.5 7.5-7.5V20z"/>',
  ],
  // 손실: 내리는 선 (면 = 선 아래)
  trendDown: [
    '<path d="M3.5 6.5l5 5 3.5-3.5 8 8M15 16h5v-5"/>',
    '<path d="M4 9l4.5 4.5L12 10l7.5 7.5V20H4z"/>',
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
  // 배당: 동전 (면 = 사분원)
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
  // 모양 설정 · 앱 테마: 팔레트 (면 = 물감 하나)
  palette: [
    '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.7-.7 1.7-1.6 0-1.2-1.2-1.6-1.2-2.8 0-1 .8-1.6 1.7-1.6h2.3a4 4 0 0 0 4-4c0-4.1-3.8-7-8.5-7z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
    '<circle cx="7.5" cy="11.5" r="2.4"/>',
  ],

  // ── 카드 · 설정 ──
  // 매수: 들어오는 화살표 (면 = 받는 쟁반)
  buy: [
    '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4 15.5v3a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
    '<rect x="4" y="16" width="16" height="4" rx="1.5"/>',
  ],
  // 매도: 나가는 화살표 (면 = 화살촉)
  sell: [
    '<path d="M12 14.5v-11M7.5 8 12 3.5 16.5 8"/><path d="M4 15.5v3a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
    '<path d="M8 8l4-4 4 4z"/>',
  ],
  // 시계 (면 = 사분원)
  clock: [
    '<circle cx="12" cy="12.5" r="8"/><path d="M12 8.5v4l2.5 2"/>',
    '<path d="M12 4.5a8 8 0 0 1 8 8h-8z"/>',
  ],
  // 달력 (면 = 날짜 한 칸)
  calendar: [
    '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2"/>',
    '<rect x="14" y="15" width="3.5" height="3" rx="1"/>',
  ],
  // 영수증 (면 = 첫 줄)
  receipt: [
    '<path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    '<rect x="8.5" y="6.8" width="7" height="2.6" rx="1"/>',
  ],
  // 퍼센트 (면 = 아래 동그라미)
  percent: [
    '<path d="M18.5 5.5l-13 13"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    '<circle cx="16.5" cy="16.5" r="2.5"/>',
  ],
  // 원그래프 (면 = 떨어진 조각)
  pie: [
    '<path d="M12 4a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 3.6A8.5 8.5 0 0 1 20.4 9H15z"/>',
    '<path d="M15 3.6A8.5 8.5 0 0 1 20.4 9H15z"/>',
  ],
  // 카메라 · 스냅샷 (면 = 렌즈)
  camera: [
    '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2.5h5.4L16.2 7h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
    '<circle cx="12" cy="13" r="3.5"/>',
  ],
  // 카드 스타일: 칸 나눈 화면 (면 = 위 칸)
  layout: [
    '<rect x="3.5" y="4" width="17" height="6.5" rx="1.5"/><rect x="3.5" y="13.5" width="7.5" height="6.5" rx="1.5"/><rect x="14" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    '<rect x="3.5" y="4" width="17" height="6.5" rx="1.5"/>',
  ],
  // 글꼴: Aa (면 = a)
  font: [
    '<path d="M3.5 18.5 8.5 5.5l5 13M5.3 14h6.4"/><circle cx="17.5" cy="15.5" r="3"/><path d="M20.5 12.5v6"/>',
    '<circle cx="17.5" cy="15.5" r="3"/>',
  ],
  // 카드 그라데이션: 빛 (면 = 해)
  glow: [
    '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
    '<circle cx="12" cy="12" r="4"/>',
  ],
  // 카드 입체감: 상자 (면 = 윗면)
  box: [
    '<path d="M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8z"/><path d="M12 12l7.5-4.2M12 12v8.5M12 12 4.5 7.8"/>',
    '<path d="M12 3.5l7.5 4.3L12 12 4.5 7.8z"/>',
  ],
  // 마우스 효과: 커서 (면 = 커서)
  pointer: [
    '<path d="M5 3.5l13 6-5.5 2-2 5.5z"/><path d="M12.5 11.5l6 6"/>',
    '<path d="M5 3.5l13 6-5.5 2-2 5.5z"/>',
  ],
  // 거래 내역: 되감는 시계 (면 = 사분원)
  history: [
    '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M12 8v4.5l3 1.8"/>',
    '<path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5H12z"/>',
  ],
  // 보유 현황: 겹친 층 (면 = 맨 위 층)
  layers: [
    '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
    '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/>',
  ],
  // 배당 점수: 시상대 (면 = 1등 단)
  podium: [
    '<path d="M9 9.5h6v11H9zM3.5 13.5H9v7H3.5zM15 15.5h5.5v5H15z"/><path d="M12 3.2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 5.3l2-.3z"/>',
    '<path d="M9 9.5h6v11H9z"/>',
  ],
  // 잠금 설정: 자물쇠 (면 = 몸통)
  lock: [
    '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
    '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/>',
  ],
  // 색상: 반쪽 원 (면 = 왼쪽 반)
  contrast: [
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/>',
    '<path d="M12 3.5a8.5 8.5 0 0 0 0 17z"/>',
  ],
} as const satisfies Record<string, readonly [string, string]>;

// 면 색은 style 로 준다 (WKWebView 는 SVG fill 속성 값의 CSS 변수를 풀지 않는다)
const make =
  ([l, f]: readonly [string, string]): AppIcon =>
  ({ className, tone = 'accent' }) => (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g style={{ fill: `rgb(var(${TONE_VAR[tone]}))` }} opacity={0.7} transform="translate(1.2 1.2)" dangerouslySetInnerHTML={{ __html: f }} />
      <g fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: l }} />
    </svg>
  );

export const IconWallet = make(ICON_PATHS.wallet);
export const IconTrend = make(ICON_PATHS.trend);
export const IconTrendDown = make(ICON_PATHS.trendDown);
export const IconTrades = make(ICON_PATHS.trades);
export const IconAccumulate = make(ICON_PATHS.accumulate);
export const IconChart = make(ICON_PATHS.chart);
export const IconCoin = make(ICON_PATHS.coin);
export const IconBars = make(ICON_PATHS.bars);
export const IconRadar = make(ICON_PATHS.radar);
export const IconSliders = make(ICON_PATHS.sliders);
export const IconCandidates = make(ICON_PATHS.candidates);
export const IconPalette = make(ICON_PATHS.palette);
export const IconBuy = make(ICON_PATHS.buy);
export const IconSell = make(ICON_PATHS.sell);
export const IconClock = make(ICON_PATHS.clock);
export const IconCalendar = make(ICON_PATHS.calendar);
export const IconReceipt = make(ICON_PATHS.receipt);
export const IconPercent = make(ICON_PATHS.percent);
export const IconPie = make(ICON_PATHS.pie);
export const IconCamera = make(ICON_PATHS.camera);
export const IconLayout = make(ICON_PATHS.layout);
export const IconFont = make(ICON_PATHS.font);
export const IconGlow = make(ICON_PATHS.glow);
export const IconBox = make(ICON_PATHS.box);
export const IconPointer = make(ICON_PATHS.pointer);
export const IconContrast = make(ICON_PATHS.contrast);
export const IconHistory = make(ICON_PATHS.history);
export const IconLayers = make(ICON_PATHS.layers);
export const IconLock = make(ICON_PATHS.lock);
export const IconPodium = make(ICON_PATHS.podium);
