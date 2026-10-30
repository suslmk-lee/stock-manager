import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState, CSSProperties } from 'react';
import { buildThemeVars, getTheme, hexToRgb, rgbToHex, DEFAULT_THEME_ID, AppTheme } from './themes';
import {
  DEFAULT_CARD_STYLE, DEFAULT_FONT_SIZE, DEFAULT_MONO, DEFAULT_SANS, FONT_SIZES, FontSizeId,
  MONO_FALLBACK, MONO_FONTS, SANS_FALLBACK, SANS_FONTS, CARD_STYLES, CURSOR_TRAIL_LIMITS,
} from './options';

// 커서를 따라다니는 점 체인 효과 (장식용, 기본 꺼짐)
export interface CursorTrailSettings {
  enabled: boolean;
  nodes: number; // 점 개수
  ease: number; // 앞 점을 따라가는 빠르기 (클수록 빠름)
  headSize: number; // 머리 점 지름(px)
  taper: number; // 꼬리로 갈수록 작아지는 정도 (0~1)
  gradient: boolean; // 체인을 따라 mint → sky 그라디언트
}

export const DEFAULT_CURSOR_TRAIL: CursorTrailSettings = {
  enabled: false, nodes: 14, ease: 0.34, headSize: 24, taper: 0.8, gradient: false,
};

export interface AppearanceSettings {
  themeId: string;
  cardStyle: string;
  sansFont: string;
  monoFont: string;
  fontSize: FontSizeId;
  cursorTrail: CursorTrailSettings;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeId: DEFAULT_THEME_ID,
  cardStyle: DEFAULT_CARD_STYLE,
  sansFont: DEFAULT_SANS,
  monoFont: DEFAULT_MONO,
  fontSize: DEFAULT_FONT_SIZE,
  cursorTrail: DEFAULT_CURSOR_TRAIL,
};

// index.html 의 첫 페인트 전 스크립트도 이 키를 읽는다 (깜빡임 방지)
const STORAGE_KEY = 'sm-appearance';

const clampNum = (v: unknown, lim: { min: number; max: number }, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(lim.max, Math.max(lim.min, v)) : def;

// 저장값(없거나 깨졌을 수 있음)을 기본값과 합치고 범위로 보정
function sanitizeCursorTrail(raw: unknown): CursorTrailSettings {
  const d = DEFAULT_CURSOR_TRAIL;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = CURSOR_TRAIL_LIMITS;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    nodes: Math.round(clampNum(r.nodes, L.nodes, d.nodes)),
    ease: clampNum(r.ease, L.ease, d.ease),
    headSize: clampNum(r.headSize, L.headSize, d.headSize),
    taper: clampNum(r.taper, L.taper, d.taper),
    gradient: typeof r.gradient === 'boolean' ? r.gradient : d.gradient,
  };
}

function loadSettings(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const saved = JSON.parse(raw)?.settings ?? {};
    const merged = { ...DEFAULT_APPEARANCE, ...saved } as AppearanceSettings;
    // 사라진 선택지가 저장돼 있으면 기본값으로
    if (!CARD_STYLES.some((c) => c.id === merged.cardStyle)) merged.cardStyle = DEFAULT_CARD_STYLE;
    if (!SANS_FONTS.some((f) => f.id === merged.sansFont)) merged.sansFont = DEFAULT_SANS;
    if (!MONO_FONTS.some((f) => f.id === merged.monoFont)) merged.monoFont = DEFAULT_MONO;
    if (!FONT_SIZES.some((f) => f.id === merged.fontSize)) merged.fontSize = DEFAULT_FONT_SIZE;
    merged.cursorTrail = sanitizeCursorTrail(saved.cursorTrail);
    return merged;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

// 설정 → <html> 에 적용할 CSS 변수/속성
export function computeRootStyle(s: AppearanceSettings) {
  const theme = getTheme(s.themeId);
  const vars: Record<string, string> = { ...buildThemeVars(theme) };
  const sans = SANS_FONTS.find((f) => f.id === s.sansFont) ?? SANS_FONTS[0];
  const mono = MONO_FONTS.find((f) => f.id === s.monoFont) ?? MONO_FONTS[0];
  vars['--font-sans'] = `${sans.family}, ${SANS_FALLBACK}`;
  vars['--font-mono'] = `${mono.family}, ${MONO_FALLBACK}`;
  vars['font-size'] = `${FONT_SIZES.find((f) => f.id === s.fontSize)?.px ?? 16}px`;
  return { vars, attrs: { 'data-card': s.cardStyle, 'data-theme-mode': theme.mode, 'data-theme': theme.id } };
}

function applyToRoot(s: AppearanceSettings) {
  const root = document.documentElement;
  const { vars, attrs } = computeRootStyle(s);
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  Object.entries(attrs).forEach(([k, v]) => root.setAttribute(k, v));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: s, vars, attrs }));
  } catch {
    // 저장 불가(사생활 모드 등)여도 화면 적용은 유지
  }
}

// main.tsx 에서 첫 렌더 전에 호출 → 저장된 테마로 바로 그려진다
export function initAppearance() {
  applyToRoot(loadSettings());
}

interface AppearanceContextValue {
  settings: AppearanceSettings;
  theme: AppTheme;
  update: (patch: Partial<AppearanceSettings>) => void;
  reset: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppearanceSettings>(loadSettings);

  useEffect(() => {
    applyToRoot(settings);
  }, [settings]);

  const update = useCallback((patch: Partial<AppearanceSettings>) => setSettings((prev) => ({ ...prev, ...patch })), []);
  const reset = useCallback(() => setSettings(DEFAULT_APPEARANCE), []);

  const value = useMemo(
    () => ({ settings, theme: getTheme(settings.themeId), update, reset }),
    [settings, update, reset],
  );
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within AppearanceProvider');
  return ctx;
}

export interface ThemeColors {
  mode: 'dark' | 'light';
  accent: string; // 강조 (차트 주 계열, 인출 가능)
  accentSoft: string;
  restricted: string; // 인출 제한 · 연금 (앰버)
  positive: string;
  negative: string;
  text: string; // 최대 대비 글자
  muted: string; // 보조 글자
  axis: string; // 차트 축 글자
  grid: string; // 차트 격자/트랙
  surface: string;
  palette: string[]; // 파이·범주형 차트용
  tooltip: { contentStyle: CSSProperties; labelStyle: CSSProperties; itemStyle: CSSProperties };
}

// 앞에서부터 고르되, 이미 고른 색과 너무 비슷한 색은 건너뛴다 (강조색이 상태색과 겹치는 테마 대비)
function distinctColors(colors: string[], minDist = 70): string[] {
  const picked: string[] = [];
  for (const col of colors) {
    const [r, g, b] = hexToRgb(col);
    const close = picked.some((p) => {
      const [pr, pg, pb] = hexToRgb(p);
      return Math.hypot(r - pr, g - pg, b - pb) < minDist;
    });
    if (!close) picked.push(col);
  }
  return picked;
}

const hexOf = (vars: Record<string, string>, name: string) =>
  rgbToHex(vars[`--c-${name}`].split(' ').map(Number) as [number, number, number]);

// Recharts 처럼 CSS 클래스를 못 쓰는 곳(SVG 속성, 인라인 스타일)에서 현재 테마 색을 쓰기 위한 훅
export function useThemeColors(): ThemeColors {
  const { settings, theme } = useAppearance();
  return useMemo(() => {
    const v = buildThemeVars(getTheme(settings.themeId));
    const c = (n: string) => hexOf(v, n);
    const surface = c('surface');
    const border = theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
    return {
      mode: theme.mode,
      accent: c('mint-400'),
      accentSoft: c('mint-300'),
      restricted: c('amber-400'),
      positive: c('mint-400'),
      negative: c('rose-400'),
      text: c('white'),
      muted: c('zinc-400'),
      axis: c('zinc-500'),
      grid: c('ink-600'),
      surface,
      palette: distinctColors([c('mint-400'), c('sky-400'), c('amber-400'), c('rose-400'), c('orange-400'), c('emerald-400'), c('mint-200'), c('sky-200'), c('amber-200'), c('rose-200'), c('zinc-400')]),
      tooltip: {
        contentStyle: { background: c('ink-850'), border: `1px solid ${border}`, borderRadius: 12, fontSize: 12, color: c('zinc-100') },
        labelStyle: { color: c('zinc-300') },
        itemStyle: { color: c('zinc-100') },
      },
    };
  }, [settings.themeId, theme.mode]);
}
