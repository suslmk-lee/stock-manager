// 카드 스타일 · 글꼴 · 글자 크기 선택지

export interface CardStyle {
  id: string;
  name: string;
  description: string;
}

// 실제 모양은 src/styles/card-styles.css 의 [data-card="…"] 규칙이 정한다.
export const CARD_STYLES: CardStyle[] = [
  { id: 'glass', name: '리퀴드 글라스', description: '반투명 유리 · 굴절 림 · 광택 · 깊은 그림자' },
  { id: 'minimal', name: '모노라인 미니멀', description: '1px 선 · 작은 반경 · 그림자 없음 · 간격과 글자로 위계' },
  { id: 'flat', name: '플랫 톤 계층', description: '테두리 없이 밝기 단계로 층 구분 · 알약 버튼' },
  { id: 'neumorph', name: '뉴모피즘', description: '배경과 같은 색 · 밝은/어두운 그림자 두 개로 돌출' },
  { id: 'paper', name: '레이어드 페이퍼', description: '종이가 겹쳐 쌓인 느낌 · 아래로 겹치는 장 · 부드러운 깊이' },
  { id: 'glow', name: '아웃라인 글로우', description: '얇은 테두리와 강조색 발광 · 활성 요소만 빛남' },
  { id: 'aurora', name: '오로라', description: '흐릿한 색 덩어리 배경 위 반투명 카드 · 림과 광택 없음' },
  { id: 'brutal', name: '브루탈리즘', description: '굵은 단색 테두리 · 직각에 가까운 모서리 · 오프셋 그림자' },
];

export const DEFAULT_CARD_STYLE = 'glass';

export interface FontOption {
  id: string;
  name: string;
  family: string; // CSS font-family 앞부분 (뒤에 공통 대체 글꼴이 붙음)
  sample: string;
}

export const SANS_FONTS: FontOption[] = [
  { id: 'pretendard', name: 'Pretendard', family: '"Pretendard Variable", Pretendard', sample: '총 자산 ₩152,257,659' },
  { id: 'noto-sans-kr', name: 'Noto Sans KR', family: '"Noto Sans KR"', sample: '총 자산 ₩152,257,659' },
  { id: 'ibm-plex-sans-kr', name: 'IBM Plex Sans KR', family: '"IBM Plex Sans KR"', sample: '총 자산 ₩152,257,659' },
  { id: 'nanum-gothic', name: '나눔고딕', family: '"Nanum Gothic"', sample: '총 자산 ₩152,257,659' },
  { id: 'gowun-dodum', name: '고운돋움', family: '"Gowun Dodum"', sample: '총 자산 ₩152,257,659' },
  { id: 'system', name: '시스템 기본', family: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic"', sample: '총 자산 ₩152,257,659' },
];

export const MONO_FONTS: FontOption[] = [
  { id: 'jetbrains-mono', name: 'JetBrains Mono', family: '"JetBrains Mono"', sample: 'USD/KRW 1,325.4' },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', family: '"IBM Plex Mono"', sample: 'USD/KRW 1,325.4' },
  { id: 'fira-code', name: 'Fira Code', family: '"Fira Code"', sample: 'USD/KRW 1,325.4' },
  { id: 'nanum-gothic-coding', name: '나눔고딕코딩', family: '"Nanum Gothic Coding"', sample: '인출 가능 1,325.4' },
];

export const SANS_FALLBACK = '"Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif';
// 고정폭 글꼴에 한글이 없을 때 Pretendard 로 대체
export const MONO_FALLBACK = '"Pretendard Variable", ui-monospace, SFMono-Regular, Menlo, monospace';

export const DEFAULT_SANS = 'pretendard';
export const DEFAULT_MONO = 'jetbrains-mono';

export const FONT_SIZES = [
  { id: 'sm', name: '작게', px: 15 },
  { id: 'md', name: '보통', px: 16 },
  { id: 'lg', name: '크게', px: 17 },
] as const;

export type FontSizeId = (typeof FONT_SIZES)[number]['id'];
export const DEFAULT_FONT_SIZE: FontSizeId = 'md';
