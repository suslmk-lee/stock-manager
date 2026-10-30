/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 거의 검정에 가까운 무채색 면 (배경 → 카드 → 테두리 순으로 밝아짐)
        ink: {
          950: '#060607',
          900: '#0a0a0b',
          850: '#0f0f11',
          800: '#141416',
          700: '#1c1c1f',
          600: '#26262a',
          500: '#3a3a40',
        },
        // 포인트 컬러: 링 게이지·체크 아이콘의 민트
        mint: {
          200: '#c9f5e2',
          300: '#a3ecc9',
          400: '#7ddfb0',
          500: '#56cf97',
          600: '#34b37b',
        },
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
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
