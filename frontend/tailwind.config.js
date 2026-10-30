/** @type {import('tailwindcss').Config} */

// 모든 색은 테마 CSS 변수(--c-…, "R G B" 형식)를 따른다. 값은 src/appearance/themes.ts 가 채운다.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const scale = (name) => Object.fromEntries(SHADES.map((s) => [s, v(`${name}-${s}`)]));

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        white: v('white'), // 최대 대비 글자/오버레이 (라이트 테마에서는 어두운 색)
        black: v('black'),
        paper: v('paper'), // 항상 흰색 (증권사 로고 바탕)
        surface: v('surface'),
        // 거의 검정에 가까운 무채색 면 (배경 → 카드 → 테두리 순으로 밝아짐)
        ink: {
          950: v('ink-950'),
          900: v('ink-900'),
          850: v('ink-850'),
          800: v('ink-800'),
          700: v('ink-700'),
          600: v('ink-600'),
          500: v('ink-500'),
        },
        zinc: scale('zinc'),
        // 포인트 컬러 (테마 강조색)
        mint: scale('mint'),
        amber: scale('amber'),
        rose: scale('rose'),
        emerald: scale('emerald'),
        sky: scale('sky'),
        orange: scale('orange'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
}
