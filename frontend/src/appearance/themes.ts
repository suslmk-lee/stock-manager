// 앱 테마 정의와 CSS 변수 생성.
// 테마는 배경(bg)·글자(fg)·강조(accent) 3색만 정하고, 나머지 단계는 섞어서 만든다.
// Tailwind 색상(white/black/zinc/ink/mint/amber/rose/emerald/sky/orange)은 모두
// `rgb(var(--c-…) / <alpha>)` 로 연결되어 있어 변수만 바꾸면 화면 전체가 따라온다.

export type ThemeMode = 'dark' | 'light';

export interface AppTheme {
  id: string;
  name: string;
  mode: ThemeMode;
  bg: string; // 가장 바깥 배경
  fg: string; // 최대 대비 글자색 (다크 테마의 "white")
  accent: string; // 포인트 색
  surface?: string; // 카드 바탕 (기본: bg 에서 fg 쪽으로 살짝)
  // 상태 색 덮어쓰기 — 강조색이 주황·노랑 계열이면 '인출 제한'(amber)과 겹치지 않게 바꾼다
  status?: Partial<Record<'amber' | 'rose' | 'emerald' | 'sky' | 'orange', string>>;
}

export const THEMES: AppTheme[] = [
  { id: 'default', name: '기본 (블랙 · 민트)', mode: 'dark', bg: '#060607', fg: '#ffffff', accent: '#7ddfb0' },
  { id: 'graphite-blue', name: '그라파이트 · 파랑', mode: 'dark', bg: '#111113', fg: '#f4f4f5', accent: '#6aa8ff' },
  { id: 'graphite-orange', name: '그라파이트 · 주황', mode: 'dark', bg: '#111113', fg: '#f4f4f5', accent: '#f59e6b', status: { amber: '#a5b4fc', orange: '#f472b6' } },
  { id: 'monochrome', name: '모노크롬', mode: 'dark', bg: '#0a0a0a', fg: '#fafafa', accent: '#d4d4d8' },
  { id: 'mauve', name: '모브 (회보라)', mode: 'dark', bg: '#16131b', fg: '#f3eef7', accent: '#c4a7e7' },
  { id: 'mocha', name: '모카 (갈색)', mode: 'dark', bg: '#191411', fg: '#f5ede6', accent: '#d9a46f', status: { amber: '#9fc4d9', orange: '#e48fa8' } },
  { id: 'slate', name: '슬레이트 (청회색)', mode: 'dark', bg: '#0e131a', fg: '#e8eef5', accent: '#7fb0d9' },
  { id: 'dracula', name: 'Dracula', mode: 'dark', bg: '#21222c', fg: '#f8f8f2', accent: '#bd93f9' },
  { id: 'nord', name: 'Nord', mode: 'dark', bg: '#2e3440', fg: '#eceff4', accent: '#88c0d0' },
  { id: 'tokyo-night', name: 'Tokyo Night', mode: 'dark', bg: '#1a1b26', fg: '#c0caf5', accent: '#7aa2f7' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', mode: 'dark', bg: '#1e1e2e', fg: '#cdd6f4', accent: '#cba6f7' },
  { id: 'gruvbox', name: 'Gruvbox', mode: 'dark', bg: '#1d2021', fg: '#ebdbb2', accent: '#fe8019', status: { amber: '#d3869b', orange: '#83a598', emerald: '#b8bb26', rose: '#fb4934' } },
  { id: 'rose-pine', name: 'Rosé Pine', mode: 'dark', bg: '#191724', fg: '#e0def4', accent: '#ebbcba' },
  { id: 'solarized-dark', name: 'Solarized Dark', mode: 'dark', bg: '#002b36', fg: '#eee8d5', accent: '#2aa198' },
  { id: 'light', name: '라이트 (민트)', mode: 'light', bg: '#f4f5f7', fg: '#111113', accent: '#0f9f6e', surface: '#ffffff' },
  { id: 'solarized-light', name: 'Solarized Light', mode: 'light', bg: '#fdf6e3', fg: '#073642', accent: '#268bd2', surface: '#fffbef' },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', mode: 'light', bg: '#eff1f5', fg: '#4c4f69', accent: '#8839ef', surface: '#ffffff' },
];

export const DEFAULT_THEME_ID = 'default';

// 상태 색 기준값 (Tailwind 400 수준). 라이트 테마에서는 글자로 읽히도록 fg 쪽으로 어둡게 옮긴다.
const STATUS_BASE = {
  amber: '#fbbf24',
  rose: '#fb7185',
  emerald: '#34d399',
  sky: '#38bdf8',
  orange: '#fb923c',
};

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// a 에서 b 쪽으로 t 만큼 섞기 (t=0 → a, t=1 → b)
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

const triplet = (hex: string) => hexToRgb(hex).join(' ');

// 색 하나로 100~900 단계를 만든다: 낮은 단계는 fg 쪽, 높은 단계는 bg 쪽.
function scale(base: string, fg: string, bg: string): Record<string, string> {
  return {
    50: mix(base, fg, 0.85),
    100: mix(base, fg, 0.72),
    200: mix(base, fg, 0.52),
    300: mix(base, fg, 0.28),
    400: base,
    500: mix(base, bg, 0.12),
    600: mix(base, bg, 0.25),
    700: mix(base, bg, 0.4),
    800: mix(base, bg, 0.55),
    900: mix(base, bg, 0.7),
    950: mix(base, bg, 0.82),
  };
}

// 테마 → CSS 변수 값 (모두 "R G B" 형식)
export function buildThemeVars(theme: AppTheme): Record<string, string> {
  const { bg, fg, accent } = theme;
  const vars: Record<string, string> = {};
  const set = (name: string, hex: string) => (vars[`--c-${name}`] = triplet(hex));

  set('white', fg);
  // "black": 다크 테마에선 순흑, 라이트 테마에선 순백 (모달 배경막 등)
  set('black', theme.mode === 'dark' ? '#000000' : '#ffffff');
  set('paper', '#ffffff'); // 증권사 로고 바탕 등 항상 흰색
  set('shadow', theme.mode === 'dark' ? '#000000' : mix(fg, bg, 0.3));

  // 표면: bg 에서 fg 쪽으로 단계적으로
  const inkSteps: Record<string, number> = { 950: 0, 900: 0.016, 850: 0.035, 800: 0.055, 700: 0.085, 600: 0.13, 500: 0.2 };
  Object.entries(inkSteps).forEach(([k, t]) => set(`ink-${k}`, mix(bg, fg, t)));
  set('surface', theme.surface ?? mix(bg, fg, 0.03));

  // 중립 글자: fg 비율
  const zincSteps: Record<string, number> = {
    50: 0.97, 100: 0.92, 200: 0.84, 300: 0.72, 400: 0.6, 500: 0.45, 600: 0.33, 700: 0.22, 800: 0.14, 900: 0.08, 950: 0.04,
  };
  Object.entries(zincSteps).forEach(([k, t]) => set(`zinc-${k}`, mix(bg, fg, t)));

  Object.entries(scale(accent, fg, bg)).forEach(([k, v]) => set(`mint-${k}`, v));
  (Object.keys(STATUS_BASE) as (keyof typeof STATUS_BASE)[]).forEach((name) => {
    const raw = theme.status?.[name] ?? STATUS_BASE[name];
    const base = theme.mode === 'light' ? mix(raw, fg, 0.38) : raw;
    Object.entries(scale(base, fg, bg)).forEach(([k, v]) => set(`${name}-${k}`, v));
  });

  vars['--shadow-k'] = theme.mode === 'dark' ? '1' : '0.18';
  vars['color-scheme'] = theme.mode;
  return vars;
}

export function getTheme(id: string): AppTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
