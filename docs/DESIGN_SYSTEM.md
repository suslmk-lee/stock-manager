# 디자인 시스템 — 다크 글라스 테마 UI 키트 (이식용)

> 이 문서는 **앱 주제와 무관한(app-agnostic)** 디자인 시스템 명세입니다.
> "이 문서를 보고 X 앱에 같은 디자인을 적용해 줘"라는 요청을 받은 AI/개발자가, 이 문서 하나만으로
> 색·타이포·카드 스타일 8종·테마 17종·컴포넌트·모션·효과 설정·설정 화면·데스크톱 통합까지
> 동일한 look & feel 을 재현할 수 있도록 작성되었습니다.
>
> - 스택 전제: **React 18 + TypeScript + Tailwind CSS 3 + Vite** (차트는 Recharts, 아이콘은 lucide-react).
> - 코드 블록은 원본 소스를 그대로 옮긴 것입니다. 값(길이·투명도·반경·z-index·easing)을 임의로 바꾸지 마세요.
> - 도메인 용어는 모두 중립 표현으로 바꿨습니다 (예: "대표 카드(hero)", "항목 카드", "총계", "메트릭").

## 목차

1. 개요 & 디자인 원칙
2. 빠른 적용 체크리스트
3. 토큰 — 색 변수 체계 / 17 테마 / 스케일 생성 알고리즘
4. 타이포그래피
5. 카드 스타일 시스템 (변수 계약 + 8종 전체)
6. 컴포넌트 카탈로그 & 레이아웃 패턴
7. 애니메이션 & 모션
8. 효과 설정 (Effects)
9. 모양 설정 화면 스펙
10. 데스크톱 통합 (선택) — 웹 · Wails(Go) · Tauri(Rust), 웹뷰 호환성
11. 차트 스타일 가이드 (Recharts)
12. 함정 & 교훈
13. 부록 — 파일 매니페스트 / 스타터 스니펫

---

## 1. 개요 & 디자인 원칙

### 1.1 한 줄 요약

**"거의 검정에 가까운 면 위에, 흰색 알파(투명도)로 쌓아 올린 유리 질감 카드와 단 하나의 강조색(민트)."**
단, 그 "모양"은 하드코딩이 아니라 전부 **CSS 변수**이고, 사용자가 테마(17)·카드 스타일(8)·글꼴·효과를 런타임에 바꿀 수 있습니다.

### 1.2 원칙

| # | 원칙 | 의미 / 규칙 |
|---|------|-------------|
| 1 | **다크 글라스 기본** | 기본 테마는 순흑에 가까운 `#060607` 배경 + 흰색 알파 8~16% 테두리, 위쪽 1px 안쪽 하이라이트(`inset 0 1px 0`), 깊고 넓은 그림자. 카드 블러는 기본 `none`(성능) — 블러는 pill/오로라 스타일에서만. |
| 2 | **토큰 우선(tokens-first)** | 화면 코드는 `slate-*`, `#hex`, `rgba()` 를 직접 쓰지 않는다. 오직 `ink-*`, `zinc-*`, `mint-*`, `white`, `black`, `paper`, `surface` 토큰과 `.surface`/`.btn-*` 같은 컴포넌트 클래스만 쓴다. |
| 3 | **전부 테마 구동(theme-driven)** | Tailwind 색은 모두 `rgb(var(--c-…) / <alpha-value>)`. 변수 한 벌을 바꾸면 앱 전체(차트·SVG 포함)가 따라온다. 차트처럼 CSS 클래스를 못 쓰는 곳은 `useThemeColors()` 훅으로 같은 값을 JS 로 읽는다. |
| 4 | **모양은 카드 스타일 변수가 결정** | `.surface`, `.btn-primary` 등은 `--card-*`, `--btn-*` 변수만 읽는다. 8개 스타일은 이 변수 값만 다르게 정의한 `[data-card="…"]` 블록이다. 새 스타일 = 새 변수 블록 하나. |
| 5 | **효과는 옵트인, 기본 꺼짐** | 카드 그라데이션(광원)·카드 입체감(그림자/기울기/떠오름)·커서 포인터·커서 트레일은 모두 `enabled:false`/`native` 가 기본. 꺼져 있을 때 CSS 변수는 `none` / `0 0 #0000` 으로 중립. |
| 6 | **모션 감소 존중** | `prefers-reduced-motion: reduce` 에서 전역 transition/animation 지속시간을 0.01ms 로, 무한 애니메이션(보더 빔 등)은 `none` 으로, JS 효과(커서·틸트·CountUp)는 아예 동작하지 않거나 즉시 값 적용. |
| 7 | **글꼴·크기도 설정** | 본문 글꼴 6종, 고정폭 글꼴 4종, 글자 크기 3단계(루트 `font-size` 15/16/17px). rem 기반이라 전체가 비례한다. |
| 8 | **고정 창은 중립** | 모달·드롭다운·토스트(`.fixed`, `[role=dialog]`) 안에서는 카드 그라데이션/입체감 변수를 `none` 으로 리셋해 장식 효과가 팝업에 새지 않게 한다. |

### 1.3 시각 언어 요약

- **면 계층**: `ink-950`(배경) → `ink-900/850/800`(패널) → `ink-700/600/500`(타일·테두리·썸). 낮은 번호일수록 배경에 가깝다.
- **글자 계층**: `white`(제목·값) → `zinc-100/200`(본문) → `zinc-300/400`(보조) → `zinc-500`(라벨·힌트) → `zinc-600`(placeholder).
- **강조색**: `mint-*` 하나가 "활성/긍정/선택/포커스". 상태색(`amber/rose/emerald/sky/orange`)은 의미 전용.
- **라벨은 고정폭**: 작은 설명 문구와 숫자 라벨은 `font-mono 11px` (`label-mono`). 큰 숫자는 `font-light` + `tracking-tight` + `tabular-nums`.
- **둥근 정도**는 카드 스타일이 정한다 (glass 24px … brutal 4px). 컴포넌트는 `rounded-*` 를 직접 쓰지 않고 `--*-radius` 변수를 쓴다.

---

## 2. 빠른 적용 체크리스트

새 React + Tailwind 앱에 이식하는 **순서**입니다. 각 단계의 코드는 이후 장(章)과 부록 13에 전부 있습니다.

1. **의존성 설치**
   ```bash
   npm i lucide-react recharts pretendard
   npm i @fontsource/noto-sans-kr @fontsource/ibm-plex-sans-kr @fontsource/nanum-gothic @fontsource/gowun-dodum
   npm i @fontsource/jetbrains-mono @fontsource/ibm-plex-mono @fontsource/fira-code @fontsource/nanum-gothic-coding
   ```
   (Tailwind 3 + PostCSS + autoprefixer 는 이미 있다고 가정. Tailwind 4 라면 `tailwind.config.js` 의 `colors` 매핑을 `@theme` 로 옮겨야 함 — 이 문서는 v3 기준.)
2. **`tailwind.config.js`** 를 §3.1 대로 교체 (색 → CSS 변수 매핑, `fontFamily` → `var(--font-sans/mono)`, `4xl` 반경, `fade-up` 애니메이션).
3. **`src/appearance/fonts.css`** 복사 (글꼴 `@import`) — §4.
4. **`src/styles/card-styles.css`** 복사 (변수 계약 + 8개 스타일) — §5. 이 파일은 `@apply` 가 없는 순수 CSS.
5. **`src/index.css`** 교체 — 맨 위에서 `fonts.css`, `card-styles.css` 를 `@import` 한 뒤 `@tailwind base/components/utilities`, 그 아래 `@layer components` 의 컴포넌트 클래스, 키프레임, reduced-motion 블록 — §6, §7.
6. **`src/appearance/themes.ts`, `options.ts`, `AppearanceContext.tsx`** 복사 — §3, §8. (`AppearanceContext` 의 제목 표시줄 호출은 `apiClient` 대신 §10.0 의 **데스크톱 브리지** `desktop.setTitleBarColors()` 로 연결 — 웹·Wails·Tauri 어디서나 같은 코드.)
7. **`main.tsx`**: `import './index.css'` 후 **렌더 전에** `initAppearance()` 호출, 그 다음 `<AppearanceProvider>` 로 감싸고 효과 컴포넌트 3개(`CursorTrail`, `CursorPointer`, `CardTilt`)를 Provider 안쪽 최상단에 마운트 — §8.
8. **`src/components/ui/*`** 복사: `IconTile`, `Chip`, `Switch`, `Slider(+slider.css)`, `SettingsGroup`(SettingsGroup/SettingRow), `Portal`, `CardStack`, `RingGauge`, `Brand` — §6.
9. **`src/components/effects/*`** 복사 — §8.
10. **`src/components/settings/AppearanceSettings.tsx`, `CursorPresetGallery.tsx`** 복사 후 미리보기 문구만 앱에 맞게 교체 — §9.
11. **앱 셸** 작성: 최상위 `app-bg` + 상단 은은한 광원 + sticky `app-header` + 탭 카드 + `main.animate-fade-up` — §6.1.
12. **모달은 전부 `<Portal>`** 로 렌더링, 패널에 `role="dialog" aria-modal="true"`, 바깥 오버레이는 `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm` — §6.9, §12.
13. **차트**는 `useThemeColors()` 의 색만 사용 — §11.
14. (선택) **데스크톱 셸**이면 §10.0 브리지 + 셸별 구현: Wails(Go) §10.2–10.3, **Tauri(Rust) §10.5**, 아이콘 §10.4/§10.5.6. WebKit 계열 웹뷰(macOS·Linux)에서 쓸 때는 §10.6 호환성 표를 확인.
15. **검증**: 테마 17 × 카드 스타일 8 조합에서 (a) 라이트 테마에서 글자 대비, (b) 모달이 화면 중앙인지, (c) reduced-motion 에서 보더 빔이 멈추는지, (d) `tailwind.config.js` 변경 후 dev 서버를 **재시작**했는지 확인 (§12).

> 이식 시 가장 흔한 실수: `index.css` 의 `@import` 를 `@tailwind` 뒤에 두는 것(CSS 사양상 `@import` 는 최상단), `initAppearance()` 를 첫 렌더 뒤에 부르는 것(깜빡임), 모달을 Portal 없이 카드 안에 렌더하는 것(중앙에서 어긋남).

---

## 3. 토큰 — 색 변수 체계

### 3.1 Tailwind 매핑 (`tailwind.config.js`)

모든 색은 `rgb(var(--c-NAME) / <alpha-value>)` 로 연결됩니다. 그래서 `bg-white/[0.06]`, `text-mint-400/60`,
`border-white/10` 같은 **알파 유틸리티가 테마와 무관하게 동작**합니다. (변수 값이 `#hex` 가 아니라 `"R G B"` 공백 구분 3값이어야 하는 이유.)

```js
// frontend/tailwind.config.js
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
        paper: v('paper'), // 항상 흰색 (로고 바탕)
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
```

### 3.2 변수 이름 체계

| 변수 | 형식 | 의미 |
|------|------|------|
| `--c-white` | `R G B` | **최대 대비 글자/오버레이색.** 다크 테마에서는 `fg`(거의 흰색). **라이트 테마에서는 어두운 색**(테마 `fg`). 이름이 `white` 이지만 "배경과 가장 대비되는 색"이라는 의미다. `bg-white/[0.06]` 같은 오버레이도 라이트 테마에서는 "어두운 알파"가 된다. |
| `--c-black` | `R G B` | 다크: `#000000`, 라이트: `#ffffff`. 모달 배경막(`bg-black/60`) 용. 라이트 테마에서 흰 배경막이 된다. |
| `--c-paper` | `R G B` | **항상 `#ffffff`.** 로고·이미지처럼 흰 바탕이 필요한 타일(`bg-paper`). 테마와 무관. |
| `--c-shadow` | `R G B` | 그림자 색. 다크: `#000000`. 라이트: `mix(fg, bg, 0.3)` (순흑 그림자를 피한다). |
| `--c-surface` | `R G B` | 카드 바탕. 테마가 `surface` 를 지정하면 그것, 아니면 `mix(bg, fg, 0.03)`. |
| `--c-ink-950 … 500` | `R G B` | 면 계층. `mix(bg, fg, t)`, t = 0 / 0.016 / 0.035 / 0.055 / 0.085 / 0.13 / 0.2 (950, 900, 850, 800, 700, 600, 500). `ink-950` == 테마 `bg`. |
| `--c-zinc-50 … 950` | `R G B` | 중립 글자/면 계층. `mix(bg, fg, t)`, t = .97/.92/.84/.72/.6/.45/.33/.22/.14/.08/.04 (50…950). 50이 가장 fg 에 가깝다. |
| `--c-mint-50 … 950` | `R G B` | **테마 강조색(accent)** 스케일. 이름은 mint 이지만 테마마다 다른 색. |
| `--c-amber/rose/emerald/sky/orange-50 … 950` | `R G B` | 상태색 스케일. 기준값(400) = `STATUS_BASE` 또는 테마 `status` 덮어쓰기. 라이트 테마는 `fg` 쪽으로 38% 어둡게. |
| `--shadow-k` | 숫자 | 그림자 세기 배율. 다크 `1`, 라이트 `0.18`. 그림자 알파에 `calc(0.9 * var(--shadow-k))` 처럼 곱한다. |
| `color-scheme` | `dark`/`light` | `<html>` 에 인라인으로 적용 (스크롤바·폼 컨트롤 기본색). |
| `--font-sans`, `--font-mono` | font-family 목록 | 선택된 글꼴 + 공통 대체 글꼴. |
| `font-size` (root) | `15px/16px/17px` | `<html>` 인라인. |

`<html>` 에는 위 변수들이 **인라인 스타일**로, 그리고 속성 3개가 붙습니다:
`data-card="glass"`, `data-theme-mode="dark|light"`, `data-theme="<id>"`.

**의미 사용 규칙**

| 용도 | 토큰 |
|------|------|
| 앱 배경 | `app-bg` 클래스 (= `var(--app-bg)`, 기본 `ink-950`) |
| 제목·핵심 값 | `text-white` |
| 본문 | `text-zinc-100` / `text-zinc-200` |
| 보조 문구 | `text-zinc-400` |
| 라벨·힌트 | `text-zinc-500` (`label-mono`) |
| placeholder | `placeholder:text-zinc-600` |
| 구분선 | `border-white/[0.06~0.08]`, `bg-white/[0.07]` |
| 강조·활성·긍정 | `mint-300/400` |
| 부정·삭제·하락 | `rose-300/400` (`btn-danger` 는 `rose-200` 글자 + `rose-500/10` 면) |
| 경고·제한 | `amber-*` |
| 정보·보조 계열 | `sky-*` |
| 로고 바탕 | `bg-paper` |
| 모달 배경막 | `bg-black/60 backdrop-blur-sm` |

### 3.3 17개 테마 전체 표

테마는 **배경(bg) · 글자(fg) · 강조(accent)** 3색만 정의하고(필요 시 `surface`, `status`), 나머지는 §3.5 알고리즘이 생성합니다.
`status` 는 강조색이 주황/노랑 계열일 때 상태색(amber·orange 등)과 충돌하지 않도록 덮어쓰는 값입니다.

| # | id | 이름 | mode | bg | fg | accent | surface | status 덮어쓰기 |
|---|----|------|------|----|----|--------|---------|------------------|
| 1 | `default` (기본) | 기본 (블랙 · 민트) | dark | `#060607` | `#ffffff` | `#7ddfb0` | (자동) | — |
| 2 | `graphite-blue` | 그라파이트 · 파랑 | dark | `#111113` | `#f4f4f5` | `#6aa8ff` | (자동) | — |
| 3 | `graphite-orange` | 그라파이트 · 주황 | dark | `#111113` | `#f4f4f5` | `#f59e6b` | (자동) | amber `#a5b4fc`, orange `#f472b6` |
| 4 | `monochrome` | 모노크롬 | dark | `#0a0a0a` | `#fafafa` | `#d4d4d8` | (자동) | — |
| 5 | `mauve` | 모브 (회보라) | dark | `#16131b` | `#f3eef7` | `#c4a7e7` | (자동) | — |
| 6 | `mocha` | 모카 (갈색) | dark | `#191411` | `#f5ede6` | `#d9a46f` | (자동) | amber `#9fc4d9`, orange `#e48fa8` |
| 7 | `slate` | 슬레이트 (청회색) | dark | `#0e131a` | `#e8eef5` | `#7fb0d9` | (자동) | — |
| 8 | `dracula` | Dracula | dark | `#21222c` | `#f8f8f2` | `#bd93f9` | (자동) | — |
| 9 | `nord` | Nord | dark | `#2e3440` | `#eceff4` | `#88c0d0` | (자동) | — |
| 10 | `tokyo-night` | Tokyo Night | dark | `#1a1b26` | `#c0caf5` | `#7aa2f7` | (자동) | — |
| 11 | `catppuccin-mocha` | Catppuccin Mocha | dark | `#1e1e2e` | `#cdd6f4` | `#cba6f7` | (자동) | — |
| 12 | `gruvbox` | Gruvbox | dark | `#1d2021` | `#ebdbb2` | `#fe8019` | (자동) | amber `#d3869b`, orange `#83a598`, emerald `#b8bb26`, rose `#fb4934` |
| 13 | `rose-pine` | Rosé Pine | dark | `#191724` | `#e0def4` | `#ebbcba` | (자동) | — |
| 14 | `solarized-dark` | Solarized Dark | dark | `#002b36` | `#eee8d5` | `#2aa198` | (자동) | — |
| 15 | `light` | 라이트 (민트) | light | `#f4f5f7` | `#111113` | `#0f9f6e` | `#ffffff` | — |
| 16 | `solarized-light` | Solarized Light | light | `#fdf6e3` | `#073642` | `#268bd2` | `#fffbef` | — |
| 17 | `catppuccin-latte` | Catppuccin Latte | light | `#eff1f5` | `#4c4f69` | `#8839ef` | `#ffffff` | — |

- `(자동)` surface = `mix(bg, fg, 0.03)`. 라이트 테마는 카드를 배경보다 **더 밝은 흰색**으로 띄우기 위해 surface 를 명시한다.
- 기본 테마 id = `default`. 알 수 없는 id 는 `THEMES[0]` 로 폴백.
- 설정 UI 에서는 mode 로 "다크 / 라이트" 두 그룹으로 나눠 보여준다.

**상태색 기준값(`STATUS_BASE`, Tailwind 400 수준)**: amber `#fbbf24`, rose `#fb7185`, emerald `#34d399`, sky `#38bdf8`, orange `#fb923c`.

**팔레트 규칙(색 충돌 방지)**
1. 강조색이 주황·노랑 계열(`#f59e6b`, `#d9a46f`, `#fe8019`)이면 `amber`/`orange` 가 강조색과 구분되지 않는다 → `status` 로 amber·orange 를 **보라/청록/분홍 등 다른 색상환 위치로** 옮긴다. Gruvbox 는 자체 팔레트에 맞춰 emerald·rose 까지 바꾼다.
2. 라이트 테마에서 상태색을 그대로 쓰면 흰 배경에서 읽히지 않는다 → `mix(raw, fg, 0.38)` 로 글자색 쪽으로 어둡게.
3. 범주형 차트 팔레트는 `distinctColors()` 로 이미 고른 색과 RGB 거리(유클리드) 70 미만이면 건너뛴다 (§11).
4. 새 테마를 추가할 때는 `{id, name, mode, bg, fg, accent}` 만 넣고 → 강조색이 상태색과 겹치면 `status` 추가 → 라이트면 `surface` 를 `bg` 보다 밝게.

### 3.4 기본 테마의 실제 계산 결과 (참고 값)

`default` (bg `#060607`, fg `#ffffff`, accent `#7ddfb0`):

| 토큰 | 값 | 토큰 | 값 |
|------|----|------|----|
| ink-950 | `#060607` | zinc-50 | `#f8f8f8` |
| ink-900 | `#0a0a0b` | zinc-100 | `#ebebeb` |
| ink-850 | `#0f0f10` | zinc-200 | `#d7d7d7` |
| ink-800 | `#141415` | zinc-300 | `#b9b9ba` |
| ink-700 | `#1b1b1c` | zinc-400 | `#9b9b9c` |
| ink-600 | `#262627` | zinc-500 | `#767677` |
| ink-500 | `#383839` | zinc-600 | `#585859` |
| surface | `#0d0d0e` | zinc-700 | `#3d3d3e` |
| shadow | `#000000` | zinc-800/900/950 | `#29292a` / `#1a1a1b` / `#101011` |

mint 스케일(accent `#7ddfb0`): 50 `#ecfaf3` · 100 `#dbf6e9` · 200 `#c1f0d9` · 300 `#a1e8c6` · **400 `#7ddfb0`** · 500 `#6fc59c` · 600 `#5fa986` · 700 `#4d886c` · 800 `#3c6853` · 900 `#2a473a` · 950 `#1b2d25`.

### 3.5 테마 → 변수 생성 알고리즘 (`themes.ts` 전체)

핵심은 `mix(a, b, t)`(a→b 선형 보간)와 `scale(base, fg, bg)`(base 하나로 11단계 생성: 낮은 단계는 fg 쪽, 높은 단계는 bg 쪽)입니다.

```ts
// frontend/src/appearance/themes.ts
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
  // 상태 색 덮어쓰기 — 강조색이 주황·노랑 계열이면 경고(amber)와 겹치지 않게 바꾼다
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
  set('paper', '#ffffff'); // 로고 바탕 등 항상 흰색
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
```

**스케일 생성 요약**

```
scale(base):
  50  = mix(base, fg, 0.85)    500 = mix(base, bg, 0.12)
  100 = mix(base, fg, 0.72)    600 = mix(base, bg, 0.25)
  200 = mix(base, fg, 0.52)    700 = mix(base, bg, 0.40)
  300 = mix(base, fg, 0.28)    800 = mix(base, bg, 0.55)
  400 = base                   900 = mix(base, bg, 0.70)
                               950 = mix(base, bg, 0.82)
```
라이트 테마에서도 같은 식이다 — 다만 `base` 가 이미 어둡게 조정돼 있고 `bg` 가 밝으므로 "높은 단계 = 배경에 가까운 옅은 색"이 된다.

### 3.6 `<html>` 에 변수를 적용하는 방법

```ts
Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));   // 변수 + font-size + color-scheme
Object.entries(attrs).forEach(([k, v]) => root.setAttribute(k, v));       // data-card / data-theme-mode / data-theme
```
- `[data-card='neumorph']` 같은 선택자는 `:root`(=`<html>`) 속성에도, 미리보기용 중첩 `<div data-card="x">` 에도 매칭된다.
- 라이트 모드 전용 보정은 `[data-theme-mode='light']` 로 건다 (뉴모피즘 하이라이트/그림자 색).

---

## 4. 타이포그래피

### 4.1 글꼴 임포트 (`fonts.css`)

실제로 쓰이는 글꼴·글자 범위만 브라우저가 내려받습니다 (`unicode-range` 서브셋 / Pretendard dynamic subset).

```css
/* frontend/src/appearance/fonts.css */
/* 선택 가능한 글꼴. 실제로 쓰이는 글꼴·글자 범위만 브라우저가 내려받는다. */
@import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';

@import '@fontsource/noto-sans-kr/300.css';
@import '@fontsource/noto-sans-kr/400.css';
@import '@fontsource/noto-sans-kr/500.css';
@import '@fontsource/noto-sans-kr/700.css';

@import '@fontsource/ibm-plex-sans-kr/300.css';
@import '@fontsource/ibm-plex-sans-kr/400.css';
@import '@fontsource/ibm-plex-sans-kr/500.css';
@import '@fontsource/ibm-plex-sans-kr/700.css';

@import '@fontsource/nanum-gothic/400.css';
@import '@fontsource/nanum-gothic/700.css';

@import '@fontsource/gowun-dodum/400.css';

@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/500.css';

@import '@fontsource/ibm-plex-mono/400.css';
@import '@fontsource/ibm-plex-mono/500.css';

@import '@fontsource/fira-code/400.css';
@import '@fontsource/fira-code/500.css';

@import '@fontsource/nanum-gothic-coding/400.css';
@import '@fontsource/nanum-gothic-coding/700.css';
```

### 4.2 글꼴 스택

| 구분 | 기본값 | 선택지 (id: 이름) |
|------|--------|-------------------|
| 본문(sans) | `pretendard` | `pretendard`: Pretendard · `noto-sans-kr`: Noto Sans KR · `ibm-plex-sans-kr`: IBM Plex Sans KR · `nanum-gothic`: 나눔고딕 · `gowun-dodum`: 고운돋움 · `system`: 시스템 기본 |
| 고정폭(mono) | `jetbrains-mono` | `jetbrains-mono` · `ibm-plex-mono` · `fira-code` · `nanum-gothic-coding` |

최종 CSS 변수:
```
--font-sans: <선택 글꼴>, "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif
--font-mono: <선택 글꼴>, "Pretendard Variable", ui-monospace, SFMono-Regular, Menlo, monospace
```
- **mono 대체 글꼴이 Pretendard** 인 이유: 고정폭 글꼴에 한글 글리프가 없을 때(JetBrains Mono 등) 한글만 Pretendard 로 떨어지게 하기 위함.
- Tailwind: `font-sans` → `var(--font-sans)`, `font-mono` → `var(--font-mono)` (§3.1).
- 각 글꼴 옵션은 `{ id, name, family, sample }` — `family` 는 앞부분만, 뒤에 공통 대체 스택이 붙는다. `sample` 은 설정 화면의 글꼴 카드 미리보기 문구 (§9).
- `system` 글꼴의 family: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic"`.

### 4.3 글자 크기

루트 `font-size` 를 바꾸고 모든 크기가 `rem` 이므로 전체가 비례합니다.

| id | 이름 | px | 기본 |
|----|------|----|------|
| `sm` | 작게 | 15 | |
| `md` | 보통 | 16 | ✔ |
| `lg` | 크게 | 17 | |

`body` 기본: `font-sans text-zinc-100`, `-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale`, `font-feature-settings: 'tnum' 0`(본문은 비고정폭 숫자).

### 4.4 타입 스케일 & 역할 클래스

| 역할 | 클래스/유틸리티 | 비고 |
|------|------------------|------|
| 페이지 제목 | `text-2xl font-light tracking-tight text-white` | 옆에 `label-mono` 한 줄(개수 등) |
| 큰 숫자(메트릭) | `num text-2xl font-light tracking-tight text-white` (작은 변화량은 `text-lg`) | `num` = `font-variant-numeric: tabular-nums` |
| 설정 미리보기 큰 값 | `text-3xl font-semibold tracking-tight text-white` | |
| 섹션 제목 | `.section-title` = `text-[15px] font-semibold tracking-tight text-white` | 모달 제목은 `text-base font-semibold text-white` |
| 카드 제목 | `text-lg font-medium tracking-tight text-white truncate` | |
| 본문 | `text-sm text-zinc-100/200` | |
| 보조 문단 | `text-sm text-zinc-400` · 설명 `text-xs leading-relaxed text-zinc-500` | |
| 라벨 | `.label-mono` = `font-mono text-[11px] tracking-wide text-zinc-500` | 필요 시 `!text-[10px] uppercase tracking-[0.2em]` (브랜드 태그라인) · `uppercase tracking-widest` (갤러리 그룹 라벨) · `!normal-case` (문장형 라벨) |
| 칩 | `.chip` = `font-mono text-[11px] text-zinc-300` | |
| 테이블 헤더 | `.table-head` = `font-mono text-[11px] font-normal uppercase tracking-wider text-zinc-500` | |
| 배지 | `.badge` = `text-[11px] font-medium` · `.badge-new` = `text-[10px] font-semibold` | |
| 폼 라벨 | `.field-label` = `mb-1.5 block text-xs font-medium text-zinc-400` | |

**숫자 규칙**: 숫자가 갱신/정렬되는 곳은 항상 `tabular-nums`(`num` 클래스 또는 `CountUp` 이 내부에서 부여). 단위·보조 숫자는 mono 라벨로.

### 4.5 워드마크 패턴 (브랜드)

앱 이름을 쓰는 패턴이지 특정 이름이 아닙니다.

- **마크**: 34×34 SVG. 막대 3개(불투명도 0.4 / 0.7 / 1)와 그 위를 가로지르는 상승선 + 끝점 원. 막대는 `mint-500 → sky-300` 대각 그라데이션, 선과 점은 `--c-white`. SVG 에 `drop-shadow(0 4px 14px mint-400/0.35)`.
- **워드마크**: `text-[17px] tracking-tight text-white` 한 줄에 **두 굵기** — 앞 단어 `font-semibold`, 뒤 단어 `font-light text-zinc-400`.
- **태그라인**: 아래에 `label-mono mt-1.5 !text-[10px] uppercase tracking-[0.2em]` 로 `Word · Word` 형태의 mono 문구.
- 좁은 화면(440px 미만)에서는 마크만 보이게 텍스트 블록을 `hidden min-[440px]:block`.
- 전체 코드는 §6.2 `Brand`.

---

## 5. 카드 스타일 시스템

### 5.1 개념

- 컴포넌트 클래스(`.surface`, `.btn-primary`, `.pill-item-active`, `.chip`, `.input-field` …)는 **CSS 변수만 읽는다.**
- 8개 카드 스타일은 `src/styles/card-styles.css` 에서 **같은 변수 집합을 서로 다른 값으로** 정의한 블록이다.
- 선택자는 `:root, [data-card='glass']` (기본) 과 `[data-card='…']`. 변수는 `data-card` 를 가진 **가장 가까운 조상**에서 상속되므로, 설정 화면의 미리보기처럼 다른 스타일 안에 `<div data-card="x">` 를 중첩해도 충돌하지 않는다.
- **모든 스타일은 모든 변수를 정의**해야 한다(누락 시 상위 스타일 값이 상속돼 섞인다).
- `@apply` 를 쓰지 않는 순수 CSS 파일이다 (`@layer` 밖, `index.css` 맨 위에서 `@import`).
- 활성 스타일은 `<html data-card="…">` 로 지정한다 (`AppearanceContext` 가 설정).

### 5.2 변수 계약(Contract) 표

| 그룹 | 변수 | 읽는 곳 | 비고 |
|------|------|---------|------|
| 배경 | `--app-bg` | `body`, `.app-bg` | 단색 또는 여러 radial-gradient (aurora) |
| 헤더 | `--header-bg` (선택, 기본 `rgb(var(--c-ink-950) / 0.7)`) | `.app-header` | aurora 만 `/0.2` 로 정의 |
| 카드 | `--card-radius` `--card-border-w` `--card-border` `--card-bg` `--card-shadow` `--card-blur` | `.surface`, `.card-stack-card`(반경) | `--card-blur` 는 `backdrop-filter` 값 |
| 카드 hover | `--card-hover-border` `--card-hover-shadow` `--card-hover-transform` | `.surface-interactive:hover` | |
| 패널(inset) | `--inset-radius` `--inset-border-w` `--inset-border` `--inset-bg` `--inset-shadow` | `.surface-inset` | 카드 안쪽 패널·스탯 타일 |
| pill | `--pill-radius` `--pill-border-w` `--pill-border` `--pill-bg` `--pill-shadow` `--pill-blur` | `.glass-pill`, `.pill-item`(반경·테두리폭) | |
| pill 활성 | `--pill-active-bg` `--pill-active-fg` `--pill-active-border` `--pill-active-shadow` | `.pill-item-active` | |
| 탭 카드 | `--tab-radius` `--tab-border-w` `--tab-border` `--tab-bg` `--tab-shadow` `--tab-hover-border` | `.tab-card`, 보더 빔 반경 계산 | |
| 탭 활성 | `--tab-active-border` `--tab-active-bg` `--tab-active-shadow` | `.tab-card-active` | |
| 버튼 공통 | `--btn-radius` `--btn-icon-radius` `--btn-border-w` | `.btn-*` | |
| 버튼 primary | `--btn-primary-fg` `-bg` `-hover-bg` `-border` `-shadow` `-active-transform` `-active-shadow` | `.btn-primary` | |
| 버튼 ghost | `--btn-ghost-border` `-bg` `-shadow` `-hover-border` `-hover-bg` | `.btn-ghost`, `.btn-icon:hover` | |
| 버튼 icon | `--btn-icon-border` `-bg` `-shadow` | `.btn-icon` | |
| 아이콘 타일 | `--tile-radius` `--tile-border-w` `--tile-border` `--tile-base` `--tile-glow` `--tile-shadow` | `.icon-tile*` | `--tile-glow` 는 0~1.2 배율(아래쪽 색 글로우 세기) |
| 칩 | `--chip-radius` `--chip-border-w` `--chip-border` `--chip-bg` `--chip-shadow` | `.chip` | |
| 입력 | `--input-radius` `--input-border-w` `--input-border` `--input-bg` `--input-shadow` `--input-focus-border` `--input-focus-shadow` | `.input-field` | |
| 히어로 | `--hero-radius` `--hero-border-w` `--hero-border` `--hero-bg` `--hero-shadow` `--hero-grain-opacity` | `.hero-grain` | `--hero-bg` 는 다중 배경 가능 |
| (스타일 내부) | `--neu-hl` `--neu-sh` (neumorph) · `--glow-ring` (glow) · `--brutal-line` (brutal) | 해당 스타일 블록 안에서만 | 스타일 내부 편의 변수 |
| (효과 주입) | `--fx-glow-card` `--fx-glow-hero` `--fx-depth-card` `--fx-depth-hero` | `.surface`, `.hero-grain` | `AppearanceContext` 가 `<html>` 에 설정 (§8). 카드 스타일 파일에는 정의하지 않는다. |
| (테마 주입) | `--shadow-k` + `--c-*` | 전부 | §3 |

**작성 규칙**
1. 그림자 값에는 `none` 대신 **`0 0 #0000`** 을 쓴다 (사유: §8.4 / §12) — 효과 그림자를 앞에 덧붙이는 `box-shadow: var(--fx-depth-card, 0 0 #0000), var(--card-shadow)` 가 `none` 때문에 통째로 무효가 되는 것을 막기 위해. (단, `--tab-shadow`, `--btn-ghost-shadow` 처럼 앞에 덧붙이지 않는 변수는 `none` 이어도 무방하다.)
2. 그림자 알파는 `calc(N * var(--shadow-k))` 로 감쇠 — 라이트 테마에서 검은 그림자가 과하지 않게.
3. 색은 `rgb(var(--c-white) / a)`, `rgb(var(--c-mint-400) / a)` 로만 표현 — 테마 연동.
4. 테두리 없는 스타일(flat, neumorph, aurora)은 `*-border-w: 0px` + `*-border: transparent`.
5. 스타일 선택 시 컴포넌트 마크업은 바뀌지 않는다. 마크업에서 `rounded-*`/`shadow-*` 로 모양을 고정하지 말 것(필요한 예외는 `!rounded-md` 같은 미리보기 용도).

### 5.3 8개 스타일 한눈에 보기

| id | 이름 | 카드 반경 | 테두리 | 그림자 | 블러 | hover | 특징 |
|----|------|-----------|--------|--------|------|-------|------|
| `glass` (기본) | 리퀴드 글라스 | 1.5rem | 1px 흰 8% | inset 하이라이트 + 24px/48px 깊은 그림자 | none | translateY(-1px) | 반투명 유리, 위쪽 광택 그라데이션, 알약 버튼, 히어로에 사선 광원 |
| `minimal` | 모노라인 미니멀 | 10px | 1px 흰 13% | 없음 | none | 테두리만 진해짐(35%) | 선과 간격으로 위계, 탭 활성 = 70% 흰 테두리 |
| `flat` | 플랫 톤 계층 | 20px | 없음 | 없음 | none | 2px 링 | 밝기 단계(ink-800/700/600)로 층 구분, 알약 |
| `neumorph` | 뉴모피즘 | 22px | 없음 | 밝/어두운 그림자 2개 | none | 그림자 확대 | 배경과 같은 색, 오목/볼록 |
| `paper` | 레이어드 페이퍼 | 14px | 1px 흰 6% | 아래로 겹친 종이(0 7px 0 -3px) | none | translateY(-2px) | 3D 눌림 버튼(translateY(2px)) |
| `glow` | 아웃라인 글로우 | 16px | 1px 흰 10% | 없음(hover 시 강조색 링) | none | 민트 링 | 활성 요소만 발광 |
| `aurora` | 오로라 | 22px | 없음 | 부드러운 | blur(18px) saturate(1.2) | translateY(-2px) | 4색 흐린 덩어리 배경 위 반투명 카드 |
| `brutal` | 브루탈리즘 | 4px | 2px 흰 92% | 오프셋 4px 4px 0 | none | translate(-3px,-3px) + 8px 오프셋(민트) | 굵은 선·직각, 눌림 translate(4px,4px) |

### 5.4 전체 소스 (`card-styles.css`) — 8개 변수 블록 원문

> 아래는 **원문 그대로**입니다. 한 줄도 줄이지 말고 복사하세요. (헤더 주석에 변수 목록이 있고, 이어서 glass → minimal → flat → neumorph → paper → glow → aurora → brutal 순.)

```css
/* frontend/src/styles/card-styles.css */
/* 카드 스타일 8종 — 전부 CSS 변수로만 정의한다 (순수 CSS, @apply 없음).
 *
 * index.css 의 .surface / .btn-primary 등은 아래 변수만 읽는다. 변수는 data-card 를 가진
 * 가장 가까운 조상에서 상속되므로, 설정 미리보기처럼 다른 스타일 안에 <div data-card="x"> 를
 * 중첩해도 서로 충돌하지 않는다. 모든 스타일이 모든 변수를 정의해야 한다(누락 시 상속됨).
 *
 * 변수 목록
 *   배경     --app-bg
 *   카드     --card-radius --card-border-w --card-border --card-bg --card-shadow --card-blur
 *            --card-hover-border --card-hover-shadow --card-hover-transform
 *   패널     --inset-radius --inset-border-w --inset-border --inset-bg --inset-shadow
 *   pill     --pill-radius --pill-border-w --pill-border --pill-bg --pill-shadow --pill-blur
 *            --pill-active-bg --pill-active-fg --pill-active-border --pill-active-shadow
 *   탭 카드  --tab-radius --tab-border-w --tab-border --tab-bg --tab-shadow --tab-hover-border
 *            --tab-active-border --tab-active-bg --tab-active-shadow
 *   버튼     --btn-radius --btn-icon-radius --btn-border-w
 *            --btn-primary-fg/-bg/-hover-bg/-border/-shadow/-active-transform/-active-shadow
 *            --btn-ghost-border/-bg/-shadow/-hover-border/-hover-bg
 *            --btn-icon-border/-bg/-shadow
 *   아이콘   --tile-radius --tile-border-w --tile-border --tile-base --tile-glow --tile-shadow
 *   칩       --chip-radius --chip-border-w --chip-border --chip-bg --chip-shadow
 *   입력     --input-radius --input-border-w --input-border --input-bg --input-shadow
 *            --input-focus-border --input-focus-shadow
 *   히어로   --hero-radius --hero-border-w --hero-border --hero-bg --hero-shadow --hero-grain-opacity
 */

/* ---------------------------------------------------------------- glass (기본) */
:root,
[data-card='glass'] {
  --app-bg: rgb(var(--c-ink-950));

  --card-radius: 1.5rem;
  --card-border-w: 1px;
  --card-border: rgb(var(--c-white) / 0.08);
  --card-bg: linear-gradient(180deg, rgb(var(--c-white) / 0.045) 0%, rgb(var(--c-white) / 0.012) 100%), rgb(var(--c-surface));
  --card-shadow: inset 0 1px 0 rgb(var(--c-white) / 0.06), 0 24px 48px -24px rgb(var(--c-shadow) / calc(0.9 * var(--shadow-k)));
  --card-blur: none;
  --card-hover-border: rgb(var(--c-white) / 0.16);
  --card-hover-shadow: inset 0 1px 0 rgb(var(--c-white) / 0.09), 0 28px 56px -24px rgb(var(--c-shadow) / calc(0.95 * var(--shadow-k)));
  --card-hover-transform: translateY(-1px);

  --inset-radius: 1rem;
  --inset-border-w: 1px;
  --inset-border: rgb(var(--c-white) / 0.07);
  --inset-bg: linear-gradient(180deg, rgb(var(--c-white) / 0.035), rgb(var(--c-white) / 0.015));
  --inset-shadow: inset 0 1px 0 rgb(var(--c-white) / 0.04);

  --pill-radius: 9999px;
  --pill-border-w: 1px;
  --pill-border: rgb(var(--c-white) / 0.09);
  --pill-bg: rgb(var(--c-white) / 0.035);
  --pill-shadow: inset 0 1px 0 rgb(var(--c-white) / 0.05);
  --pill-blur: blur(24px);
  --pill-active-bg: rgb(var(--c-white) / 0.09);
  --pill-active-fg: rgb(var(--c-white));
  --pill-active-border: transparent;
  --pill-active-shadow: inset 0 1px 0 rgb(var(--c-white) / 0.08);

  --tab-radius: 1rem;
  --tab-border-w: 1px;
  --tab-border: rgb(var(--c-white) / 0.07);
  --tab-bg: linear-gradient(180deg, rgb(var(--c-white) / 0.03), rgb(var(--c-white) / 0.008));
  --tab-shadow: none;
  --tab-hover-border: rgb(var(--c-white) / 0.14);
  --tab-active-border: rgb(var(--c-white) / 0.22);
  --tab-active-bg: linear-gradient(180deg, rgb(var(--c-white) / 0.075), rgb(var(--c-white) / 0.02));
  --tab-active-shadow: inset 0 1px 0 rgb(var(--c-white) / 0.1), 0 16px 32px -18px rgb(var(--c-shadow) / calc(0.9 * var(--shadow-k)));

  --btn-radius: 9999px;
  --btn-icon-radius: 9999px;
  --btn-border-w: 1px;
  --btn-primary-fg: rgb(var(--c-ink-950));
  --btn-primary-bg: linear-gradient(180deg, rgb(var(--c-white)) 0%, rgb(var(--c-zinc-200)) 100%);
  --btn-primary-hover-bg: linear-gradient(180deg, rgb(var(--c-white)) 0%, rgb(var(--c-zinc-100)) 100%);
  --btn-primary-border: transparent;
  --btn-primary-shadow: inset 0 -1px 0 rgb(var(--c-shadow) / calc(0.12 * var(--shadow-k))), 0 8px 20px -10px rgb(var(--c-white) / 0.35);
  --btn-primary-active-transform: none;
  --btn-primary-active-shadow: inset 0 -1px 0 rgb(var(--c-shadow) / calc(0.12 * var(--shadow-k))), 0 8px 20px -10px rgb(var(--c-white) / 0.35);
  --btn-ghost-border: rgb(var(--c-white) / 0.14);
  --btn-ghost-bg: linear-gradient(180deg, rgb(var(--c-white) / 0.06), rgb(var(--c-white) / 0.015));
  --btn-ghost-shadow: none;
  --btn-ghost-hover-border: rgb(var(--c-white) / 0.24);
  --btn-ghost-hover-bg: rgb(var(--c-white) / 0.06);
  --btn-icon-border: rgb(var(--c-white) / 0.08);
  --btn-icon-bg: rgb(var(--c-white) / 0.03);
  --btn-icon-shadow: none;

  --tile-radius: 0.75rem;
  --tile-border-w: 1px;
  --tile-border: rgb(var(--c-white) / 0.1);
  --tile-base: linear-gradient(180deg, rgb(var(--c-ink-600)) 0%, rgb(var(--c-ink-800)) 100%);
  --tile-glow: 1;
  --tile-shadow: inset 0 1px 0 rgb(var(--c-white) / 0.1), 0 6px 16px -8px rgb(var(--c-shadow) / calc(0.9 * var(--shadow-k)));

  --chip-radius: 0.5rem;
  --chip-border-w: 1px;
  --chip-border: rgb(var(--c-white) / 0.07);
  --chip-bg: rgb(var(--c-white) / 0.045);
  --chip-shadow: none;

  --input-radius: 0.75rem;
  --input-border-w: 1px;
  --input-border: rgb(var(--c-white) / 0.1);
  --input-bg: rgb(var(--c-white) / 0.035);
  --input-shadow: none;
  --input-focus-border: rgb(var(--c-mint-400) / 0.5);
  --input-focus-shadow: 0 0 0 2px rgb(var(--c-mint-400) / 0.15);

  --hero-radius: 2rem;
  --hero-border-w: 1px;
  --hero-border: rgb(var(--c-white) / 0.09);
  --hero-bg:
    radial-gradient(60% 120% at 8% 0%, rgb(var(--c-white) / 0.22) 0%, rgb(var(--c-white) / 0.06) 35%, transparent 65%),
    linear-gradient(115deg, rgb(var(--c-white) / 0.16) 0%, rgb(var(--c-white) / 0.07) 28%, transparent 46%),
    rgb(var(--c-ink-950));
  --hero-shadow: inset 0 1px 0 rgb(var(--c-white) / 0.08), 0 30px 60px -30px rgb(var(--c-shadow) / calc(0.95 * var(--shadow-k)));
  --hero-grain-opacity: 0.22;
}

/* ---------------------------------------------------------------- minimal */
[data-card='minimal'] {
  --app-bg: rgb(var(--c-ink-950));

  --card-radius: 10px;
  --card-border-w: 1px;
  --card-border: rgb(var(--c-white) / 0.13);
  --card-bg: rgb(var(--c-ink-950));
  --card-shadow: 0 0 #0000; /* 효과 그림자를 앞에 덧붙일 수 있게 none 대신 투명 그림자 */
  --card-blur: none;
  --card-hover-border: rgb(var(--c-white) / 0.35);
  --card-hover-shadow: 0 0 #0000; /* 효과 그림자를 앞에 덧붙일 수 있게 none 대신 투명 그림자 */
  --card-hover-transform: none;

  --inset-radius: 8px;
  --inset-border-w: 1px;
  --inset-border: rgb(var(--c-white) / 0.1);
  --inset-bg: transparent;
  --inset-shadow: none;

  --pill-radius: 8px;
  --pill-border-w: 1px;
  --pill-border: rgb(var(--c-white) / 0.13);
  --pill-bg: transparent;
  --pill-shadow: none;
  --pill-blur: none;
  --pill-active-bg: rgb(var(--c-white) / 0.07);
  --pill-active-fg: rgb(var(--c-white));
  --pill-active-border: rgb(var(--c-white) / 0.3);
  --pill-active-shadow: none;

  --tab-radius: 8px;
  --tab-border-w: 1px;
  --tab-border: rgb(var(--c-white) / 0.1);
  --tab-bg: transparent;
  --tab-shadow: none;
  --tab-hover-border: rgb(var(--c-white) / 0.3);
  --tab-active-border: rgb(var(--c-white) / 0.7);
  --tab-active-bg: transparent;
  --tab-active-shadow: none;

  --btn-radius: 8px;
  --btn-icon-radius: 8px;
  --btn-border-w: 1px;
  --btn-primary-fg: rgb(var(--c-ink-950));
  --btn-primary-bg: rgb(var(--c-white));
  --btn-primary-hover-bg: rgb(var(--c-white) / 0.85);
  --btn-primary-border: rgb(var(--c-white));
  --btn-primary-shadow: none;
  --btn-primary-active-transform: none;
  --btn-primary-active-shadow: none;
  --btn-ghost-border: rgb(var(--c-white) / 0.22);
  --btn-ghost-bg: transparent;
  --btn-ghost-shadow: none;
  --btn-ghost-hover-border: rgb(var(--c-white) / 0.55);
  --btn-ghost-hover-bg: transparent;
  --btn-icon-border: rgb(var(--c-white) / 0.13);
  --btn-icon-bg: transparent;
  --btn-icon-shadow: none;

  --tile-radius: 8px;
  --tile-border-w: 1px;
  --tile-border: rgb(var(--c-white) / 0.18);
  --tile-base: transparent;
  --tile-glow: 0;
  --tile-shadow: none;

  --chip-radius: 6px;
  --chip-border-w: 1px;
  --chip-border: rgb(var(--c-white) / 0.14);
  --chip-bg: transparent;
  --chip-shadow: none;

  --input-radius: 8px;
  --input-border-w: 1px;
  --input-border: rgb(var(--c-white) / 0.18);
  --input-bg: transparent;
  --input-shadow: none;
  --input-focus-border: rgb(var(--c-white) / 0.7);
  --input-focus-shadow: none;

  --hero-radius: 14px;
  --hero-border-w: 1px;
  --hero-border: rgb(var(--c-white) / 0.15);
  --hero-bg: rgb(var(--c-ink-900));
  --hero-shadow: 0 0 #0000; /* 효과 그림자를 앞에 덧붙일 수 있게 none 대신 투명 그림자 */
  --hero-grain-opacity: 0;
}

/* ---------------------------------------------------------------- flat */
[data-card='flat'] {
  --app-bg: rgb(var(--c-ink-950));

  --card-radius: 20px;
  --card-border-w: 0px;
  --card-border: transparent;
  --card-bg: rgb(var(--c-ink-800));
  --card-shadow: 0 0 #0000; /* 효과 그림자를 앞에 덧붙일 수 있게 none 대신 투명 그림자 */
  --card-blur: none;
  --card-hover-border: transparent;
  --card-hover-shadow: 0 0 0 2px rgb(var(--c-white) / 0.08);
  --card-hover-transform: none;

  --inset-radius: 14px;
  --inset-border-w: 0px;
  --inset-border: transparent;
  --inset-bg: rgb(var(--c-ink-700));
  --inset-shadow: none;

  --pill-radius: 9999px;
  --pill-border-w: 0px;
  --pill-border: transparent;
  --pill-bg: rgb(var(--c-ink-800));
  --pill-shadow: none;
  --pill-blur: none;
  --pill-active-bg: rgb(var(--c-ink-500));
  --pill-active-fg: rgb(var(--c-white));
  --pill-active-border: transparent;
  --pill-active-shadow: none;

  --tab-radius: 16px;
  --tab-border-w: 0px;
  --tab-border: transparent;
  --tab-bg: rgb(var(--c-ink-800));
  --tab-shadow: none;
  --tab-hover-border: transparent;
  --tab-active-border: transparent;
  --tab-active-bg: rgb(var(--c-ink-600));
  --tab-active-shadow: none;

  --btn-radius: 9999px;
  --btn-icon-radius: 9999px;
  --btn-border-w: 0px;
  --btn-primary-fg: rgb(var(--c-ink-950));
  --btn-primary-bg: rgb(var(--c-white));
  --btn-primary-hover-bg: rgb(var(--c-white) / 0.88);
  --btn-primary-border: transparent;
  --btn-primary-shadow: none;
  --btn-primary-active-transform: scale(0.98);
  --btn-primary-active-shadow: none;
  --btn-ghost-border: transparent;
  --btn-ghost-bg: rgb(var(--c-ink-600));
  --btn-ghost-shadow: none;
  --btn-ghost-hover-border: transparent;
  --btn-ghost-hover-bg: rgb(var(--c-ink-500));
  --btn-icon-border: transparent;
  --btn-icon-bg: rgb(var(--c-ink-700));
  --btn-icon-shadow: none;

  --tile-radius: 14px;
  --tile-border-w: 0px;
  --tile-border: transparent;
  --tile-base: rgb(var(--c-ink-600));
  --tile-glow: 0.6;
  --tile-shadow: none;

  --chip-radius: 9999px;
  --chip-border-w: 0px;
  --chip-border: transparent;
  --chip-bg: rgb(var(--c-ink-600));
  --chip-shadow: none;

  --input-radius: 14px;
  --input-border-w: 0px;
  --input-border: transparent;
  --input-bg: rgb(var(--c-ink-700));
  --input-shadow: none;
  --input-focus-border: transparent;
  --input-focus-shadow: 0 0 0 2px rgb(var(--c-mint-400) / 0.5);

  --hero-radius: 28px;
  --hero-border-w: 0px;
  --hero-border: transparent;
  --hero-bg: linear-gradient(135deg, rgb(var(--c-mint-400) / 0.18), transparent 60%), rgb(var(--c-ink-800));
  --hero-shadow: 0 0 #0000; /* 효과 그림자를 앞에 덧붙일 수 있게 none 대신 투명 그림자 */
  --hero-grain-opacity: 0.06;
}

/* ---------------------------------------------------------------- neumorph */
[data-card='neumorph'] {
  --neu-hl: rgb(var(--c-white) / 0.09);
  --neu-sh: rgb(var(--c-shadow) / 0.55);
  --app-bg: rgb(var(--c-ink-950));

  --card-radius: 22px;
  --card-border-w: 0px;
  --card-border: transparent;
  --card-bg: rgb(var(--c-ink-950));
  --card-shadow: 9px 9px 20px var(--neu-sh), -7px -7px 18px var(--neu-hl);
  --card-blur: none;
  --card-hover-border: transparent;
  --card-hover-shadow: 12px 12px 26px var(--neu-sh), -9px -9px 22px var(--neu-hl);
  --card-hover-transform: none;

  --inset-radius: 16px;
  --inset-border-w: 0px;
  --inset-border: transparent;
  --inset-bg: rgb(var(--c-ink-950));
  --inset-shadow: inset 5px 5px 11px var(--neu-sh), inset -4px -4px 10px var(--neu-hl);

  --pill-radius: 9999px;
  --pill-border-w: 0px;
  --pill-border: transparent;
  --pill-bg: rgb(var(--c-ink-950));
  --pill-shadow: inset 4px 4px 9px var(--neu-sh), inset -3px -3px 8px var(--neu-hl);
  --pill-blur: none;
  --pill-active-bg: rgb(var(--c-ink-950));
  --pill-active-fg: rgb(var(--c-mint-400));
  --pill-active-border: transparent;
  --pill-active-shadow: 3px 3px 7px var(--neu-sh), -3px -3px 7px var(--neu-hl);

  --tab-radius: 16px;
  --tab-border-w: 0px;
  --tab-border: transparent;
  --tab-bg: rgb(var(--c-ink-950));
  --tab-hover-border: transparent;
  --tab-active-border: transparent;
  --tab-active-bg: rgb(var(--c-ink-950));
  --tab-active-shadow: inset 5px 5px 11px var(--neu-sh), inset -4px -4px 10px var(--neu-hl);
  --tab-shadow: 5px 5px 12px var(--neu-sh), -4px -4px 10px var(--neu-hl);

  --btn-radius: 14px;
  --btn-icon-radius: 12px;
  --btn-border-w: 0px;
  --btn-primary-fg: rgb(var(--c-ink-950));
  --btn-primary-bg: rgb(var(--c-mint-400));
  --btn-primary-hover-bg: rgb(var(--c-mint-300));
  --btn-primary-border: transparent;
  --btn-primary-shadow: 5px 5px 12px var(--neu-sh), -4px -4px 10px var(--neu-hl);
  --btn-primary-active-transform: none;
  --btn-primary-active-shadow: inset 3px 3px 7px rgb(var(--c-shadow) / 0.4), inset -2px -2px 6px var(--neu-hl);
  --btn-ghost-border: transparent;
  --btn-ghost-bg: rgb(var(--c-ink-950));
  --btn-ghost-shadow: 5px 5px 12px var(--neu-sh), -4px -4px 10px var(--neu-hl);
  --btn-ghost-hover-border: transparent;
  --btn-ghost-hover-bg: rgb(var(--c-ink-950));
  --btn-icon-border: transparent;
  --btn-icon-bg: rgb(var(--c-ink-950));
  --btn-icon-shadow: 3px 3px 7px var(--neu-sh), -3px -3px 7px var(--neu-hl);

  --tile-radius: 14px;
  --tile-border-w: 0px;
  --tile-border: transparent;
  --tile-base: rgb(var(--c-ink-950));
  --tile-glow: 0.5;
  --tile-shadow: 5px 5px 11px var(--neu-sh), -4px -4px 9px var(--neu-hl);

  --chip-radius: 9999px;
  --chip-border-w: 0px;
  --chip-border: transparent;
  --chip-bg: rgb(var(--c-ink-950));
  --chip-shadow: inset 2px 2px 5px var(--neu-sh), inset -2px -2px 5px var(--neu-hl);

  --input-radius: 14px;
  --input-border-w: 0px;
  --input-border: transparent;
  --input-bg: rgb(var(--c-ink-950));
  --input-shadow: inset 4px 4px 9px var(--neu-sh), inset -3px -3px 8px var(--neu-hl);
  --input-focus-border: transparent;
  --input-focus-shadow: inset 4px 4px 9px var(--neu-sh), inset -3px -3px 8px var(--neu-hl), 0 0 0 2px rgb(var(--c-mint-400) / 0.45);

  --hero-radius: 30px;
  --hero-border-w: 0px;
  --hero-border: transparent;
  --hero-bg: linear-gradient(145deg, rgb(var(--c-mint-400) / 0.1), transparent 55%), rgb(var(--c-ink-950));
  --hero-shadow: 12px 12px 26px var(--neu-sh), -9px -9px 22px var(--neu-hl);
  --hero-grain-opacity: 0.06;
}
/* 라이트 테마: 밝은 하이라이트(흰색)와 옅은 그림자 */
[data-theme-mode='light'] [data-card='neumorph'],
[data-theme-mode='light'][data-card='neumorph'] {
  --neu-hl: rgb(255 255 255 / 0.95);
  --neu-sh: rgb(var(--c-shadow) / 0.32);
}

/* ---------------------------------------------------------------- paper */
[data-card='paper'] {
  --app-bg: rgb(var(--c-ink-950));

  --card-radius: 14px;
  --card-border-w: 1px;
  --card-border: rgb(var(--c-white) / 0.06);
  --card-bg: rgb(var(--c-surface));
  --card-shadow:
    0 1px 0 rgb(var(--c-white) / 0.06),
    0 7px 0 -3px rgb(var(--c-ink-800)),
    0 14px 24px -12px rgb(var(--c-shadow) / calc(0.8 * var(--shadow-k)));
  --card-blur: none;
  --card-hover-border: rgb(var(--c-white) / 0.1);
  --card-hover-shadow:
    0 1px 0 rgb(var(--c-white) / 0.08),
    0 8px 0 -3px rgb(var(--c-ink-800)),
    0 20px 30px -12px rgb(var(--c-shadow) / calc(0.9 * var(--shadow-k)));
  --card-hover-transform: translateY(-2px);

  --inset-radius: 10px;
  --inset-border-w: 1px;
  --inset-border: rgb(var(--c-white) / 0.05);
  --inset-bg: rgb(var(--c-ink-900));
  --inset-shadow: 0 1px 0 rgb(var(--c-white) / 0.05), 0 3px 0 -1px rgb(var(--c-ink-700));

  --pill-radius: 12px;
  --pill-border-w: 1px;
  --pill-border: rgb(var(--c-white) / 0.06);
  --pill-bg: rgb(var(--c-ink-900));
  --pill-shadow: 0 3px 0 -1px rgb(var(--c-ink-700));
  --pill-blur: none;
  --pill-active-bg: rgb(var(--c-ink-600));
  --pill-active-fg: rgb(var(--c-white));
  --pill-active-border: rgb(var(--c-white) / 0.08);
  --pill-active-shadow: 0 2px 4px rgb(var(--c-shadow) / calc(0.5 * var(--shadow-k)));

  --tab-radius: 12px;
  --tab-border-w: 1px;
  --tab-border: rgb(var(--c-white) / 0.06);
  --tab-bg: rgb(var(--c-ink-900));
  --tab-shadow: none;
  --tab-hover-border: rgb(var(--c-white) / 0.12);
  --tab-active-border: rgb(var(--c-white) / 0.14);
  --tab-active-bg: rgb(var(--c-ink-700));
  --tab-active-shadow: 0 5px 0 -2px rgb(var(--c-ink-600)), 0 10px 16px -8px rgb(var(--c-shadow) / calc(0.8 * var(--shadow-k)));

  --btn-radius: 10px;
  --btn-icon-radius: 10px;
  --btn-border-w: 1px;
  --btn-primary-fg: rgb(var(--c-ink-950));
  --btn-primary-bg: rgb(var(--c-white));
  --btn-primary-hover-bg: rgb(var(--c-zinc-100));
  --btn-primary-border: transparent;
  --btn-primary-shadow: 0 3px 0 rgb(var(--c-zinc-500)), 0 8px 14px -6px rgb(var(--c-shadow) / calc(0.7 * var(--shadow-k)));
  --btn-primary-active-transform: translateY(2px);
  --btn-primary-active-shadow: 0 1px 0 rgb(var(--c-zinc-500));
  --btn-ghost-border: rgb(var(--c-white) / 0.1);
  --btn-ghost-bg: rgb(var(--c-ink-800));
  --btn-ghost-shadow: 0 3px 0 -1px rgb(var(--c-ink-600));
  --btn-ghost-hover-border: rgb(var(--c-white) / 0.2);
  --btn-ghost-hover-bg: rgb(var(--c-ink-700));
  --btn-icon-border: rgb(var(--c-white) / 0.08);
  --btn-icon-bg: rgb(var(--c-ink-800));
  --btn-icon-shadow: 0 2px 0 -1px rgb(var(--c-ink-600));

  --tile-radius: 10px;
  --tile-border-w: 1px;
  --tile-border: rgb(var(--c-white) / 0.08);
  --tile-base: rgb(var(--c-ink-700));
  --tile-glow: 0.8;
  --tile-shadow: 0 3px 0 -1px rgb(var(--c-ink-500));

  --chip-radius: 6px;
  --chip-border-w: 1px;
  --chip-border: rgb(var(--c-white) / 0.07);
  --chip-bg: rgb(var(--c-ink-700));
  --chip-shadow: none;

  --input-radius: 10px;
  --input-border-w: 1px;
  --input-border: rgb(var(--c-white) / 0.1);
  --input-bg: rgb(var(--c-ink-900));
  --input-shadow: inset 0 2px 3px rgb(var(--c-shadow) / calc(0.35 * var(--shadow-k)));
  --input-focus-border: rgb(var(--c-mint-400) / 0.55);
  --input-focus-shadow: inset 0 2px 3px rgb(var(--c-shadow) / calc(0.35 * var(--shadow-k))), 0 0 0 2px rgb(var(--c-mint-400) / 0.15);

  --hero-radius: 20px;
  --hero-border-w: 1px;
  --hero-border: rgb(var(--c-white) / 0.08);
  --hero-bg: linear-gradient(160deg, rgb(var(--c-white) / 0.09), transparent 50%), rgb(var(--c-ink-800));
  --hero-shadow: 0 1px 0 rgb(var(--c-white) / 0.08), 0 9px 0 -4px rgb(var(--c-ink-700)), 0 18px 0 -8px rgb(var(--c-ink-800)), 0 26px 40px -16px rgb(var(--c-shadow) / calc(0.9 * var(--shadow-k)));
  --hero-grain-opacity: 0.12;
}

/* ---------------------------------------------------------------- glow */
[data-card='glow'] {
  --glow-ring: 0 0 0 1px rgb(var(--c-mint-400) / 0.25), 0 0 24px -6px rgb(var(--c-mint-400) / 0.35);
  --app-bg: rgb(var(--c-ink-950));

  --card-radius: 16px;
  --card-border-w: 1px;
  --card-border: rgb(var(--c-white) / 0.1);
  --card-bg: rgb(var(--c-surface));
  --card-shadow: 0 0 #0000; /* 효과 그림자를 앞에 덧붙일 수 있게 none 대신 투명 그림자 */
  --card-blur: none;
  --card-hover-border: rgb(var(--c-mint-400) / 0.55);
  --card-hover-shadow: var(--glow-ring);
  --card-hover-transform: none;

  --inset-radius: 12px;
  --inset-border-w: 1px;
  --inset-border: rgb(var(--c-white) / 0.07);
  --inset-bg: transparent;
  --inset-shadow: none;

  --pill-radius: 9999px;
  --pill-border-w: 1px;
  --pill-border: rgb(var(--c-white) / 0.1);
  --pill-bg: transparent;
  --pill-shadow: none;
  --pill-blur: none;
  --pill-active-bg: rgb(var(--c-mint-400) / 0.1);
  --pill-active-fg: rgb(var(--c-mint-300));
  --pill-active-border: rgb(var(--c-mint-400) / 0.55);
  --pill-active-shadow: var(--glow-ring);

  --tab-radius: 12px;
  --tab-border-w: 1px;
  --tab-border: rgb(var(--c-white) / 0.09);
  --tab-bg: transparent;
  --tab-shadow: none;
  --tab-hover-border: rgb(var(--c-mint-400) / 0.4);
  --tab-active-border: rgb(var(--c-mint-400) / 0.6);
  --tab-active-bg: rgb(var(--c-mint-400) / 0.07);
  --tab-active-shadow: var(--glow-ring);

  --btn-radius: 9999px;
  --btn-icon-radius: 9999px;
  --btn-border-w: 1px;
  --btn-primary-fg: rgb(var(--c-mint-300));
  --btn-primary-bg: rgb(var(--c-mint-400) / 0.1);
  --btn-primary-hover-bg: rgb(var(--c-mint-400) / 0.2);
  --btn-primary-border: rgb(var(--c-mint-400) / 0.6);
  --btn-primary-shadow: var(--glow-ring);
  --btn-primary-active-transform: none;
  --btn-primary-active-shadow: 0 0 0 1px rgb(var(--c-mint-400) / 0.4), 0 0 32px -4px rgb(var(--c-mint-400) / 0.55);
  --btn-ghost-border: rgb(var(--c-white) / 0.14);
  --btn-ghost-bg: transparent;
  --btn-ghost-shadow: none;
  --btn-ghost-hover-border: rgb(var(--c-mint-400) / 0.5);
  --btn-ghost-hover-bg: rgb(var(--c-mint-400) / 0.06);
  --btn-icon-border: rgb(var(--c-white) / 0.1);
  --btn-icon-bg: transparent;
  --btn-icon-shadow: none;

  --tile-radius: 12px;
  --tile-border-w: 1px;
  --tile-border: rgb(var(--c-mint-400) / 0.35);
  --tile-base: rgb(var(--c-ink-900));
  --tile-glow: 0.5;
  --tile-shadow: none;

  --chip-radius: 9999px;
  --chip-border-w: 1px;
  --chip-border: rgb(var(--c-white) / 0.12);
  --chip-bg: transparent;
  --chip-shadow: none;

  --input-radius: 12px;
  --input-border-w: 1px;
  --input-border: rgb(var(--c-white) / 0.12);
  --input-bg: transparent;
  --input-shadow: none;
  --input-focus-border: rgb(var(--c-mint-400) / 0.7);
  --input-focus-shadow: var(--glow-ring);

  --hero-radius: 24px;
  --hero-border-w: 1px;
  --hero-border: rgb(var(--c-mint-400) / 0.3);
  --hero-bg: radial-gradient(60% 100% at 0% 0%, rgb(var(--c-mint-400) / 0.16), transparent 65%), rgb(var(--c-ink-900));
  --hero-shadow: 0 0 40px -14px rgb(var(--c-mint-400) / 0.3);
  --hero-grain-opacity: 0.08;
}

/* ---------------------------------------------------------------- aurora */
[data-card='aurora'] {
  --header-bg: rgb(var(--c-ink-950) / 0.2);
  --app-bg:
    radial-gradient(900px 620px at 8% -8%, rgb(var(--c-mint-400) / 0.4), transparent 62%),
    radial-gradient(800px 600px at 96% 4%, rgb(var(--c-sky-400) / 0.32), transparent 62%),
    radial-gradient(760px 620px at 84% 98%, rgb(var(--c-rose-400) / 0.3), transparent 62%),
    radial-gradient(700px 560px at 2% 92%, rgb(var(--c-amber-400) / 0.2), transparent 62%),
    rgb(var(--c-ink-950));

  --card-radius: 22px;
  --card-border-w: 0px;
  --card-border: transparent;
  --card-bg: rgb(var(--c-ink-850) / 0.55);
  --card-shadow: 0 20px 44px -26px rgb(var(--c-shadow) / calc(0.7 * var(--shadow-k)));
  --card-blur: blur(18px) saturate(1.2);
  --card-hover-border: transparent;
  --card-hover-shadow: 0 26px 52px -26px rgb(var(--c-shadow) / calc(0.85 * var(--shadow-k)));
  --card-hover-transform: translateY(-2px);

  --inset-radius: 16px;
  --inset-border-w: 0px;
  --inset-border: transparent;
  --inset-bg: rgb(var(--c-white) / 0.045);
  --inset-shadow: none;

  --pill-radius: 9999px;
  --pill-border-w: 0px;
  --pill-border: transparent;
  --pill-bg: rgb(var(--c-ink-850) / 0.5);
  --pill-shadow: none;
  --pill-blur: blur(18px);
  --pill-active-bg: rgb(var(--c-white) / 0.12);
  --pill-active-fg: rgb(var(--c-white));
  --pill-active-border: transparent;
  --pill-active-shadow: none;

  --tab-radius: 16px;
  --tab-border-w: 0px;
  --tab-border: transparent;
  --tab-bg: rgb(var(--c-white) / 0.04);
  --tab-shadow: none;
  --tab-hover-border: transparent;
  --tab-active-border: transparent;
  --tab-active-bg: rgb(var(--c-white) / 0.12);
  --tab-active-shadow: 0 14px 28px -18px rgb(var(--c-shadow) / calc(0.7 * var(--shadow-k)));

  --btn-radius: 9999px;
  --btn-icon-radius: 9999px;
  --btn-border-w: 0px;
  --btn-primary-fg: rgb(var(--c-ink-950));
  --btn-primary-bg: linear-gradient(120deg, rgb(var(--c-mint-300)), rgb(var(--c-sky-400)));
  --btn-primary-hover-bg: linear-gradient(120deg, rgb(var(--c-mint-400)), rgb(var(--c-sky-300)));
  --btn-primary-border: transparent;
  --btn-primary-shadow: 0 10px 24px -10px rgb(var(--c-mint-400) / 0.55);
  --btn-primary-active-transform: scale(0.98);
  --btn-primary-active-shadow: 0 6px 16px -8px rgb(var(--c-mint-400) / 0.5);
  --btn-ghost-border: transparent;
  --btn-ghost-bg: rgb(var(--c-white) / 0.08);
  --btn-ghost-shadow: none;
  --btn-ghost-hover-border: transparent;
  --btn-ghost-hover-bg: rgb(var(--c-white) / 0.14);
  --btn-icon-border: transparent;
  --btn-icon-bg: rgb(var(--c-white) / 0.07);
  --btn-icon-shadow: none;

  --tile-radius: 14px;
  --tile-border-w: 0px;
  --tile-border: transparent;
  --tile-base: rgb(var(--c-white) / 0.08);
  --tile-glow: 1.2;
  --tile-shadow: none;

  --chip-radius: 9999px;
  --chip-border-w: 0px;
  --chip-border: transparent;
  --chip-bg: rgb(var(--c-white) / 0.08);
  --chip-shadow: none;

  --input-radius: 14px;
  --input-border-w: 0px;
  --input-border: transparent;
  --input-bg: rgb(var(--c-white) / 0.07);
  --input-shadow: none;
  --input-focus-border: transparent;
  --input-focus-shadow: 0 0 0 2px rgb(var(--c-mint-400) / 0.5);

  --hero-radius: 28px;
  --hero-border-w: 0px;
  --hero-border: transparent;
  --hero-bg:
    radial-gradient(70% 120% at 0% 0%, rgb(var(--c-mint-400) / 0.35), transparent 60%),
    radial-gradient(60% 110% at 100% 100%, rgb(var(--c-rose-400) / 0.28), transparent 60%),
    rgb(var(--c-ink-850) / 0.6);
  --hero-shadow: 0 26px 52px -28px rgb(var(--c-shadow) / calc(0.8 * var(--shadow-k)));
  --hero-grain-opacity: 0.1;
}

/* ---------------------------------------------------------------- brutal */
[data-card='brutal'] {
  --brutal-line: rgb(var(--c-white) / 0.92);
  --app-bg: rgb(var(--c-ink-950));

  --card-radius: 4px;
  --card-border-w: 2px;
  --card-border: var(--brutal-line);
  --card-bg: rgb(var(--c-surface));
  --card-shadow: 4px 4px 0 var(--brutal-line);
  --card-blur: none;
  --card-hover-border: var(--brutal-line);
  --card-hover-shadow: 8px 8px 0 rgb(var(--c-mint-400));
  --card-hover-transform: translate(-3px, -3px);

  --inset-radius: 2px;
  --inset-border-w: 2px;
  --inset-border: rgb(var(--c-white) / 0.55);
  --inset-bg: rgb(var(--c-ink-900));
  --inset-shadow: none;

  --pill-radius: 2px;
  --pill-border-w: 2px;
  --pill-border: var(--brutal-line);
  --pill-bg: rgb(var(--c-ink-950));
  --pill-shadow: 3px 3px 0 var(--brutal-line);
  --pill-blur: none;
  --pill-active-bg: rgb(var(--c-mint-400));
  --pill-active-fg: rgb(var(--c-ink-950));
  --pill-active-border: var(--brutal-line);
  --pill-active-shadow: none;

  --tab-radius: 2px;
  --tab-border-w: 2px;
  --tab-border: rgb(var(--c-white) / 0.5);
  --tab-bg: transparent;
  --tab-shadow: none;
  --tab-hover-border: var(--brutal-line);
  --tab-active-border: var(--brutal-line);
  --tab-active-bg: rgb(var(--c-mint-400) / 0.16);
  --tab-active-shadow: 4px 4px 0 var(--brutal-line);

  --btn-radius: 2px;
  --btn-icon-radius: 2px;
  --btn-border-w: 2px;
  --btn-primary-fg: rgb(var(--c-ink-950));
  --btn-primary-bg: rgb(var(--c-mint-400));
  --btn-primary-hover-bg: rgb(var(--c-mint-300));
  --btn-primary-border: var(--brutal-line);
  --btn-primary-shadow: 4px 4px 0 var(--brutal-line);
  --btn-primary-active-transform: translate(4px, 4px);
  --btn-primary-active-shadow: 0 0 0 var(--brutal-line);
  --btn-ghost-border: var(--brutal-line);
  --btn-ghost-bg: transparent;
  --btn-ghost-shadow: none;
  --btn-ghost-hover-border: var(--brutal-line);
  --btn-ghost-hover-bg: rgb(var(--c-white) / 0.1);
  --btn-icon-border: rgb(var(--c-white) / 0.6);
  --btn-icon-bg: transparent;
  --btn-icon-shadow: none;

  --tile-radius: 2px;
  --tile-border-w: 2px;
  --tile-border: var(--brutal-line);
  --tile-base: rgb(var(--c-ink-800));
  --tile-glow: 0;
  --tile-shadow: 3px 3px 0 var(--brutal-line);

  --chip-radius: 2px;
  --chip-border-w: 2px;
  --chip-border: rgb(var(--c-white) / 0.6);
  --chip-bg: transparent;
  --chip-shadow: none;

  --input-radius: 2px;
  --input-border-w: 2px;
  --input-border: var(--brutal-line);
  --input-bg: rgb(var(--c-ink-950));
  --input-shadow: none;
  --input-focus-border: var(--brutal-line);
  --input-focus-shadow: 4px 4px 0 rgb(var(--c-mint-400));

  --hero-radius: 4px;
  --hero-border-w: 2px;
  --hero-border: var(--brutal-line);
  --hero-bg: rgb(var(--c-ink-900));
  --hero-shadow: 8px 8px 0 rgb(var(--c-mint-400));
  --hero-grain-opacity: 0;
}
```

### 5.5 스타일별 읽는 법 (디자인 의도)

- **glass**: `--card-bg` 는 위→아래로 흰 4.5% → 1.2% 그라데이션 위에 `surface` 색. `--card-shadow` 의 `inset 0 1px 0` 가 "굴절 림"(위쪽 얇은 빛 선). `--hero-bg` 는 좌상단 radial 광원 + 115° 사선 광택 + `ink-950`. 버튼 primary 는 `white → zinc-200` 세로 그라데이션에 아래 안쪽 그림자와 흰 발광.
- **minimal**: 배경과 같은 `ink-950` 카드, 선만 보임. 활성 상태는 "배경 7% 흰색 + 30% 테두리"(pill), "70% 흰 테두리"(tab). 입력 포커스도 선만 진해짐.
- **flat**: 테두리 대신 `ink-800 → 700 → 600 → 500` 단계. 활성 pill 은 `ink-500`. primary 버튼 active = `scale(0.98)`. 포커스는 `0 0 0 2px mint/0.5` 링.
- **neumorph**: 면이 전부 `ink-950`(배경과 동일). 볼록 = `9px 9px 20px 어두움, -7px -7px 18px 밝음`, 오목 = 같은 값의 `inset`. 라이트 테마에서는 `--neu-hl` 을 흰색 95%, `--neu-sh` 를 `shadow/0.32` 로 재정의(마지막 `[data-theme-mode='light']` 블록). 활성 pill 글자는 `mint-400`, primary 버튼은 `mint-400` 면.
- **paper**: 아래로 겹친 종이 = `0 7px 0 -3px ink-800`(spread 음수로 좁은 띠). primary 버튼은 `0 3px 0 zinc-500` 두꺼운 아래 단 + 누르면 `translateY(2px)` + 단이 `1px`.
- **glow**: 평소엔 거의 투명한 얇은 선. 활성/hover 만 `--glow-ring`(`0 0 0 1px mint/0.25, 0 0 24px -6px mint/0.35`). primary 버튼은 민트 글자 + 민트 10% 면 + 민트 60% 테두리.
- **aurora**: `--app-bg` 가 4개 radial(민트/하늘/로즈/앰버, 알파 .4/.32/.3/.2) + `ink-950`. 카드는 `ink-850/0.55` + `blur(18px) saturate(1.2)`. 헤더도 `ink-950/0.2` 로 더 투명. primary 버튼은 `mint-300 → sky-400` 120° 그라데이션.
- **brutal**: `--brutal-line = white/0.92`. 모든 테두리 2px, 모서리 2~4px. 그림자는 블러 0 의 오프셋(`4px 4px 0`). hover 카드는 `translate(-3px,-3px)` + 민트 오프셋 `8px 8px 0`. primary 버튼 active = `translate(4px,4px)` + 그림자 소멸(눌린 느낌).

### 5.6 설정 화면에서 미리보기가 렌더되는 방식

각 스타일 선택 카드는 **실제 컴포넌트 클래스를 축소해서** 그립니다 (이미지가 아님). `data-card` 를 가진 래퍼 안에 `.app-bg` 와 `.surface`, `.btn-primary` 를 넣으면 가장 가까운 조상의 변수가 적용되어 해당 스타일로 보입니다.

```tsx
<div
  data-card={s.id}
  className="app-bg shrink-0 overflow-hidden rounded-lg flex items-center gap-1.5 p-2"
  style={{ width: 88, height: 56 }}
>
  <div className="surface flex-1 h-full !rounded-md" />
  <div className="flex-1 h-full flex flex-col gap-1">
    <div className="surface flex-1 !rounded-md" />
    <div className="btn-primary !p-0 !min-h-0 h-2.5 !rounded-full" />
  </div>
</div>
```
- 래퍼 88×56, 안쪽 패딩 `p-2`, 카드는 `!rounded-md`(반경 변수 무시), 버튼은 높이 `h-2.5` 의 알약.
- aurora 는 `.app-bg` 의 radial 배경 덕에 미리보기 안에서도 색 덩어리가 보인다.
- 테마 미리보기는 §9.2 (64×40 미니 화면: 상단바 + 점 3개 + 문장 막대 + 강조 막대).

### 5.7 새 카드 스타일 추가 방법

1. `card-styles.css` 에 `[data-card='새이름'] { … }` 블록을 추가하고 §5.2 의 **모든 변수**를 정의.
2. `options.ts` 의 `CARD_STYLES` 에 `{ id, name, description }` 추가 (id 는 CSS 선택자와 동일).
3. 필요하면 라이트 테마 보정 블록 `[data-theme-mode='light'] [data-card='새이름'], [data-theme-mode='light'][data-card='새이름'] { … }`.
4. 컴포넌트 코드는 수정하지 않는다.

---

## 6. 컴포넌트 카탈로그 & 레이아웃 패턴

### 6.0 `index.css` 전체 (컴포넌트 클래스의 정확한 CSS)

모든 컴포넌트 클래스는 여기에 있습니다. 아래 6.x 절은 이 클래스의 **사용법·변형·상태·do/don't** 를 설명합니다.
(`@import` 두 줄이 반드시 `@tailwind` 앞에 와야 합니다.)

```css
/* frontend/src/index.css */
@import './appearance/fonts.css';
@import './styles/card-styles.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scrollbar-color: rgb(var(--c-ink-500)) rgb(var(--c-ink-900));
}

/* Firefox */
* {
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--c-ink-500)) rgb(var(--c-ink-900));
}

/* Chromium / Safari */
*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

*::-webkit-scrollbar-track {
  background: rgb(var(--c-ink-900));
}

*::-webkit-scrollbar-thumb {
  background: rgb(var(--c-ink-600));
  border-radius: 9999px;
  border: 2px solid rgb(var(--c-ink-900));
}

*::-webkit-scrollbar-thumb:hover {
  background: rgb(var(--c-ink-500));
}

body {
  @apply font-sans text-zinc-100;
  background: var(--app-bg);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: 'tnum' 0;
}

#root {
  width: 100%;
  min-height: 100vh;
}

/* ------------------------------------------------------------------
 * 디자인 시스템 — 유리 질감 다크 카드 / pill / 칩 / 링 게이지
 * 화면 컴포넌트는 slate-* 대신 이 클래스와 ink/mint 토큰을 쓴다.
 * ------------------------------------------------------------------ */
@layer components {
  /* 최상위 카드 — 모양은 모두 --card-* 변수(styles/card-styles.css)가 정한다 */
  .surface {
    @apply relative;
    border-radius: var(--card-radius);
    border: var(--card-border-w) solid var(--card-border);
    /* --fx-glow-card: 모양 설정의 카드 그라데이션 (끄면 none) */
    background: var(--fx-glow-card, none), var(--card-bg);
    /* --fx-depth-card: 모양 설정의 카드 입체감 (끄면 투명 그림자) */
    box-shadow: var(--fx-depth-card, 0 0 #0000), var(--card-shadow);
    -webkit-backdrop-filter: var(--card-blur);
    backdrop-filter: var(--card-blur);
  }

  /* 팝업·드롭다운·토스트 같은 고정 창 안에서는 카드 그라데이션/입체감을 덧입히지 않는다 */
  .fixed,
  [role='dialog'] {
    --fx-glow-card: none;
    --fx-depth-card: 0 0 #0000;
  }

  /* 카드 안쪽 패널 */
  .surface-inset {
    border-radius: var(--inset-radius);
    border: var(--inset-border-w) solid var(--inset-border);
    background: var(--inset-bg);
    box-shadow: var(--inset-shadow);
  }

  /* 클릭 가능한 카드 */
  .surface-interactive {
    @apply transition-all duration-300 cursor-pointer;
  }
  .surface-interactive:hover {
    border-color: var(--card-hover-border);
    box-shadow: var(--fx-depth-card, 0 0 #0000), var(--card-hover-shadow);
    transform: var(--card-hover-transform);
  }

  /* pill (네비게이션, 필터 그룹) */
  .glass-pill {
    border-radius: var(--pill-radius);
    border: var(--pill-border-w) solid var(--pill-border);
    background: var(--pill-bg);
    box-shadow: var(--pill-shadow);
    -webkit-backdrop-filter: var(--pill-blur);
    backdrop-filter: var(--pill-blur);
  }

  /* pill 내부 세그먼트 버튼 */
  .pill-item {
    @apply px-3.5 py-1.5 text-sm text-zinc-400 transition-colors whitespace-nowrap;
    border-radius: var(--pill-radius);
    border: var(--pill-border-w) solid transparent;
  }
  .pill-item:hover {
    @apply text-zinc-100;
  }
  .pill-item-active {
    color: var(--pill-active-fg);
    background: var(--pill-active-bg);
    border-color: var(--pill-active-border);
    box-shadow: var(--pill-active-shadow);
  }

  /* 아이콘 타일 */
  .icon-tile {
    @apply inline-flex items-center justify-center w-10 h-10 shrink-0 text-zinc-200;
    border-radius: var(--tile-radius);
    border: var(--tile-border-w) solid var(--tile-border);
    background:
      radial-gradient(120% 80% at 50% 120%, rgb(var(--c-orange-400) / calc(0.28 * var(--tile-glow))), transparent 60%),
      var(--tile-base);
    box-shadow: var(--tile-shadow);
  }
  .icon-tile-mint {
    background:
      radial-gradient(120% 80% at 50% 120%, rgb(var(--c-mint-400) / calc(0.3 * var(--tile-glow))), transparent 60%),
      var(--tile-base);
  }
  .icon-tile-amber {
    background:
      radial-gradient(120% 80% at 50% 120%, rgb(var(--c-amber-400) / calc(0.32 * var(--tile-glow))), transparent 60%),
      var(--tile-base);
  }
  .icon-tile-sky {
    background:
      radial-gradient(120% 80% at 50% 120%, rgb(var(--c-sky-300) / calc(0.28 * var(--tile-glow))), transparent 60%),
      var(--tile-base);
  }

  /* 고정폭 칩 */
  .chip {
    @apply inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[11px] text-zinc-300 whitespace-nowrap;
    border-radius: var(--chip-radius);
    border: var(--chip-border-w) solid var(--chip-border);
    background: var(--chip-bg);
    box-shadow: var(--chip-shadow);
  }

  /* "New" 배지 */
  .badge-new {
    @apply inline-flex items-center rounded-full border border-white/80 bg-black px-1.5 py-px text-[10px] font-semibold leading-none text-white;
  }

  /* 상태 배지 */
  .badge {
    @apply inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap;
  }

  /* 고정폭 보조 라벨 */
  .label-mono {
    @apply font-mono text-[11px] tracking-wide text-zinc-500;
  }

  /* 섹션 제목 */
  .section-title {
    @apply text-[15px] font-semibold tracking-tight text-white;
  }

  /* 큰 숫자 */
  .num {
    font-variant-numeric: tabular-nums;
  }

  /* 앱 배경 (설정 미리보기 등에서도 쓰는 유틸) */
  .app-bg {
    background: var(--app-bg);
  }

  /* 상단 고정 헤더 바탕 (오로라처럼 배경을 살려야 하는 스타일은 더 투명하게) */
  .app-header {
    background: var(--header-bg, rgb(var(--c-ink-950) / 0.7));
  }

  /* 버튼: 주 행동 */
  .btn-primary {
    @apply inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-all disabled:opacity-50;
    color: var(--btn-primary-fg);
    border-radius: var(--btn-radius);
    border: var(--btn-border-w) solid var(--btn-primary-border);
    background: var(--btn-primary-bg);
    box-shadow: var(--btn-primary-shadow);
  }
  .btn-primary:hover {
    background: var(--btn-primary-hover-bg);
  }
  .btn-primary:active {
    transform: var(--btn-primary-active-transform);
    box-shadow: var(--btn-primary-active-shadow);
  }

  /* 버튼: 보조 행동 */
  .btn-ghost {
    @apply inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors disabled:opacity-50;
    border-radius: var(--btn-radius);
    border: var(--btn-border-w) solid var(--btn-ghost-border);
    background: var(--btn-ghost-bg);
    box-shadow: var(--btn-ghost-shadow);
  }
  .btn-ghost:hover {
    border-color: var(--btn-ghost-hover-border);
    background: var(--btn-ghost-hover-bg);
  }

  /* 버튼: 위험 행동 */
  .btn-danger {
    @apply inline-flex items-center justify-center gap-2 border-rose-400/25 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/20;
    border-radius: var(--btn-radius);
    border-width: var(--btn-border-w);
  }

  /* 아이콘 전용 버튼 */
  .btn-icon {
    @apply inline-flex h-8 w-8 items-center justify-center text-zinc-400 transition-colors hover:text-white;
    border-radius: var(--btn-icon-radius);
    border: var(--btn-border-w) solid var(--btn-icon-border);
    background: var(--btn-icon-bg);
    box-shadow: var(--btn-icon-shadow);
  }
  .btn-icon:hover {
    border-color: var(--btn-ghost-hover-border);
  }

  /* 입력 필드 */
  .input-field {
    @apply w-full px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:outline-none;
    border-radius: var(--input-radius);
    border: var(--input-border-w) solid var(--input-border);
    background-color: var(--input-bg);
    box-shadow: var(--input-shadow);
  }
  .input-field:focus {
    border-color: var(--input-focus-border);
    box-shadow: var(--input-focus-shadow);
  }
  select.input-field {
    @apply appearance-none pr-9;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
  }
  select.input-field option {
    background: rgb(var(--c-ink-800));
    color: rgb(var(--c-zinc-100));
  }
  .field-label {
    @apply mb-1.5 block text-xs font-medium text-zinc-400;
  }

  /* 테이블 */
  .table-head {
    @apply font-mono text-[11px] font-normal uppercase tracking-wider text-zinc-500;
  }
  .table-row {
    @apply border-b border-white/[0.05] transition-colors hover:bg-white/[0.025];
  }

  /* 구분선 */
  .divider-v {
    @apply w-px self-stretch bg-white/[0.07];
  }

  /* 그레인 질감 + 사선 광원 히어로 */
  .hero-grain {
    @apply relative overflow-hidden;
    border-radius: var(--hero-radius);
    border: var(--hero-border-w) solid var(--hero-border);
    background: var(--fx-glow-hero, none), var(--hero-bg);
    box-shadow: var(--fx-depth-hero, 0 0 #0000), var(--hero-shadow);
  }
  .hero-grain::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: var(--hero-grain-opacity);
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .hero-grain > * {
    position: relative;
  }

  /* 탭 카드 */
  .tab-card {
    @apply relative flex min-w-[118px] flex-1 flex-col items-start gap-3 overflow-hidden px-3.5 pb-3.5 pt-3 text-left transition-all duration-300;
    border-radius: var(--tab-radius);
    border: var(--tab-border-w) solid var(--tab-border);
    background: var(--tab-bg);
    box-shadow: var(--tab-shadow);
  }
  .tab-card:hover {
    border-color: var(--tab-hover-border);
  }
  .tab-card-active {
    border-color: var(--tab-active-border);
    background: var(--tab-active-bg);
    box-shadow: var(--tab-active-shadow);
  }
  /* 스크롤 스택 카드 (components/ui/CardStack.tsx) */
  .card-stack-item {
    position: sticky;
  }
  .card-stack-card {
    border-radius: var(--card-radius);
    background: rgb(var(--c-ink-950)); /* 반투명 카드 뒤로 아래 카드가 비치지 않게 */
    transform-origin: 50% 0;
    will-change: transform;
  }

  /* 선택된 탭: 테두리를 따라 빛줄기가 도는 보더 빔 */
  .tab-card-active::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    padding: 1.5px;
    border-radius: max(0px, calc(var(--tab-radius) - var(--tab-border-w)));
    background: conic-gradient(
      from var(--beam-angle),
      transparent 0deg,
      transparent 200deg,
      rgb(var(--c-mint-400) / 0.25) 260deg,
      rgb(var(--c-mint-300) / 1) 335deg,
      rgb(var(--c-white) / 1) 352deg,
      transparent 360deg
    );
    filter: drop-shadow(0 0 3px rgb(var(--c-mint-400) / 0.8));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    pointer-events: none;
    /* @property 를 지원하지 않는 웹뷰(구버전 WebKitGTK 등)에서도 값이 비지 않게 기본값을 둔다 → 회전 없이 정지된 빛으로 보인다 */
    --beam-angle: 0deg;
    animation: beamSpin 3.2s linear infinite;
  }
}

@property --beam-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

@keyframes beamSpin {
  to {
    --beam-angle: 360deg;
  }
}

@layer utilities {
  .scrollbar-hide {
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes timelineCardIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes tabProgress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

@keyframes toastIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.toast-in {
  animation: toastIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* 알림에서 이동했을 때 카드를 잠깐 강조 */
@keyframes focusFlash {
  0%,
  60% {
    box-shadow: 0 0 0 2px rgb(var(--c-mint-400) / 0.9), 0 0 24px rgb(var(--c-mint-400) / 0.35);
  }
  100% {
    box-shadow: 0 0 0 2px rgb(var(--c-mint-400) / 0), 0 0 24px rgb(var(--c-mint-400) / 0);
  }
}
.focus-flash {
  animation: focusFlash 2.4s ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
  .focus-flash {
    animation: none;
    box-shadow: 0 0 0 2px rgb(var(--c-mint-400) / 0.9);
  }
  .tab-card-active::before {
    animation: none;
    --beam-angle: 300deg;
  }
}
```

### 6.1 앱 셸 (배경 · 앰비언트 광원 · sticky 헤더 · 브랜드 행 · pill 컨트롤 · 탭 카드)

구조(위→아래):

1. 최상위 `div.relative.min-h-screen.app-bg.text-zinc-100`
2. **앰비언트 광원**: `fixed inset-x-0 top-0 h-[420px]`, `radial-gradient(60% 100% at 50% 0%, rgb(var(--c-white) / 0.06) 0%, transparent 70%)`, `pointer-events-none`, `aria-hidden`.
3. **헤더** `header.app-header.sticky.top-0.z-20.backdrop-blur-xl` — 내부 컨테이너 `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-3`
   - 브랜드 행(`flex items-center justify-between gap-3 mb-4`): 좌 `Brand`, 우 pill 컨트롤들(상태 pill, 아이콘 pill 버튼).
   - 탭 카드 행: `nav.flex.gap-2.overflow-x-auto.pb-1.-mb-1.scrollbar-hide`
   - 헤더 맨 아래 1px 그라데이션 구분선: `h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent`
4. **본문** `main.relative.max-w-7xl.mx-auto.px-4.sm:px-6.lg:px-8.py-6.sm:py-8.animate-fade-up` — `key={activeTab}` 로 탭이 바뀔 때마다 리마운트되어 `fade-up`(0.45s) 재생.
5. 모달/설정 패널은 Portal 로 body 에 (이 트리 밖).

```tsx
export default function AppShell() {
  const [activeTab, setActiveTab] = useState<TabType>('first');
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="relative min-h-screen app-bg text-zinc-100">
      {/* 상단 은은한 광원 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[420px]"
        style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgb(var(--c-white) / 0.06) 0%, transparent 70%)' }}
      />

      <header className="app-header sticky top-0 z-20 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-3">
          {/* 상단 바: 브랜드 · 상태 pill · 아이콘 pill */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <Brand />
            <div className="flex items-center gap-2">
              {/* 상태 pill: 발광 점 + mono 라벨 + 값 */}
              <div className="glass-pill flex items-center gap-2 px-3.5 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-mint-400 shadow-[0_0_8px_rgb(var(--c-mint-400)/0.8)]" />
                <span className="label-mono !text-zinc-400">LABEL</span>
                <span className="num text-sm font-medium text-white">1,325.4</span>
              </div>
              {/* 아이콘 전용 pill 버튼 */}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title="모양 설정"
                aria-label="모양 설정"
                className="glass-pill flex h-9 w-9 items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 탭 카드 */}
          <nav className="flex gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-hide">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`tab-card ${active ? 'tab-card-active' : ''}`}
                >
                  <div className="flex w-full items-start justify-between">
                    <IconTile icon={tab.icon} size="sm" tone={active ? 'mint' : 'warm'} />
                    {tab.isNew && <span className="badge-new">New</span>}
                  </div>
                  <span className={`text-sm font-medium leading-tight ${active ? 'text-white' : 'text-zinc-400'}`}>
                    {tab.label}
                  </span>
                  {/* 진행 표시줄 형태의 활성 밑줄 */}
                  <span className="absolute inset-x-3.5 bottom-2 h-[2px] rounded-full bg-white/[0.06] overflow-hidden">
                    {active && (
                      <span
                        className="block h-full w-1/2 rounded-full bg-white/80 origin-left"
                        style={{ animation: 'tabProgress 0.6s cubic-bezier(0.22, 1, 0.36, 1) both' }}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      </header>

      <main key={activeTab} className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-fade-up">
        {/* 현재 탭 내용 */}
      </main>

      <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
```

**탭 카드 상세**
- 크기: `min-w-[118px] flex-1`, 패딩 `px-3.5 pb-3.5 pt-3`, `gap-3`, 세로 배치 `flex-col items-start`, `overflow-hidden`, `transition-all duration-300`.
- 구성: 윗줄 = `IconTile size="sm"`(활성이면 `tone="mint"`, 아니면 기본) + 우측 `badge-new`; 가운데 = 라벨(활성 `text-white`, 비활성 `text-zinc-400`); 맨 아래 = **진행 표시줄 밑줄** — 회색 트랙(`bg-white/[0.06]`, 높이 2px, `inset-x-3.5 bottom-2`) 안에 활성일 때만 `w-1/2` 흰 80% 막대가 `tabProgress 0.6s cubic-bezier(0.22,1,0.36,1) both`(scaleX 0→1, `origin-left`)로 채워진다.
- 활성 카드는 `.tab-card-active` 변수 + **보더 빔**(§7.3) 오버레이. `overflow-hidden` 이므로 빔 오버레이는 카드 안쪽 `inset: 0` 에 그려진다.
- 모바일: 가로 스크롤(`overflow-x-auto scrollbar-hide`), 카드는 최소 118px.
- **상태**: hover = `--tab-hover-border`; active = 위 변수 + 빔; focus-visible 는 브라우저 기본(별도 정의 없음 — 필요 시 `focus-visible:ring-2 ring-mint-400/60` 추가 권장).

**헤더 규칙**: `app-header`(배경 `--header-bg` 기본 `ink-950/0.7`) + `backdrop-blur-xl`(Tailwind 24px) + `z-20`. 스택 카드(§6.17)가 sticky top 계산에 `.app-header` 높이를 읽으므로 **클래스명을 유지**하세요.

### 6.2 UI 프리미티브 (`src/components/ui/*`) — 전체 소스

#### Brand — 마크 + 두 굵기 워드마크 + mono 태그라인

> 아래 원문에는 예시 문구(`Product`/`Name`/`Tagline · Mono`)로 치환되어 있습니다. 마크의 막대/상승선 도형은 "성장·추이"를 상징하는 예시이므로, 다른 앱에서는 도형만 교체하고 **그라데이션 + 흰 선 + drop-shadow 패턴**을 유지하세요.

```tsx
// frontend/src/components/ui/Brand.tsx
import { useId } from 'react';

// 상단 브랜드: 막대 + 상승선 마크(예시 도형)와 두 굵기 워드마크 (테마 색을 따른다)
export default function Brand() {
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
      <div className="hidden leading-none min-[440px]:block">
        <div className="whitespace-nowrap text-[17px] tracking-tight text-white">
          <span className="font-semibold">Product</span> <span className="font-light text-zinc-400">Name</span>
        </div>
        <div className="label-mono mt-1.5 !text-[10px] uppercase tracking-[0.2em]">Tagline · Mono</div>
      </div>
    </div>
  );
}
```

#### IconTile — 어두운 그라데이션 + 아래쪽 색 글로우의 아이콘 타일

- 기본 40×40(`w-10 h-10`), `size="sm"` 은 32×32 + `!rounded-lg`. 아이콘 `strokeWidth={1.75}`, 크기 md `18px` / sm `16px`.
- `tone`: `warm`(주황 글로우, 기본) · `mint` · `amber` · `sky`. 글로우 = `radial-gradient(120% 80% at 50% 120%, <색>/calc(알파 * var(--tile-glow)), transparent 60%)` 을 `--tile-base` 위에. 알파: orange-400 0.28, mint-400 0.3, amber-400 0.32, sky-300 0.28.
- **쓰임**: 탭 카드, 섹션 제목 앞, 페이지 제목 앞(md), 설정 그룹 헤더(sm). 활성/강조 맥락은 `mint`.

```tsx
// frontend/src/components/ui/IconTile.tsx
import { LucideIcon } from 'lucide-react';

type Tone = 'warm' | 'mint' | 'amber' | 'sky';

const TONE_CLASS: Record<Tone, string> = {
  warm: '',
  mint: 'icon-tile-mint',
  amber: 'icon-tile-amber',
  sky: 'icon-tile-sky',
};

interface IconTileProps {
  icon: LucideIcon;
  tone?: Tone;
  size?: 'sm' | 'md';
  className?: string;
}

// 어두운 그라데이션 + 아래쪽 글로우를 가진 아이콘 타일
export default function IconTile({ icon: Icon, tone = 'warm', size = 'md', className = '' }: IconTileProps) {
  const sizeClass = size === 'sm' ? '!w-8 !h-8 !rounded-lg' : '';
  return (
    <span className={`icon-tile ${TONE_CLASS[tone]} ${sizeClass} ${className}`}>
      <Icon className={size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]'} strokeWidth={1.75} />
    </span>
  );
}
```

#### Chip — 고정폭 텍스트 칩

`.chip` + 선택적 민트 체크 아이콘(`w-3 h-3 text-mint-400 strokeWidth 2.5`). 속성/메타 표시용(읽기 전용). 클릭 요소가 아니다.

```tsx
// frontend/src/components/ui/Chip.tsx
import { ReactNode } from 'react';
import { Check } from 'lucide-react';

interface ChipProps {
  children: ReactNode;
  check?: boolean; // 앞에 민트 체크 아이콘
  className?: string;
}

// 고정폭 텍스트 칩 (예: "✓ label")
export default function Chip({ children, check = false, className = '' }: ChipProps) {
  return (
    <span className={`chip ${className}`}>
      {check && <Check className="w-3 h-3 text-mint-400" strokeWidth={2.5} />}
      {children}
    </span>
  );
}
```

#### Switch — 토글 (36×20 알약)

- 꺼짐: `border-white/15 bg-white/[0.06]`, 노브 `bg-zinc-400` `left-0.5`. 켜짐: `border-mint-400/60 bg-mint-400/30`, 노브 `bg-mint-300` `left-[18px]`. 노브 14px(`h-3.5 w-3.5`), `transition-all`.
- `role="switch"` + `aria-checked` + 필수 `aria-label`. 비활성 `disabled:opacity-50`.

```tsx
// frontend/src/components/ui/Switch.tsx
interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}

export default function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
        checked ? 'border-mint-400/60 bg-mint-400/30' : 'border-white/15 bg-white/[0.06]'
      }`}
    >
      <span
        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all ${
          checked ? 'left-[18px] bg-mint-300' : 'left-0.5 bg-zinc-400'
        }`}
      />
    </button>
  );
}
```

#### Slider — 두꺼운 트랙 + 세로 알약 썸 + 값 상자

- 네이티브 `<input type=range>` 를 `appearance:none` 으로 재스타일. 높이 32px, 반경 10px, 1px `white/0.1` 테두리.
- **채움 표현**: 트랙 자체가 `background-image` 두 겹(위쪽 광택 `white/0.14 → transparent`, 가로 `mint-400/0.55 → /0.3`)이고 `background-size: var(--pct) 100%` — `--pct` 는 JS 가 `((value-min)/(max-min))*100%` 로 인라인 주입.
- 썸 8×20px 알약, 흰색(`--c-white`), `margin-top:5px`(32px 트랙 중앙 정렬), 그림자 `0 1px 3px rgb(0 0 0 / .35)`.
- 포커스: `focus-visible` 에서 `0 0 0 2px mint-400/0.6`. 비활성: `opacity .5; cursor:not-allowed`.
- 오른쪽 값 상자 `.ui-slider-value`: 최소폭 3.5rem, 높이 32px, 반경 10px, `ink-900/0.5` 면, `tabular-nums`, 13px.

```tsx
// frontend/src/components/ui/Slider.tsx
import type { CSSProperties } from 'react';
import './slider.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  ariaLabel: string;
  disabled?: boolean;
}

// 네이티브 range 기반 슬라이더 + 오른쪽 값 상자
export default function Slider({ value, min, max, step = 1, onChange, format, ariaLabel, disabled }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <input
        type="range"
        className="ui-slider flex-1 min-w-0"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%` } as CSSProperties}
      />
      <span className="ui-slider-value">{format ? format(value) : String(value)}</span>
    </div>
  );
}
```

`slider.css`:

```css
/* frontend/src/components/ui/slider.css */
/* 설정 슬라이더 — 두꺼운 트랙 + 세로 알약 썸. 색은 테마 변수만 사용 */
.ui-slider {
  --pct: 0%;
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 32px;
  margin: 0;
  border-radius: 10px;
  cursor: pointer;
  outline: none;
  border: 1px solid rgb(var(--c-white) / 0.1);
  /* 왼쪽부터 썸까지 채움(강조색) + 위쪽 광택 */
  background-image:
    linear-gradient(180deg, rgb(var(--c-white) / 0.14), transparent),
    linear-gradient(90deg, rgb(var(--c-mint-400) / 0.55), rgb(var(--c-mint-400) / 0.3));
  background-size: var(--pct) 100%, var(--pct) 100%;
  background-repeat: no-repeat;
  background-color: rgb(var(--c-white) / 0.06);
}
.ui-slider:focus-visible {
  box-shadow: 0 0 0 2px rgb(var(--c-mint-400) / 0.6);
}
.ui-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ui-slider::-webkit-slider-runnable-track {
  -webkit-appearance: none;
  height: 100%;
  background: transparent;
}
.ui-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 8px;
  height: 20px;
  margin-top: 5px;
  border-radius: 999px;
  border: 1px solid rgb(var(--c-ink-900) / 0.25);
  background: rgb(var(--c-white));
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
}
.ui-slider::-moz-range-track {
  height: 100%;
  background: transparent;
}
.ui-slider::-moz-range-thumb {
  width: 8px;
  height: 20px;
  border-radius: 999px;
  border: 1px solid rgb(var(--c-ink-900) / 0.25);
  background: rgb(var(--c-white));
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
}

/* 값 표시 상자 */
.ui-slider-value {
  min-width: 3.5rem;
  padding: 0 0.625rem;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid rgb(var(--c-white) / 0.1);
  background: rgb(var(--c-ink-900) / 0.5);
  font-variant-numeric: tabular-nums;
  font-size: 0.8125rem;
  color: rgb(var(--c-white));
}
```

#### SettingsGroup / SettingRow — 설정 섹션 카드와 한 줄 행

- `SettingsGroup`: `section.surface-inset.p-4` — 헤더(`IconTile sm` + `h3.section-title` + 오른쪽 `action` 슬롯: 보통 `Switch` 또는 mono 상태 텍스트) + 본문 `space-y-3`.
- `SettingRow`: 라벨 열 `w-28 sm:w-32 shrink-0`(고정폭 → 여러 슬라이더의 시작점 정렬) + 컨트롤 열 `flex-1 justify-end`. 라벨 `text-sm text-white`, 힌트 `label-mono mt-0.5`.

```tsx
// frontend/src/components/ui/SettingsGroup.tsx
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import IconTile from './IconTile';

interface SettingsGroupProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

// 아이콘 타일 + 제목 헤더를 가진 설정 섹션 카드
export function SettingsGroup({ icon, title, children, action }: SettingsGroupProps) {
  return (
    <section className="surface-inset p-4">
      <div className="mb-3 flex items-center gap-3">
        <IconTile icon={icon} size="sm" />
        <h3 className="section-title flex-1 min-w-0 truncate">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

// 왼쪽 라벨 / 오른쪽 컨트롤 한 줄
export function SettingRow({ label, hint, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      {/* 라벨 폭을 고정해 여러 줄의 슬라이더 시작점을 맞춘다 */}
      <div className="w-28 min-w-0 shrink-0 sm:w-32">
        <div className="text-sm text-white">{label}</div>
        {hint && <div className="label-mono mt-0.5">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}
```

#### Portal — 모달 렌더 위치 고정

```tsx
// frontend/src/components/ui/Portal.tsx
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

// 모달을 body 바로 아래에 렌더링한다.
// 카드의 backdrop-filter·transform 이 position: fixed 의 기준을 바꿔 모달이 화면 중앙에서 벗어나는 것을 막는다.
export default function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
```

#### RingGauge — 링 게이지

- 기본 `size=88`, `stroke=3`, 색 `mint-400`, 트랙 `white/0.06`. SVG 를 `-rotate-90` 하여 12시 시작.
- 마운트 시 `requestAnimationFrame` 으로 0 → value 로 채움: `stroke-dashoffset` transition **1s `cubic-bezier(0.22,1,0.36,1)`**. 선 끝 `round`, 링에 `drop-shadow(0 0 6px color-mix(in srgb, <color> 35%, transparent))`.
- 중앙 값 `num font-semibold`(색 = 링 색), 아래 라벨 `label-mono text-center`.

```tsx
// frontend/src/components/ui/RingGauge.tsx
import { useEffect, useState, ReactNode } from 'react';

interface RingGaugeProps {
  value: number; // 0 ~ 100 (링 채움 비율)
  size?: number; // px
  stroke?: number; // px
  color?: string; // 링 색상
  trackColor?: string;
  children?: ReactNode; // 링 중앙 내용 (기본: 반올림한 value)
  label?: ReactNode; // 링 아래 고정폭 라벨
}

// 민트 링 게이지. 마운트 시 0 → value 로 채워진다.
export default function RingGauge({
  value,
  size = 88,
  stroke = 3,
  color = 'rgb(var(--c-mint-400))',
  trackColor = 'rgb(var(--c-white) / 0.06)',
  children,
  label,
}: RingGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(clamped));
    return () => cancelAnimationFrame(id);
  }, [clamped]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: trackColor }} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - shown / 100)}
            style={{ stroke: color, transition: 'stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)', filter: `drop-shadow(0 0 6px color-mix(in srgb, ${color} 35%, transparent))` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center num font-semibold" style={{ color }}>
          {children ?? Math.round(clamped)}
        </div>
      </div>
      {label && <div className="label-mono text-center">{label}</div>}
    </div>
  );
}
```

#### CardStack — 스크롤 스택 목록 (알고리즘은 §7.4)

```tsx
// frontend/src/components/ui/CardStack.tsx
import { Children, type ReactNode, useEffect, useRef } from 'react';

const GAP = 16; // 헤더 아래 여백
const PEEK = 10; // 뒤에 깔린 카드가 위로 드러나는 높이
const MAX_PEEK = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 스크롤하면 카드가 위에 차례로 쌓이고, 덮인 카드는 뒤로 작아지는 스택 목록.
export default function CardStack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const count = Children.count(children);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = () => Array.from(root.children) as HTMLElement[];
    let frame = 0;

    const update = () => {
      frame = 0;
      const els = items();
      const rects = els.map((el) => el.getBoundingClientRect());
      els.forEach((el, i) => {
        // 뒤 카드들이 이 카드를 덮은 정도 (카드 하나가 완전히 덮으면 1)
        let depth = 0;
        for (let j = i + 1; j < els.length; j++) {
          depth += clamp((rects[i].bottom - rects[j].top) / rects[i].height, 0, 1);
        }
        const card = el.firstElementChild as HTMLElement | null;
        if (!card) return;
        const d = Math.min(depth, 3);
        card.style.transform = d > 0 ? `scale(${1 - d * 0.04})` : '';
        card.style.filter = d > 0 ? `brightness(${1 - d * 0.15})` : '';
        card.style.opacity = depth > 2.5 ? String(clamp(3.5 - depth, 0, 1)) : '';
      });
    };

    const layout = () => {
      const header = document.querySelector<HTMLElement>('.app-header');
      const base = (header?.offsetHeight ?? 0) + GAP;
      items().forEach((el, i) => {
        const top = base + Math.min(i, MAX_PEEK) * PEEK;
        // 화면보다 긴 카드는 아랫부분까지 읽은 뒤에 멈춘다
        el.style.top = `${Math.min(top, window.innerHeight - el.offsetHeight - GAP)}px`;
      });
      update();
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const ro = new ResizeObserver(layout);
    items().forEach((el) => ro.observe(el));
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', layout);
    layout();
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', layout);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [count]);

  return (
    <div ref={ref} className="flex flex-col gap-4">
      {Children.map(children, (child) => (
        <div className="card-stack-item">
          <div className="card-stack-card">{child}</div>
        </div>
      ))}
    </div>
  );
}
```

### 6.3 서피스 (`.surface`, `.surface-inset`, `.surface-interactive`)

| 클래스 | 용도 | 읽는 변수 |
|--------|------|-----------|
| `.surface` | 최상위 카드. `position: relative` | `--card-*`, `--fx-glow-card`, `--fx-depth-card` |
| `.surface-inset` | 카드 **안쪽** 패널, 스탯 타일, 설정 그룹 | `--inset-*` |
| `.surface-interactive` | 클릭 가능한 카드에 `.surface` 와 함께: `transition-all duration-300 cursor-pointer` + hover 시 `--card-hover-*` | |

```html
<div class="surface p-5 sm:p-6">…</div>
<div class="surface surface-interactive flex h-full flex-col p-5">…</div>
<div class="surface-inset p-4">…</div>
```
- 패딩은 `p-5 sm:p-6`(큰 카드), `p-5`(항목 카드), `p-4`(설정/패널), `p-3.5`(토스트).
- 카드 안에 카드를 중첩하지 말고, 안쪽은 `surface-inset` 을 쓴다. 설정 모달 패널 자체는 `surface`.
- 상태 강조 테두리: 한쪽만 강조할 때 `border-l-2 !border-l-amber-300/60` (카드 변수 테두리보다 우선하도록 `!`).
- **do**: hover 효과는 카드 스타일 변수에 맡긴다. **don't**: `.surface` 에 `shadow-*`, `rounded-*`, `bg-*` 를 직접 덮어쓰기(스타일 전환이 깨짐). 토스트의 `shadow-2xl !rounded-2xl` 은 고정 창이라는 예외.

### 6.4 pill / 세그먼트 컨트롤 (`.glass-pill`, `.pill-item`, `.pill-item-active`)

```html
<div class="glass-pill flex p-1 gap-1" role="group" aria-label="필터">
  <button class="pill-item pill-item-active">전체</button>
  <button class="pill-item">항목 A</button>
  <button class="pill-item inline-flex items-center gap-1.5 ...">
    <svg class="h-3.5 w-3.5"/> 아이콘 포함
  </button>
</div>
```
- `.pill-item`: `px-3.5 py-1.5 text-sm text-zinc-400 transition-colors whitespace-nowrap`, 반경은 pill 변수, 테두리 폭은 pill 변수(투명). hover = `text-zinc-100`.
- `.pill-item-active`: 글자/배경/테두리/그림자 모두 `--pill-active-*`. 활성 항목에 색 톤을 더하고 싶으면 추가 클래스(예: 의미색 텍스트)를 붙인다.
- 세그먼트 안에서 선택 상태는 `aria-pressed` 로도 표시(토글 그룹). 비활성은 `disabled:opacity-50`.
- 단독 pill(아이콘 버튼/상태 표시)은 `glass-pill` 에 `px-3.5 py-2` 또는 `h-9 w-9`.
- 넘치면 `overflow-x-auto`, 모바일에서 `self-start lg:self-auto`.

### 6.5 버튼 (`.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-icon`)

| 클래스 | 용도 | 상태 |
|--------|------|------|
| `.btn-primary` | 화면당 하나의 주 행동 | hover: `--btn-primary-hover-bg`; active: `--btn-primary-active-transform/shadow`; disabled: `opacity-50` |
| `.btn-ghost` | 보조 행동 | hover: 테두리·배경 변수; disabled `opacity-50` |
| `.btn-danger` | 삭제 등 위험 행동 | `border-rose-400/25 bg-rose-500/10 text-rose-200`, hover `bg-rose-500/20` |
| `.btn-icon` | 32×32 아이콘 전용 | `text-zinc-400 → hover:text-white`, hover 시 `--btn-ghost-hover-border` |

- 공통: `inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium`. 반경은 `--btn-radius`(glass 는 알약, brutal 은 2px).
- 아이콘 크기: 버튼 안 `w-4 h-4`~`w-5 h-5`, `btn-icon` 안 `w-4 h-4`. 작은 아이콘 버튼은 `!h-6 !w-6`(토스트 닫기).
- 변형 유틸: `!rounded-full`, `!rounded-xl`, `!py-1.5 !text-xs`(작은 ghost), `!py-2.5`, `w-full justify-center`.
- 위험 hover 아이콘 버튼: `btn-icon hover:!border-rose-400/40 hover:!text-rose-300`.
- 카드 내부 버튼은 `onClick={(e) => { e.stopPropagation(); … }}` — 카드 전체가 클릭 가능할 때.
- **do**: 한 영역에 `btn-primary` 하나. **don't**: primary 에 임의 색상 클래스를 얹지 말 것(스타일별 모양이 달라짐).

### 6.6 입력 (`.input-field`, `select.input-field`, `.field-label`)

```html
<label class="field-label">라벨</label>
<input class="input-field" placeholder="…" />
<select class="input-field"><option>…</option></select>
```
- `w-full px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600`, `focus:outline-none` — 포커스 표현은 `--input-focus-border` + `--input-focus-shadow`.
- `select.input-field`: `appearance-none pr-9` + 오른쪽 12px 위치(`right 0.75rem center`)의 chevron SVG 배경(stroke `#71717a`), 옵션 배경 `ink-800` / 글자 `zinc-100`.
- 라벨은 `.field-label`. 에러 표현은 별도 클래스가 없으므로 `border-rose-400/…` + `text-rose-300 text-xs` 를 쓴다(필수 추가 시 `.input-field` 아래 `mt-1`).

### 6.7 칩 · 배지 (`.chip`, `.badge`, `.badge-new`)

- `.chip`: mono 11px, `px-2 py-1`, 아이콘 포함 가능(`gap-1.5`). 크기 줄이기: `!px-1.5 !py-0 !text-[10px]` (표 안 태그).
- `.badge`: 알약, `text-[11px] font-medium px-2 py-0.5`. **색은 호출부가 정한다** (`bg-<tone>-500/10 text-<tone>-300` 류). 상태 점은 `h-2 w-2 rounded-full` 별도.
- `.badge-new`: `rounded-full border border-white/80 bg-black px-1.5 py-px text-[10px] font-semibold text-white`. "New" 표시.
- 읽기 전용 메타 = chip, 의미 있는 상태 = badge, 신규 표식 = badge-new.

### 6.8 테이블 (`.table-head`, `.table-row`)

```html
<div class="mt-3 overflow-x-auto">
  <table class="w-full text-sm">
    <thead>
      <tr class="table-head border-b border-white/[0.08]">
        <th class="text-left py-2.5 pr-3 font-normal">열</th>
        <th class="text-right py-2.5 px-3 font-normal">숫자 열</th>
      </tr>
    </thead>
    <tbody>
      <tr class="table-row num text-zinc-200">
        <td class="py-2.5 pr-3 whitespace-nowrap">…</td>
        <td class="text-right py-2.5 px-3 whitespace-nowrap font-medium text-white">12,480</td>
      </tr>
    </tbody>
  </table>
</div>
```
- 헤더: mono 11px uppercase `tracking-wider zinc-500`. 행: `border-b border-white/[0.05]`, hover `bg-white/[0.025]`, `transition-colors`.
- 숫자 열은 `text-right` + `num`(tabular-nums). 합계/강조 열은 `font-medium text-white`.
- 칼럼 구분선(세로): `.divider-v` = `w-px self-stretch bg-white/[0.07]`.

### 6.9 모달 / 상세 팝업 패턴 (Portal + `role="dialog"`)

**필수 구조**

```tsx
export function DetailPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}   // 배경 클릭으로 닫기
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="상세"
          className="surface w-full max-w-5xl max-h-[92vh] overflow-y-auto p-4 sm:p-6"
        >
          {/* 헤더 */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <IconTile icon={SomeIcon} tone="mint" size="sm" />
              <div className="min-w-0">
                <h3 className="section-title">제목</h3>
                <p className="label-mono !normal-case !text-zinc-500 mt-0.5 break-words">부제</p>
              </div>
            </div>
            <button onClick={onClose} className="btn-icon shrink-0" aria-label="닫기" title="닫기 (Esc)">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* 필터 pill / 스탯 타일 / 차트 / 표 … */}
        </div>
      </div>
    </Portal>
  );
}
```

| 항목 | 값 |
|------|----|
| 오버레이 | `fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm` (설정 모달은 `p-3 sm:p-6`) |
| 패널 | `surface w-full max-w-{5xl|4xl} max-h-[85vh~92vh]` + 내용이 길면 패널 `overflow-y-auto`, 구조형(헤더/본문/푸터)이면 `flex flex-col` + 본문만 `overflow-y-auto` |
| 패널 패딩 | `p-4 sm:p-6` (단순 팝업) / 구획별 `px-5 py-3.5` + 구분선 `border-b|border-t border-white/[0.08]` (설정 모달) |
| 닫기 | Esc, 오버레이 `onMouseDown`(target === currentTarget), 우상단 `btn-icon` |
| 접근성 | `role="dialog" aria-modal="true" aria-label`, 열릴 때 패널 `tabIndex={-1}` 에 포커스(설정 모달) |
| z-index | 모달 `z-50`, 토스트 `z-[60]`, 커서 효과 `z-[9999]`, 헤더 `z-20` |

- **반드시 Portal**: 카드의 `backdrop-filter`/`transform`/`filter` 는 `position: fixed` 의 기준(containing block)을 바꿔서 모달이 화면 중앙을 벗어난다 (§12).
- 팝업 안의 `.surface` 는 `.fixed, [role='dialog']` 규칙으로 효과 변수가 `none` 이 되므로 그라데이션·입체감이 새지 않는다. 틸트(JS)도 이 영역을 제외한다(§7.5).
- 푸터 버튼: 왼쪽 안내 문구 `text-xs text-zinc-500`, 오른쪽 `btn-ghost !rounded-xl`(되돌리기) + `btn-primary`(완료).

### 6.10 히어로 카드 (그레인 + 사선 광원)

`.hero-grain` = 대표 카드. 반경/테두리/배경/그림자는 `--hero-*` 변수, **그레인 질감**은 `::before` 의 SVG feTurbulence 노이즈를 `mix-blend-mode: overlay`, 불투명도 `--hero-grain-opacity`(glass 0.22 / minimal·brutal 0)로 덮는다. 자식은 `position: relative` 로 그레인 위에 올라온다. 카드 그라데이션/입체감 효과 변수는 `--fx-glow-hero`, `--fx-depth-hero`.

```html
<div class="hero-grain flex h-24 items-end p-4">
  <div>
    <div class="label-mono">총계 라벨</div>
    <div class="mt-1 text-2xl font-light tracking-tight text-white">12,480</div>
  </div>
</div>
```
- 큰 값은 `CountUp`(§7.7) 으로 0 에서 올라오게 한다.
- 그레인 SVG 는 160×160, `baseFrequency 0.9`, `numOctaves 3`, `stitchTiles=stitch` 의 data-URI (index.css 원문 참조).
- 한 화면에 히어로는 하나만 둔다.

### 6.11 스탯 타일 / 메트릭 그룹

카드 안에 `grid grid-cols-1 sm:grid-cols-3 gap-3` 로 `surface-inset` 타일을 둔다.

```html
<div class="surface p-5 sm:p-6">
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-1">
    <div class="surface-inset p-4">
      <p class="label-mono mb-2">메트릭 라벨 (기간)</p>
      <p class="num text-2xl font-light tracking-tight text-white">12,480</p>
    </div>
    <div class="surface-inset p-4">
      <p class="label-mono mb-2">변화량</p>
      <p class="num text-lg font-light tracking-tight"><span class="text-mint-300">+1,240</span>
        <span class="ml-1 text-xs">(+9.9%)</span></p>
    </div>
    …
  </div>
  <div class="flex flex-wrap items-center gap-2 mt-3 mb-5">
    <span class="chip">✓ 메모 칩</span>
  </div>
</div>
```
- **증감 색**: 양수 `text-mint-300`, 음수 `text-rose-300`, 0 `text-zinc-300`, 값 없음 `-` `text-zinc-500`. 부호를 `+`/`-` 로 명시. 퍼센트는 `text-xs ml-1` 괄호.
- 차트 팝업의 타일은 `surface-inset p-3 sm:p-4 min-w-0`(긴 숫자 줄바꿈 허용).
- 링 게이지가 필요하면 `RingGauge` 를 타일 안에.

### 6.12 로고가 있는 리스트(항목) 카드

로고 타일은 **`bg-paper`(항상 흰색)** 위에 올려 어떤 테마에서도 로고가 읽히게 한다. 로고가 없으면 `surface-inset` + 아이콘.

```tsx
<div
  onClick={openDetail}
  className="surface surface-interactive flex h-full flex-col p-5"   // 강조 상태: + "border-l-2 !border-l-amber-300/60"
>
  {/* 윗줄: 로고 타일 · 우측 상단 액션 */}
  <div className="flex items-start justify-between gap-3">
    <div className={`flex h-11 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 ${
      logo ? 'bg-paper' : 'surface-inset text-zinc-400'
    }`}>
      {logo ? <img src={logo} alt="" className="h-full w-full object-contain px-2 py-1.5" /> : <SomeIcon className="h-5 w-5" />}
    </div>
    <div className="flex shrink-0 items-center gap-1.5">
      <button onClick={(e) => { e.stopPropagation(); edit(); }} className="btn-icon" title="수정"><Pencil className="w-4 h-4" /></button>
      <button onClick={(e) => { e.stopPropagation(); remove(); }} className="btn-icon hover:!border-rose-400/40 hover:!text-rose-300" title="삭제"><Trash2 className="w-4 h-4" /></button>
    </div>
  </div>

  {/* 제목 · 부제 · 칩 */}
  <div className="mb-4 mt-4 min-w-0">
    <h3 className="truncate text-lg font-medium tracking-tight text-white" title="제목">제목</h3>
    <p className="label-mono mt-1 truncate">부제</p>
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="chip">속성</span>
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-<tone>-500/10 text-<tone>-300">
        <Lock className="h-3 w-3" />상태
      </span>
      <span className="chip">속성</span>
    </div>
    <p className="mt-3 line-clamp-2 text-sm text-zinc-400">설명(2줄 제한)</p>
  </div>

  {/* 바닥 고정 푸터: 카드 높이가 달라도 바닥에 맞춘다 */}
  <div className="label-mono mt-auto border-t border-white/[0.06] pt-3">메타 정보</div>
</div>
```
- 그리드: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4` 권장(카드 `h-full` + 푸터 `mt-auto` 로 높이 정렬).
- 로고 타일 `h-11 w-36`(44×144), 반경 `rounded-xl`, 테두리 `border-white/10`.
- 액션 버튼은 우상단, **카드 전체가 클릭 가능**이므로 `stopPropagation`.

### 6.13 섹션 헤더 (IconTile + 제목 + 개수 chip) · 페이지 헤더

```tsx
{/* 페이지 헤더: 아이콘 타일(md, mint) + 제목 + 개수 mono 라벨 / 우측 primary 버튼 */}
<div className="flex items-center justify-between gap-3 mb-6">
  <div className="flex items-center gap-3 min-w-0">
    <IconTile icon={SomeIcon} tone="mint" />
    <div className="min-w-0">
      <h2 className="text-2xl font-light tracking-tight text-white">페이지 제목</h2>
      <p className="label-mono">{count} items</p>
    </div>
  </div>
  <button className="btn-primary shrink-0"><Plus className="w-5 h-5" />추가</button>
</div>

{/* 카드 내부 섹션 헤더: IconTile(sm, mint) + section-title (+ 개수 chip) */}
<div className="flex items-center gap-3 mb-5">
  <IconTile icon={SomeIcon} tone="mint" size="sm" />
  <h3 className="section-title">섹션 제목</h3>
  <span className="chip">{count}</span>
</div>
```
- 개수 표기는 `label-mono` 한 줄("N items") 또는 우측 `chip`. 설정 그룹 헤더는 우측에 `Switch` 나 mono 상태 텍스트를 둔다.

### 6.14 토스트

- 컨테이너: `pointer-events-none fixed inset-x-3 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end` — 모바일은 하단 중앙, 데스크톱은 우하단. **최대 3개** 동시 표시.
- 개별: `toast-in surface pointer-events-auto flex w-full max-w-sm items-start gap-3 !rounded-2xl p-3.5 shadow-2xl sm:w-80`, `role="status"`.
- 애니메이션: `.toast-in` = `toastIn 0.28s cubic-bezier(0.22,1,0.36,1) both` (아래에서 12px 올라오며 페이드인).
- **자동 닫힘 6000ms**, 마우스를 올리면 일시정지(남은 시간 보존, 최소 800ms 보장), 벗어나면 재개. 닫기 `btn-icon !h-6 !w-6`.
- 내용: 앞쪽 상태 점(`mt-1.5 h-2 w-2 rounded-full` 의미색) 또는 아이콘 + 제목(`text-sm font-medium text-white truncate`) + `badge` + 설명(`mt-0.5 line-clamp-2 text-xs leading-relaxed text-zinc-400`).

```tsx
const MAX_VISIBLE = 3;
const DURATION_MS = 6000;

function Toast({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(DURATION_MS);

  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const t = window.setTimeout(() => dismiss(item.id), remainingRef.current);
    return () => {
      window.clearTimeout(t);
      remainingRef.current = Math.max(800, remainingRef.current - (Date.now() - start));
    };
  }, [paused, item.id]);

  return (
    <div
      role="status"
      className="toast-in surface pointer-events-auto flex w-full max-w-sm items-start gap-3 !rounded-2xl p-3.5 shadow-2xl sm:w-80"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => open(item)}>
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-mint-400" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">{item.title}</span>
            <span className="badge shrink-0 bg-mint-500/10 text-mint-300">라벨</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-zinc-400">{item.message}</span>
        </span>
      </button>
      <button type="button" className="btn-icon !h-6 !w-6 shrink-0" aria-label="닫기" onClick={() => dismiss(item.id)}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```
- 토스트는 `fixed` 이므로 `.fixed` 규칙으로 카드 효과가 중립화된다.

### 6.15 스켈레톤(로딩) · 빈 상태

**스켈레톤**: 실제 레이아웃과 같은 뼈대를 `animate-pulse`(Tailwind 기본 2s pulse)로.
```html
<div class="surface p-5 sm:p-6 animate-pulse">
  <div class="h-4 w-32 rounded bg-white/10 mb-4"></div>
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
    <div class="h-16 rounded-2xl bg-white/[0.05]"></div> ×3
  </div>
  <div class="h-64 rounded-2xl bg-white/[0.04]"></div>
</div>
```
**빈 상태**: 카드 하나에 중앙 정렬 문구 두 줄 — 설명 `text-sm text-zinc-400`, 다음 행동 안내 `label-mono mt-1`.
```html
<div class="surface py-16 text-center">
  <p class="text-sm text-zinc-400">표시할 항목이 없습니다.</p>
  <p class="label-mono mt-1">다음 행동에 대한 안내</p>
</div>
<!-- 카드 안의 작은 빈 영역 -->
<div class="h-32 flex items-center justify-center text-sm text-zinc-500 text-center">데이터가 없습니다.</div>
<!-- 필터 결과 없음 -->
<div class="surface py-16 text-center text-sm text-zinc-400">해당하는 항목이 없습니다.</div>
```

### 6.16 세그먼트 선택 그룹 · 선택 타일(갤러리) 공통 스타일

설정 화면과 갤러리의 "선택 가능한 카드"는 `.surface` 가 아니라 **링(ring) 유틸리티**로 선택 상태를 표시한다.

```ts
const selectedCls = 'ring-2 ring-mint-400 bg-mint-400/10';
const idleCls = 'ring-1 ring-white/10 hover:bg-white/[0.04]';
```
- 버튼에 `aria-pressed={selected}` 필수. 반경은 `rounded-xl`, 패딩 `p-2`~`p-2.5`, `text-left transition-colors`.
- 사이드 내비(데스크톱) 선택: `ring-1 ring-mint-400/60 bg-white/[0.06] text-white` / 비선택 `text-zinc-400 ring-1 ring-white/10 hover:bg-white/[0.04]`.
- 선택 그리드: 1열(모바일) → `sm:grid-cols-2`, 갤러리는 `grid-cols-2 sm:grid-cols-3`.

### 6.17 스택 보기 vs 그리드 보기 토글

같은 카드 목록을 **세로 스택(스크롤 시 쌓임)** 과 **2열 그리드** 로 전환한다. 선택은 `localStorage` 에 저장(기본 `stack`, 읽기 실패 시 `stack`).

```tsx
type View = 'stack' | 'grid';
const VIEW_KEY = 'app-card-view';
const VIEWS = [
  { value: 'stack', label: '스택', icon: Layers },
  { value: 'grid', label: '그리드', icon: LayoutGrid },
] as const;

// 토글 UI
<div className="glass-pill flex self-start p-1 lg:self-auto" role="group" aria-label="카드 보기 방식">
  {VIEWS.map((v) => (
    <button
      key={v.value}
      type="button"
      onClick={() => changeView(v.value)}
      className={`pill-item inline-flex items-center gap-1.5 ${view === v.value ? 'pill-item-active' : ''}`}
      aria-pressed={view === v.value}
      title={`${v.label} 보기`}
    >
      <v.icon className="h-3.5 w-3.5" />
      {v.label}
    </button>
  ))}
</div>

// 렌더
view === 'stack'
  ? <CardStack>{cards}</CardStack>
  : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{cards}</div>
```
- 스택 알고리즘과 그 수치는 §7.4. 스택 안 카드는 `.card-stack-card` 가 불투명 `ink-950` 바탕을 깔아 뒤 카드가 비치지 않게 한다.

### 6.18 알림 하이라이트 (`focus-flash`)

다른 곳에서 특정 카드로 이동했을 때 잠깐 강조: 카드에 `focus-flash` 클래스를 2.4초 붙였다가 제거. (§7.8)

---

## 7. 애니메이션 & 모션

### 7.1 키프레임 총람

| 이름 | 정의 위치 | from → to | 지속/easing/fill | 사용처 |
|------|-----------|-----------|-------------------|--------|
| `fade-up` | `tailwind.config.js` (`animate-fade-up`) | `opacity 0, translateY(8px)` → `1, 0` | **0.45s** `cubic-bezier(0.22, 1, 0.36, 1)` `both` | 탭 전환 시 `main` 본문 (키로 리마운트) |
| `fadeSlideIn` | `index.css` | `opacity 0, translateY(-8px)` → `1, 0` | 사용처가 `animate-[fadeSlideIn_0.3s_ease-out]` 로 지정 (**0.3s ease-out**) | 목록에 새로 나타나는 인라인 카드 |
| `timelineCardIn` | `index.css` | `opacity 0, translateY(16px) scale(0.92)` → `1, 0, 1` | 사용처가 `0.4s ease-out`, 항목마다 **지연 `idx * 0.06s`**, `both` | 타임라인형 카드 순차 등장 |
| `tabProgress` | `index.css` | `scaleX(0)` → `scaleX(1)` | 사용처: **0.6s** `cubic-bezier(0.22,1,0.36,1)` `both`, `origin-left` | 활성 탭 카드 밑줄 진행 바 |
| `toastIn` | `index.css` (`.toast-in`) | `opacity 0, translateY(12px)` → `1, 0` | **0.28s** `cubic-bezier(0.22,1,0.36,1)` `both` | 토스트 등장 |
| `focusFlash` | `index.css` (`.focus-flash`) | 0~60%: `0 0 0 2px mint-400/0.9, 0 0 24px mint-400/0.35` → 100%: 알파 0 | **2.4s** `ease-out` `both` | 이동 대상 카드 강조 |
| `beamSpin` | `index.css` | `--beam-angle` → `360deg` | **3.2s** `linear` `infinite` | 활성 탭 보더 빔 |
| `cpg-pulse` | 갤러리 인라인 `<style>` | `50% { scale(1.18) }` | **0.9s** `ease-in-out` `infinite` (타일 hover 시만) | 갤러리 미리보기 |
| `cpg-slide` | 갤러리 인라인 `<style>` | `to { translateX(3px) }` | **0.9s** `ease-in-out` `infinite alternate` (타일 hover 시만) | 갤러리 미리보기 |
| (RingGauge) | JS | `stroke-dashoffset` transition | **1s** `cubic-bezier(0.22,1,0.36,1)` | 링 게이지 채움 |
| (CountUp) | JS | `easeOutCubic` | **900ms** 기본 | 숫자 증감 |
| `animate-pulse` | Tailwind 기본 | — | 2s `cubic-bezier(0.4,0,0.6,1)` infinite | 스켈레톤 |

**공용 easing**: `cubic-bezier(0.22, 1, 0.36, 1)` (easeOutQuint 계열). 등장/채움/복귀 전부 이 곡선을 쓴다.

**전환(transition) 관례**: 카드 hover `transition-all duration-300`, 탭 카드 `transition-all duration-300`, 버튼 `transition-all`/`transition-colors`, 색 전환 `transition-colors`, 스위치 `transition-all/colors`. 틸트 복귀는 JS 로 `0.35s cubic-bezier(0.22,1,0.36,1)`.

### 7.2 hover transform (카드 스타일별)

`.surface-interactive:hover` 는 `border-color: --card-hover-border`, `box-shadow: var(--fx-depth-card, 0 0 #0000), var(--card-hover-shadow)`, `transform: --card-hover-transform` 을 적용한다.

| 스타일 | `--card-hover-transform` | hover 그림자 |
|--------|--------------------------|---------------|
| glass | `translateY(-1px)` | 더 깊은 하이라이트 + 그림자 |
| minimal | `none` | 없음 (테두리 35%) |
| flat | `none` | `0 0 0 2px white/0.08` 링 |
| neumorph | `none` | `12px 12px 26px / -9px -9px 22px` 로 확대 |
| paper | `translateY(-2px)` | 겹침 띠 8px + 더 깊은 그림자 |
| glow | `none` | `--glow-ring` + 테두리 `mint-400/0.55` |
| aurora | `translateY(-2px)` | 더 깊은 그림자 |
| brutal | `translate(-3px, -3px)` | `8px 8px 0 mint-400` |

버튼 눌림(`.btn-primary:active`): flat `scale(0.98)`, aurora `scale(0.98)`, paper `translateY(2px)`, brutal `translate(4px,4px)`, 나머지 `none`.

### 7.3 탭 보더 빔 (CSS `@property` 기법)

**목표**: 활성 탭 카드의 **테두리를 따라 빛줄기가 한 바퀴 도는** 효과. 테두리만 칠하고 내부는 비워야 한다.

원리 3가지:
1. **`@property --beam-angle`** 로 각도를 "애니메이션 가능한 타입(`<angle>`)"으로 등록 → `conic-gradient(from var(--beam-angle), …)` 의 시작 각도를 `@keyframes` 로 0deg→360deg 보간할 수 있다 (등록하지 않으면 커스텀 속성은 보간되지 않고 뚝 끊긴다).
2. **`conic-gradient`** 로 한 구간만 밝은 "혜성 꼬리": `transparent 0~200deg` → `mint-400/0.25 @260` → `mint-300 @335` → `white @352` → `transparent @360`. (머리는 흰색, 꼬리는 민트로 옅어짐.)
3. **마스크 합성으로 테두리만 남기기**: 의사요소에 `padding: 1.5px`(= 선 두께)를 주고 `mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)` + `mask-composite: exclude`(WebKit 은 `-webkit-mask-composite: xor`). content-box 영역과 전체 영역을 XOR → **패딩 영역(테두리 두께)만** 보인다.

```css
@property --beam-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
@keyframes beamSpin { to { --beam-angle: 360deg; } }

.tab-card-active::before {
  content: ''; position: absolute; inset: 0; z-index: 0;
  padding: 1.5px;
  border-radius: max(0px, calc(var(--tab-radius) - var(--tab-border-w)));
  background: conic-gradient(from var(--beam-angle),
    transparent 0deg, transparent 200deg,
    rgb(var(--c-mint-400) / 0.25) 260deg,
    rgb(var(--c-mint-300) / 1) 335deg,
    rgb(var(--c-white) / 1) 352deg,
    transparent 360deg);
  filter: drop-shadow(0 0 3px rgb(var(--c-mint-400) / 0.8));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
  /* @property 를 지원하지 않는 웹뷰(구버전 WebKitGTK 등)에서도 값이 비지 않게 기본값을 둔다 → 회전 없이 정지된 빛으로 보인다 */
  --beam-angle: 0deg;
  animation: beamSpin 3.2s linear infinite;
}
```
- 반경 = `--tab-radius - --tab-border-w` (카드 테두리 안쪽에 정확히 맞물리도록, 음수 방지 `max(0px, …)`). 그래서 brutal(2px 반경, 2px 테두리)에서는 0.
- 카드가 `overflow-hidden` + `relative` 여야 하고, 자식 콘텐츠가 빔 위에 오도록 필요 시 `z-index`/`relative`.
- 모든 카드 스타일에서 같은 빔이 그려진다 (스타일별 `--tab-*` 변수만 달라짐).
- **감소된 모션**: 아래 §7.9 — 빔을 정지(`animation:none`)하고 각도를 `300deg` 로 고정해 "꼬리가 보이는 정지 상태"로 둔다.

### 7.4 스택 스크롤 알고리즘 (`CardStack`)

DOM: `div.flex.flex-col.gap-4` > 각 자식 `div.card-stack-item`(`position: sticky`) > `div.card-stack-card`(불투명 `ink-950` 바탕, `transform-origin: 50% 0`, `will-change: transform`, 반경 = `--card-radius`) > 실제 카드.

상수: `GAP = 16`(헤더 아래 여백), `PEEK = 10`(뒤에 깔린 카드가 위로 드러나는 높이), `MAX_PEEK = 4`.

**1) sticky top 계산 (`layout`, resize/ResizeObserver 시)**
```
base      = (.app-header 의 offsetHeight ?? 0) + GAP
top[i]    = base + min(i, MAX_PEEK) * PEEK
style.top = min(top[i], window.innerHeight - el.offsetHeight - GAP)   // 화면보다 긴 카드는 아랫부분까지 읽은 뒤에 멈춘다
```
→ 앞 카드들이 헤더 밑에 10px 간격으로 최대 4장까지 층층이 보인다.

**2) 깊이(depth) 계산 (`update`, scroll 때 rAF 로 한 프레임에 한 번)**
```
depth_i = Σ_{j>i} clamp((rect_i.bottom - rect_j.top) / rect_i.height, 0, 1)   // 뒤 카드들이 이 카드를 덮은 정도 (카드 1장이 완전히 덮으면 1)
d = min(depth, 3)
card.transform = d > 0 ? scale(1 - d * 0.04) : ''          // 최대 0.88
card.filter    = d > 0 ? brightness(1 - d * 0.15) : ''     // 최대 0.55
card.opacity   = depth > 2.5 ? clamp(3.5 - depth, 0, 1) : ''   // 2.5~3.5 구간에서 서서히 사라짐
```
- 이벤트: `scroll`(passive) → `requestAnimationFrame(update)`(중복 예약 방지 `if (!frame)`), `resize` → `layout`, 각 아이템 `ResizeObserver` → `layout`. 언마운트 시 모두 해제.
- 의존성 `[count]` (자식 개수가 바뀌면 재설정).
- 스택 카드의 `filter`/`transform` 은 containing block 을 만들므로 **카드 안에서 모달을 렌더하지 말 것**(Portal).

### 7.5 카드 틸트 알고리즘 (`CardTilt`, §8 에 전체 코드)

- 활성 조건: `cardDepth.enabled && (tilt > 0 || lift > 0)` 이고 reduced-motion 이 아닐 때.
- 대상 선택자: scope `all` → `.surface, .hero-grain`, scope `hero` → `.hero-grain`. `pointermove`(passive, 터치 제외)에서 `e.target.closest(selector)` 로 카드를 찾고 **rAF 로 한 프레임에 한 번** 적용.
- **제외**: 대상이 `[role=dialog], .fixed` 안에 있거나 `getComputedStyle(target).position === 'fixed'` 이면 움직이지 않는다(모달·토스트·드롭다운).
- 수식 (포인터 상대 위치 px, py ∈ [-0.5, 0.5]):
  ```
  px = (clientX - left) / width  - 0.5
  py = (clientY - top)  / height - 0.5
  k  = min(1, BASE_WIDTH / width)          // BASE_WIDTH = 480 → 넓은 카드는 기울기 축소
  transform  = perspective(1000px) rotateX(-py*2*tilt*k deg) rotateY(px*2*tilt*k deg) translateY(-lift px)
  transition = transform 0.12s ease-out   // 움직이는 동안
  ```
- 해제(카드를 벗어남/창 이탈/blur): `transition: transform 0.35s cubic-bezier(0.22,1,0.36,1)`, `transform: ''`.
- 설정 화면 미리보기는 모달 안이라 전역 틸트가 막히므로 **미리보기 카드가 직접** `perspective(800px)` 로 기울인다(§9.4).

### 7.6 카드 입체감의 hover 합성

`.surface-interactive:hover` 의 `box-shadow` 도 `var(--fx-depth-card, 0 0 #0000), var(--card-hover-shadow)` 로 **입체감 그림자를 앞에 덧붙여** 유지된다(§8.4).

### 7.7 CountUp — 숫자 카운트 업

- 이전 값(최초 0)에서 새 값으로 `requestAnimationFrame` 보간, **`duration` 기본 900ms**, `easeOutCubic(t) = 1 - (1 - t)^3`.
- 값이 바뀌면 **현재 표시값에서** 새 값으로 이어서(되감기 없음). `displayRef` 로 최신 표시값 보관.
- `prefers-reduced-motion: reduce` 이면 초기값부터 최종값, 값 변경도 즉시 반영.
- 렌더: `<span className="tabular-nums …">{format(display)}</span>` — 자릿수 폭 고정으로 흔들림 방지. 포맷 함수는 호출부가 제공(`format: (v:number)=>string`).

```tsx
// frontend/src/components/CountUp.tsx
import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  format: (v: number) => string;
  duration?: number; // ms
  className?: string;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 숫자를 이전 값(최초엔 0)에서 새 값까지 부드럽게 증가/감소시키며 표시한다.
export default function CountUp({ value, format, duration = 900, className }: CountUpProps) {
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? value : 0));
  const displayRef = useRef(display);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (prefersReducedMotion()) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }
    const from = displayRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const next = from + (value - from) * easeOutCubic(t);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  // tabular-nums: 자릿수 폭 고정으로 애니메이션 중 글자 흔들림 방지
  return <span className={`tabular-nums ${className ?? ''}`}>{format(display)}</span>;
}
```

### 7.8 focus flash

`.focus-flash` = `focusFlash 2.4s ease-out both`. 0~60% 구간은 강조 링(`0 0 0 2px mint/0.9` + `0 0 24px mint/0.35`)을 유지하다 100% 에서 투명. reduced-motion 이면 애니메이션 없이 `0 0 0 2px mint/0.9` 정적 링.

### 7.9 `prefers-reduced-motion` 규칙 (전문)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
  .focus-flash { animation: none; box-shadow: 0 0 0 2px rgb(var(--c-mint-400) / 0.9); }
  .tab-card-active::before { animation: none; --beam-angle: 300deg; }
}
```
- **왜 무한 애니메이션은 `none` 으로 따로 끄는가**: `animation-duration: 0.01ms !important` 만 적용하면 `infinite` 애니메이션은 **0.01ms 주기로 무한 반복**되어 오히려 매 프레임 재시작/깜빡임과 CPU 사용을 유발한다. 유한 애니메이션은 즉시 끝나므로 0.01ms 로 충분하지만 `infinite`(보더 빔 `beamSpin`)는 `animation: none` 으로 끄고, `@property` 값을 정적 각도(300deg)로 고정해 보이는 상태를 정의해야 한다.
- 갤러리 미리보기 애니메이션은 `@media (prefers-reduced-motion: no-preference)` 안에서만 정의(옵트인).
- JS 효과: `CursorTrail` 은 reduced 이면 `active=false`(그리지 않음), `CursorPointer` 는 `ease=1` + 늘어남/깜빡임/속도 0, `CardTilt` 는 즉시 return, `CountUp` 은 즉시 값.
- 새 애니메이션을 추가할 때: (1) 유한이면 별도 처리 불필요, (2) `infinite` 이면 이 블록에서 `none` + 정적 대체 상태 정의.

---

## 8. 효과 설정 (Effects)

### 8.1 설정 모델 (TypeScript)

네 종류의 효과가 `AppearanceSettings` 안에 들어 있고 **모두 기본 꺼짐/네이티브**입니다.

```ts
export interface CursorTrailSettings {
  enabled: boolean;
  nodes: number;      // 점 개수
  ease: number;       // 앞 점을 따라가는 빠르기 (클수록 빠름)
  headSize: number;   // 머리 점 지름(px)
  taper: number;      // 꼬리로 갈수록 작아지는 정도 (0~1)
  gradient: boolean;  // 체인을 따라 mint → sky 그라디언트
  style: TrailPresetId; // 트레일 프리셋 (수치 설정은 모든 프리셋이 공유)
}
export const DEFAULT_CURSOR_TRAIL: CursorTrailSettings = {
  enabled: false, nodes: 14, ease: 0.34, headSize: 24, taper: 0.8, gradient: false, style: 'dots',
};

export interface CursorPointerSettings { style: PointerPresetId; }   // 'native' = 운영체제 커서
export const DEFAULT_CURSOR_POINTER: CursorPointerSettings = { style: 'native' };

export interface CardGlowSettings {
  enabled: boolean;
  scope: 'hero' | 'all'; // 대표 카드만 / 모든 카드
  intensity: number;     // 0~0.5  광원 불투명도
  size: number;          // 광원 반경(%)
  x: number;             // 광원 중심 가로(%)
  y: number;             // 광원 중심 세로(%)
  gradient: boolean;     // 강조색 → 하늘색 두 광원
}
export const DEFAULT_CARD_GLOW: CardGlowSettings = {
  enabled: false, scope: 'hero', intensity: 0.18, size: 65, x: 0, y: 0, gradient: false,
};

export interface CardDepthSettings {
  enabled: boolean;
  scope: 'hero' | 'all';
  depth: number; // 바깥 그림자 0~1
  bevel: number; // 위 모서리 빛 / 아래 모서리 그늘 0~1
  tilt: number;  // 마우스 올렸을 때 최대 기울기(도), 0 = 끔
  lift: number;  // 마우스 올렸을 때 떠오르는 높이(px)
}
export const DEFAULT_CARD_DEPTH: CardDepthSettings = {
  enabled: false, scope: 'all', depth: 0.5, bevel: 0.5, tilt: 5, lift: 3,
};
```

### 8.2 한계(limits) 표 — 슬라이더도 이 값으로 만든다

| 설정 | 키 | min | max | step | 표시 형식 |
|------|----|-----|-----|------|------------|
| 커서 트레일 (`CURSOR_TRAIL_LIMITS`) | nodes | 3 | 30 | 1 | 정수 |
| | ease | 0.05 | 0.9 | 0.01 | `toFixed(2)` |
| | headSize | 6 | 48 | 1 | `Npx` |
| | taper | 0 | 1 | 0.05 | `toFixed(2)` |
| 카드 그라데이션 (`CARD_GLOW_LIMITS`) | intensity | 0 | 0.5 | 0.01 | `N%` (×100 반올림) |
| | size | 20 | 120 | 5 | `N%` |
| | x | 0 | 100 | 5 | `N%` |
| | y | 0 | 100 | 5 | `N%` |
| 카드 입체감 (`CARD_DEPTH_LIMITS`) | depth | 0 | 1 | 0.05 | `N%` |
| | bevel | 0 | 1 | 0.05 | `N%` |
| | tilt | 0 | 12 | 1 | `N°` (0이면 `끔`) |
| | lift | 0 | 10 | 1 | `Npx` (0이면 `끔`) |

저장값 sanitize: 숫자가 아니거나 NaN/Infinity 면 **기본값**, 범위 밖이면 **clamp**, `nodes` 는 반올림, `style`/`scope` 는 허용 목록 검사(§9.5).

### 8.3 카드 글로우(광원) 공식

설정 → `--fx-glow-hero`, `--fx-glow-card` (CSS `background` 의 **첫 번째 레이어**, 기본 `none`).

```ts
function cardGlowLayer(g: CardGlowSettings) {
  const a = g.intensity.toFixed(3);
  const main = `radial-gradient(circle at ${g.x}% ${g.y}%, rgb(var(--c-mint-400) / ${a}) 0%, transparent ${g.size}%)`;
  if (!g.gradient) return main;
  // 두 번째 광원은 반대쪽 모서리에서 하늘색으로
  const sub = `radial-gradient(circle at ${100 - g.x}% ${100 - g.y}%, rgb(var(--c-sky-400) / ${(g.intensity * 0.8).toFixed(3)}) 0%, transparent ${g.size}%)`;
  return `${main}, ${sub}`;
}
// 적용
const glow = s.cardGlow?.enabled ? cardGlowLayer(s.cardGlow) : 'none';
vars['--fx-glow-hero'] = glow;
vars['--fx-glow-card'] = s.cardGlow?.enabled && s.cardGlow.scope === 'all' ? glow : 'none';
```
- 소비: `.surface { background: var(--fx-glow-card, none), var(--card-bg); }`, `.hero-grain { background: var(--fx-glow-hero, none), var(--hero-bg); }` — 광원이 카드 본래 배경 **위에** 겹친다.
- scope `hero` 이면 카드 광원은 `none`, 히어로만 빛난다. 두 번째 광원 알파는 `intensity × 0.8`, 위치는 `(100-x, 100-y)`.

### 8.4 카드 입체감(depth) 그림자 공식

```ts
function cardDepthShadow(c: CardDepthSettings) {
  const { depth: d, bevel: b } = c;
  const f = (v: number) => v.toFixed(2);
  const parts: string[] = [];
  if (d > 0) {
    parts.push(`0 ${f(1 + 2 * d)}px ${f(2 + 4 * d)}px rgb(var(--c-shadow) / ${f(0.3 * d)})`);                       // 가까운 접촉 그림자
    parts.push(`0 ${f(8 + 20 * d)}px ${f(16 + 40 * d)}px -${f(6 + 8 * d)}px rgb(var(--c-shadow) / ${f(0.75 * d)})`); // 멀리 퍼지는 그림자
  }
  if (b > 0) {
    // 위쪽은 밝게, 아래쪽은 어둡게 → 돌출된 느낌 (라이트 테마에서도 같은 흰 빛)
    parts.push(`inset 0 1px 0 rgb(255 255 255 / ${f(0.16 * b)})`);
    parts.push(`inset 0 -${f(1 + 2 * b)}px ${f(2 + 3 * b)}px rgb(var(--c-shadow) / ${f(0.4 * b)})`);
  }
  return parts.length ? parts.join(', ') : '0 0 #0000';
}
// 적용
const depth = s.cardDepth?.enabled ? cardDepthShadow(s.cardDepth) : '0 0 #0000';
vars['--fx-depth-hero'] = depth;
vars['--fx-depth-card'] = s.cardDepth?.enabled && s.cardDepth.scope === 'all' ? depth : '0 0 #0000';
```
기본값(depth 0.5, bevel 0.5)의 결과 예: `0 2.00px 4.00px rgb(var(--c-shadow) / 0.15), 0 18.00px 36.00px -10.00px rgb(var(--c-shadow) / 0.38), inset 0 1px 0 rgb(255 255 255 / 0.08), inset 0 -2.00px 3.50px rgb(var(--c-shadow) / 0.20)`.

**왜 `none` 이 아니라 `0 0 #0000` 인가 + 앞에 덧붙이는 레이어링**
- 카드의 box-shadow 는 `box-shadow: var(--fx-depth-card, 0 0 #0000), var(--card-shadow);` — **효과 그림자 리스트를 카드 본래 그림자 앞에 쉼표로 이어붙인다.**
- CSS `box-shadow` 리스트 안에는 `none` 키워드를 쓸 수 없다. `none, 0 8px …` 처럼 목록 중간에 `none` 이 들어가면 **선언 전체가 무효**가 되어 그림자가 사라지거나 이전 값으로 폴백된다.
- 그래서 "꺼짐"은 `none` 이 아니라 **완전 투명한 0 크기 그림자 `0 0 #0000`** 으로 표현하고, 카드 스타일의 `--card-shadow`/`--hero-shadow` 가 "없음"일 때도 `none` 대신 `0 0 #0000` 을 쓴다(minimal·flat·glow 의 `--card-shadow`, minimal·flat 의 `--hero-shadow`, minimal `--card-hover-shadow`). 주석: "효과 그림자를 앞에 덧붙일 수 있게 none 대신 투명 그림자".
- `.fixed, [role='dialog'] { --fx-glow-card: none; --fx-depth-card: 0 0 #0000; }` — 고정 창 안에서는 효과가 새지 않게 리셋 (변수는 상속되므로 팝업 후손 `.surface` 까지 적용).

### 8.5 마운트 구조

```tsx
// main.tsx
import './index.css';
initAppearance();   // 첫 렌더 전에: 저장된 테마/변수를 <html> 에 바로 적용 → 깜빡임 방지

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <CursorTrail />      {/* 캔버스 오버레이, z-[9999] */}
      <CursorPointer />    {/* 포인터 프리셋 오버레이, z-[9999] */}
      <CardTilt />         {/* 렌더 없음, 이벤트만 */}
      <App />
    </AppearanceProvider>
  </React.StrictMode>
);
```

### 8.6 포인터 프리셋 (`CursorPointer`)

| id | 이름 | 동작 사양 |
|----|------|-----------|
| `native` | 기본 커서 | OS 커서 그대로 (컴포넌트는 `null` 렌더, 숨김 CSS 없음) |
| `dot-ring` | 점과 링 | 작은 점(6px, `h-1.5 w-1.5`)은 포인터에 **즉시**, 링(32px, `h-8 w-8`, 1.5px 테두리)은 `ease 0.18` 로 늦게 따라옴. 상호작용 요소 위(`INTERACTIVE`)에서 링 scale **1.6** + 배경 `color-mix(accent 15%, transparent)`, 누르는 동안 목표 scale ×0.7. scale 보간 계수 0.25 |
| `squish` | 속도 찌그러짐 | 18px 원, `ease 0.35`. 속도 `speed = hypot(vx,vy)`, `stretch = min(speed/40, 0.8)`, 이동 각도로 `rotate`, `scale(1+stretch, 1/(1+stretch*0.6))`. 속도 평활화 `v += (d*ease - v) * 0.35` |
| `crosshair` | 크로스헤어 | 전체 화면 가로/세로 1px 선(불투명도 .35) + 14px 사각 조준경(1px 테두리) + 포인터 옆 `(x+12, y+12)` 에 좌표 라벨(mono 10px, `"x, y"`) — 모두 포인터에 즉시 |
| `eyes` | 눈 | 두 눈(각 12×18px, 흰 바탕 `#f4f4f5` + `#27272a` 테두리, 동공 6px `#18181b`). 포인터 위 `translate(-50%, -115%)`. 동공은 이동 방향으로 `look*(2.5px, 3px)`(보간 0.2). 4~6초 간격으로 120ms 깜빡임(`scaleY(0.1)`, 모션 감소 시 생략) |

공통 사양
- 오버레이 루트: `pointer-events-none fixed inset-0 z-[9999] overflow-hidden`, 초기 `opacity:0`. 각 요소 `absolute left-0 top-0 pointer-events-none will-change-transform`, 위치는 `translate3d(x,y,0)`.
- 색: 강조색 `rgb(var(--c-mint-400))` (효과 내부에서 `readRgb('--c-mint-400', fallback)` 로 현재 테마 값을 읽음 — 테마가 바뀌면 effect 재실행).
- 터치(`pointerType==='touch'`)는 무시. 창 밖(`mouseout` relatedTarget 없음)/`blur` 에서 숨김. **텍스트 입력류(`TEXT_INPUT`) 위에서는 오버레이를 숨기고 네이티브 캐럿 커서를 쓴다.**
- 루프: rAF 는 **움직임이 남아 있을 때만** 돈다(`moving` 플래그). 수렴 판정 `SETTLE_EPS = 0.05`.
- reduced-motion: `ease = 1`(즉시 따라붙음), squish 늘어남 0, eyes 깜빡임 없음.
- **네이티브 커서 숨김 CSS**: 프리셋이 `native` 가 아닐 때 `<style>` 을 `<head>` 에 삽입하고 `<html data-cursor="custom">` 설정, 해제 시 둘 다 제거.
  ```css
  html[data-cursor=custom], html[data-cursor=custom] * { cursor: none !important; }
  html[data-cursor=custom] input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=button]):not([type=submit]),
  html[data-cursor=custom] textarea,
  html[data-cursor=custom] [contenteditable=""],
  html[data-cursor=custom] [contenteditable=true],
  html[data-cursor=custom] [contenteditable=true] * { cursor: text !important; }
  html[data-cursor=custom] select { cursor: default !important; }
  ```
- hover 성장 대상 셀렉터(`INTERACTIVE`): `a, button, [role=button], [role=switch], select, label, summary, input[type=checkbox], input[type=range]`.
- `TEXT_INPUT`: `input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=""], [contenteditable=true]`.

### 8.7 트레일 프리셋 (`CursorTrail`)

공통: 전체 화면 `<canvas className="pointer-events-none fixed inset-0 z-[9999] h-screen w-screen" aria-hidden>`. 노드 `pts[0]` 은 포인터에 고정, `pts[i]` 는 `pts[i-1]` 을 `ease` 비율로 추격(`pts[i] += (pts[i-1]-pts[i]) * ease`). 색은 강조색(`--c-mint-400`)과 보조색(`--c-sky-400`), `gradient` 켜면 꼬리로 갈수록 mint→sky(`mix(c1,c2,t)`, t = i/(n-1) 또는 수명 비율).

| 프리셋 | 이름 | 파라미터 매핑 |
|--------|------|----------------|
| `dots` | 점 사슬 | `n = nodes`개 점. 반지름 `max(1, headSize*(1 - taper*t))/2`, 알파 `1 - 0.5*t`. 꼬리부터 그려 머리가 위로 |
| `ribbon` | 리본 | 각 노드의 접선 법선으로 좌/우 점 생성, 반폭 `max(0.5, headSize*(1 - taper*t))/2`. 중점 기반 2차 곡선 `curveThrough` 로 부드럽게 연결, 머리→꼬리 선형 그라데이션 알파 `0.95 → 0.08`(gradient 시 꼬리색 sky). 머리와 꼬리가 거의 같은 점이면 단색 |
| `pixel` | 픽셀 | 격자 `cell = max(6, round(headSize/2))`. 포인터가 지나간 칸마다 사각형 생성(빠르게 움직여도 끊기지 않게 칸 보간, 한 이벤트 최대 40칸). 수명 `pixelLife = nodes*28/(0.4+ease)` ms, 최대 `nodes*3` 개. 크기 `round(cell*(1 - taper*t))`, 알파 `1-t`, 정수 좌표 |
| `ghost` | 잔상 | 클래식 화살표 실루엣(`ARROW`) 윤곽을 `i=1…n-1` 에 그림(0번은 네이티브 커서 자리). 노드가 16 초과면 하나 걸러. 크기 `h*(1 - 0.4*taper*t)`(`h = max(8, headSize)`), 알파 `max(0.04, 0.6*(1 - t*(0.4+0.6*taper)))`, 채움 알파 ×0.5 + 1px 윤곽 |
| `comet` | 혜성 | 머리 = 흰색→강조색→투명 radial glow(반지름 `max(2, headSize/2)*2`). 꼬리 = 이동 속도가 `>= 0.5` 일 때 입자 생성(프레임당 `1 + floor(nodes/10)`개, 최대 `nodes*6`), 수명 `nodes*30 * (0.6~1.0)` ms, 속도 `-vel*(0.08~0.18)` + 무작위, 마찰 0.96, 크기 `max(1, headSize*(1-taper)/2) * (0.6~1)`. `globalCompositeOperation = 'lighter'` 로 가산 합성 |

성능·정확성 규칙
1. **rAF 는 움직일 때만**: `animating` 이 true 인 동안만 다음 프레임 예약. 점 사슬은 모든 점이 앞 점과 `SETTLE_EPS = 0.1` 이내로 모이면 루프 중단. pixel 은 사각형이 남아 있는 동안, comet 은 입자가 남아 있는 동안만.
2. **DPR 캔버스**: `canvas.width = round(innerWidth * dpr)`, `setTransform(dpr,0,0,dpr,0,0)` 로 선명하게. `resize` 때 재설정.
3. 첫 등장 시 모든 점을 포인터 위치로 초기화(날아오는 현상 방지). 창 이탈/blur 시 `hide()`: 상태 초기화 + `clearRect`.
4. `pointermove` 는 `{ passive: true }`, 터치 제외.
5. reduced-motion 이면 컴포넌트가 아예 캔버스를 만들지 않는다 (`active = enabled && !reduced`).
6. effect 의존성: `[active, nodes, ease, headSize, taper, gradient, style, settings.themeId]` — 테마 변경 시 색을 다시 읽는다.
7. 트레일은 고정 레이어이며 `z-[9999]`(모달 `z-50` 보다 위) — 항상 보인다.

### 8.8 갤러리 UI 사양 (포인터/트레일 프리셋 선택)

- 위치: 효과 섹션 맨 위 `SettingsGroup icon=MousePointer2 title="프리셋"`. 두 그룹: **포인터**(5개) · **트레일**(없음 + 5개). 그룹 라벨 `label-mono mb-2 uppercase tracking-widest`.
- 그리드 `grid-cols-2 sm:grid-cols-3 gap-2`.
- 타일: `button.cpg-tile.flex.flex-col.gap-1.5.rounded-xl.p-1.5.text-left.transition-colors` + 선택/비선택 링 클래스(§6.16), `aria-pressed`, `aria-label="이름: 설명"`, `title=설명`.
  - 미리보기 영역 `flex h-16 w-full items-center justify-center rounded-lg bg-ink-900 ring-1 ring-white/5` 안에 48×32 SVG.
  - 이름 `truncate px-1 text-xs text-white`.
- 선택 의미: 포인터 타일 = `cursorPointer.style` 설정. 트레일 "없음" = `cursorTrail.enabled=false`; 트레일 프리셋 타일 = `{ enabled: true, style }`. 선택 표시는 `trail.enabled && trail.style === p.id`.
- 미리보기 SVG 는 강조색(`text-mint-400`)·보조(`text-sky-400`)·중립(`text-zinc-400`)을 `currentColor` 로 사용. hover 시에만 재생되는 미세 애니메이션(`cpg-pulse`, `cpg-slide`)은 `@media (prefers-reduced-motion: no-preference)` 안에서만 정의.
- 포인터/트레일 프리셋 목록(id · 이름 · 설명):
  - 포인터: `native` 기본 커서(운영체제 커서 그대로) · `dot-ring` 점과 링(작은 점 + 늦게 따라오는 링, 버튼 위에서 커짐) · `squish` 속도 찌그러짐(움직이는 방향으로 늘어나는 원) · `crosshair` 크로스헤어(십자선과 좌표 표시) · `eyes` 눈(움직이는 쪽을 바라보는 두 눈)
  - 트레일: `dots` 점 사슬(점이 사슬처럼 이어짐) · `ribbon` 리본(부드럽게 휘어지는 띠) · `pixel` 픽셀(격자에 맞춘 네모 조각) · `ghost` 잔상(커서 모양 잔상이 겹침) · `comet` 혜성(빛나는 머리와 흩어지는 꼬리)

### 8.9 효과 컴포넌트 전체 소스

#### CardTilt

```tsx
// frontend/src/components/effects/CardTilt.tsx
import { useEffect } from 'react';
import { useAppearance } from '../../appearance/AppearanceContext';

// 카드 입체감: 마우스를 올린 카드를 포인터 쪽으로 기울이고 살짝 띄운다 (모양 설정에서 켤 때만)
const BASE_WIDTH = 480; // 이보다 넓은 카드는 기울기를 줄여 과하지 않게

export default function CardTilt() {
  const { settings } = useAppearance();
  const { enabled, scope, tilt, lift } = settings.cardDepth;
  const active = enabled && (tilt > 0 || lift > 0);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const selector = scope === 'all' ? '.surface, .hero-grain' : '.hero-grain';
    let current: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;

    const release = (el: HTMLElement) => {
      el.style.transition = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = '';
    };

    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const target = e.target instanceof Element ? (e.target.closest(selector) as HTMLElement | null) : null;
      // 모달·알림 드롭다운처럼 화면에 고정된 창은 움직이지 않는다
      const el =
        target && (target === current || (!target.closest('[role=dialog], .fixed') && getComputedStyle(target).position !== 'fixed'))
          ? target
          : null;
      if (current && current !== el) release(current);
      current = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      const k = Math.min(1, BASE_WIDTH / r.width);
      el.style.transition = 'transform 0.12s ease-out';
      el.style.transform = `perspective(1000px) rotateX(${(-py * 2 * tilt * k).toFixed(2)}deg) rotateY(${(px * 2 * tilt * k).toFixed(2)}deg) translateY(${-lift}px)`;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (current) release(current);
      current = null;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
      if (frame) cancelAnimationFrame(frame);
      onLeave();
    };
  }, [active, scope, tilt, lift]);

  return null;
}
```

#### CursorPointer

```tsx
// frontend/src/components/effects/CursorPointer.tsx
import { useEffect, useRef } from 'react';
import { useAppearance } from '../../appearance/AppearanceContext';

// 네이티브 커서를 대체하는 포인터 프리셋 (설정에서 'native'가 아닐 때만 동작)
const SETTLE_EPS = 0.05;
const INTERACTIVE = 'a, button, [role=button], [role=switch], select, label, summary, input[type=checkbox], input[type=range]';
const TEXT_INPUT = 'input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=""], [contenteditable=true]';

// 네이티브 커서 숨김 규칙: 텍스트 입력류는 기본 캐럿 커서를 유지한다
const HIDE_CSS = `
html[data-cursor=custom], html[data-cursor=custom] * { cursor: none !important; }
html[data-cursor=custom] input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=button]):not([type=submit]),
html[data-cursor=custom] textarea,
html[data-cursor=custom] [contenteditable=""],
html[data-cursor=custom] [contenteditable=true],
html[data-cursor=custom] [contenteditable=true] * { cursor: text !important; }
html[data-cursor=custom] select { cursor: default !important; }
`;

function readRgb(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? `rgb(${v[0]} ${v[1]} ${v[2]})` : fallback;
}

export default function CursorPointer() {
  const { settings } = useAppearance();
  const style = settings.cursorPointer.style;
  const rootRef = useRef<HTMLDivElement>(null);
  const active = style !== 'native';

  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return;
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const accent = readRgb('--c-mint-400', 'rgb(45 212 191)');
    const q = (k: string) => root.querySelector<HTMLElement>(`[data-k=${k}]`);

    const styleEl = document.createElement('style');
    styleEl.textContent = HIDE_CSS;
    document.head.appendChild(styleEl);
    document.documentElement.setAttribute('data-cursor', 'custom');

    const target = { x: 0, y: 0 };
    const pos = { x: 0, y: 0 };
    let vx = 0, vy = 0; // 평활화된 속도
    let ringScale = 1, ringTarget = 1, pressed = false;
    let look = { x: 0, y: 0 }; // 눈동자 방향 (평활화)
    let shown = false, raf = 0, blinkTimer = 0;
    const ease = reduced ? 1 : style === 'squish' ? 0.35 : 0.18;

    const dot = q('dot'), ring = q('ring'), blob = q('blob');
    const lineH = q('lh'), lineV = q('lv'), reticle = q('ret'), label = q('lbl');
    const eyes = q('eyes'), pupils = [q('p0'), q('p1')], lids = [q('e0'), q('e1')];

    const setVisible = (v: boolean) => { root.style.opacity = v ? '1' : '0'; };

    const render = () => {
      if (style === 'dot-ring') {
        if (dot) dot.style.transform = `translate3d(${target.x}px,${target.y}px,0) translate(-50%,-50%)`;
        if (ring) ring.style.transform = `translate3d(${pos.x}px,${pos.y}px,0) translate(-50%,-50%) scale(${ringScale})`;
      } else if (style === 'squish' && blob) {
        const speed = Math.hypot(vx, vy);
        const stretch = reduced ? 0 : Math.min(speed / 40, 0.8);
        const ang = (Math.atan2(vy, vx) * 180) / Math.PI;
        blob.style.transform = `translate3d(${pos.x}px,${pos.y}px,0) translate(-50%,-50%) rotate(${ang}deg) scale(${1 + stretch},${1 / (1 + stretch * 0.6)})`;
      } else if (style === 'crosshair') {
        if (lineH) lineH.style.transform = `translate3d(0,${target.y}px,0)`;
        if (lineV) lineV.style.transform = `translate3d(${target.x}px,0,0)`;
        if (reticle) reticle.style.transform = `translate3d(${target.x}px,${target.y}px,0) translate(-50%,-50%)`;
        if (label) {
          label.style.transform = `translate3d(${target.x + 12}px,${target.y + 12}px,0)`;
          label.textContent = `${Math.round(target.x)}, ${Math.round(target.y)}`;
        }
      } else if (style === 'eyes' && eyes) {
        eyes.style.transform = `translate3d(${pos.x}px,${pos.y}px,0) translate(-50%,-115%)`;
        pupils.forEach((p) => { if (p) p.style.transform = `translate(${look.x * 2.5}px,${look.y * 3}px)`; });
      }
    };

    const tick = () => {
      raf = 0;
      let moving = false;
      const dx = target.x - pos.x, dy = target.y - pos.y;
      pos.x += dx * ease;
      pos.y += dy * ease;
      if (!reduced && (Math.abs(dx) > SETTLE_EPS || Math.abs(dy) > SETTLE_EPS)) moving = true;

      // 속도: 이동량을 평활화해 정지하면 0으로 수렴
      vx += (dx * ease - vx) * 0.35;
      vy += (dy * ease - vy) * 0.35;
      if (reduced) { vx = 0; vy = 0; }
      else if (Math.hypot(vx, vy) > 0.05) moving = true;
      else { vx = 0; vy = 0; }

      if (style === 'dot-ring') {
        const goal = pressed ? ringTarget * 0.7 : ringTarget;
        ringScale = reduced ? goal : ringScale + (goal - ringScale) * 0.25;
        if (Math.abs(goal - ringScale) > 0.005) moving = true;
      }
      if (style === 'eyes') {
        const sp = Math.hypot(dx, dy);
        const gx = sp > 0.5 ? dx / sp : 0, gy = sp > 0.5 ? dy / sp : 0;
        look.x += (gx - look.x) * 0.2;
        look.y += (gy - look.y) * 0.2;
        if (Math.hypot(look.x, look.y) > 0.01) moving = true;
        else look = { x: 0, y: 0 };
      }
      render();
      if (moving) raf = requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

    const applyHover = (t: EventTarget | null) => {
      const el = t instanceof Element ? t : null;
      setVisible(shown && !el?.closest(TEXT_INPUT));
      if (style === 'dot-ring') {
        ringTarget = el?.closest(INTERACTIVE) ? 1.6 : 1;
        if (ring) ring.style.background = ringTarget > 1 ? `color-mix(in srgb, ${accent} 15%, transparent)` : 'transparent';
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      target.x = e.clientX;
      target.y = e.clientY;
      if (!shown) { pos.x = e.clientX; pos.y = e.clientY; shown = true; }
      applyHover(e.target);
      kick();
    };
    const onDown = (e: PointerEvent) => { if (e.pointerType === 'touch') return; pressed = true; kick(); };
    const onUp = () => { pressed = false; kick(); };
    const hide = () => { shown = false; setVisible(false); };
    const onOut = (e: MouseEvent) => { if (!e.relatedTarget) hide(); };

    // 눈 깜빡임 (모션 감소 시 생략)
    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        lids.forEach((l) => { if (l) l.style.transform = 'scaleY(0.1)'; });
        blinkTimer = window.setTimeout(() => {
          lids.forEach((l) => { if (l) l.style.transform = 'scaleY(1)'; });
          scheduleBlink();
        }, 120);
      }, 4000 + Math.random() * 2000);
    };
    if (style === 'eyes' && !reduced) scheduleBlink();

    setVisible(false);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('mouseout', onOut);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('blur', hide);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(blinkTimer);
      document.documentElement.removeAttribute('data-cursor');
      styleEl.remove();
    };
  }, [active, style, settings.themeId]);

  if (!active) return null;

  const accent = 'rgb(var(--c-mint-400))';
  const abs = 'absolute left-0 top-0 pointer-events-none will-change-transform';
  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden"
      style={{ opacity: 0 }}
    >
      {style === 'dot-ring' && (
        <>
          <div data-k="ring" className={`${abs} h-8 w-8 rounded-full`} style={{ border: `1.5px solid ${accent}`, transition: 'background 150ms' }} />
          <div data-k="dot" className={`${abs} h-1.5 w-1.5 rounded-full`} style={{ background: accent }} />
        </>
      )}
      {style === 'squish' && (
        <div data-k="blob" className={`${abs} h-[18px] w-[18px] rounded-full`} style={{ background: accent, opacity: 0.9 }} />
      )}
      {style === 'crosshair' && (
        <>
          <div data-k="lh" className={`${abs} h-px w-full`} style={{ background: accent, opacity: 0.35 }} />
          <div data-k="lv" className={`${abs} h-full w-px`} style={{ background: accent, opacity: 0.35 }} />
          <div data-k="ret" className={`${abs} h-3.5 w-3.5`} style={{ border: `1px solid ${accent}` }} />
          <div data-k="lbl" className={`${abs} font-mono text-[10px] leading-none`} style={{ color: accent, fontFamily: 'var(--font-mono, ui-monospace, monospace)' }} />
        </>
      )}
      {style === 'eyes' && (
        <div data-k="eyes" className={`${abs} flex gap-0.5`}>
          {[0, 1].map((i) => (
            <div
              key={i}
              data-k={`e${i}`}
              className="relative flex h-[18px] w-[12px] items-center justify-center rounded-full"
              style={{ background: '#f4f4f5', border: '1px solid #27272a', transition: 'transform 80ms' }}
            >
              <div data-k={`p${i}`} className="h-[6px] w-[6px] rounded-full" style={{ background: '#18181b' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

#### CursorTrail

```tsx
// frontend/src/components/effects/CursorTrail.tsx
import { useEffect, useRef } from 'react';
import { useAppearance } from '../../appearance/AppearanceContext';

// 마우스 포인터를 따라 트레일이 이어지는 장식 효과 (설정에서 켤 때만 동작)
// 프리셋: dots(점 체인) / ribbon(리본) / pixel(격자 사각형) / ghost(화살표 잔상) / comet(혜성)
const SETTLE_EPS = 0.1;

type Rgb = [number, number, number];
type Pt = { x: number; y: number };
type Square = { cx: number; cy: number; born: number };
type Particle = { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number };

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as Rgb;
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// 클래식 화살표 커서 실루엣 (끝점이 원점, 높이 1 기준)
const ARROW: Array<[number, number]> = [
  [0, 0], [0, 0.85], [0.2, 0.67], [0.33, 0.97], [0.45, 0.91], [0.32, 0.62], [0.57, 0.62],
];

function readRgb(name: string, fallback: Rgb): Rgb {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? (v as Rgb) : fallback;
}

export default function CursorTrail() {
  const { settings } = useAppearance();
  const { enabled, nodes, ease, headSize, taper, gradient, style } = settings.cursorTrail;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const active = enabled && !reduced;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const c1 = readRgb('--c-mint-400', [45, 212, 191]);
    const c2 = readRgb('--c-sky-400', [56, 189, 248]);
    const n = Math.max(2, Math.round(nodes));
    const pts: Pt[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
    const target = { x: 0, y: 0 };
    const squares: Square[] = [];
    const particles: Particle[] = [];
    let lastCell: Pt | null = null; // pixel: 마지막으로 지난 격자 칸
    let moved = false; // comet: 직전 프레임 이후 포인터가 움직였는지
    let vel = { x: 0, y: 0 }; // comet: 머리 이동 속도
    const cell = Math.max(6, Math.round(headSize / 2));
    const pixelLife = (nodes * 28) / (0.4 + ease); // ms
    const maxSquares = Math.round(nodes * 3);
    const cometLife = nodes * 30; // ms
    const maxParticles = Math.round(nodes * 6);
    let visible = false; // 포인터가 창 안에 있고 위치를 받았는지
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const clear = () => ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const drawDots = () => {
      // 꼬리부터 그려 머리가 위에 오게 한다
      for (let i = n - 1; i >= 0; i--) {
        const t = i / (n - 1);
        const r = Math.max(1, headSize * (1 - taper * t)) / 2;
        const col = gradient ? mix(c1, c2, t) : c1;
        ctx.globalAlpha = 1 - 0.5 * t;
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    // 점 목록을 중점 기반 2차 곡선으로 이어 그린다 (현재 경로에 이어붙임)
    const curveThrough = (P: Pt[], first: boolean) => {
      if (first) ctx.moveTo(P[0].x, P[0].y); else ctx.lineTo(P[0].x, P[0].y);
      for (let i = 1; i < P.length - 1; i++) {
        ctx.quadraticCurveTo(P[i].x, P[i].y, (P[i].x + P[i + 1].x) / 2, (P[i].y + P[i + 1].y) / 2);
      }
      ctx.lineTo(P[P.length - 1].x, P[P.length - 1].y);
    };

    const drawRibbon = () => {
      const head = pts[0];
      const tail = pts[n - 1];
      const left: Pt[] = [];
      const right: Pt[] = [];
      let nx = 0, ny = 1;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(n - 1, i + 1)];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) { nx = -dy / len; ny = dx / len; }
        const t = i / (n - 1);
        const hw = Math.max(0.5, headSize * (1 - taper * t)) / 2;
        left.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
        right.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
      }
      const g = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
      const end = gradient ? c2 : c1;
      g.addColorStop(0, rgba(c1, 0.95));
      g.addColorStop(1, rgba(end, 0.08));
      ctx.fillStyle = Math.hypot(head.x - tail.x, head.y - tail.y) < 0.5 ? rgba(c1, 0.95) : g;
      ctx.beginPath();
      curveThrough(left, true);
      curveThrough(right.slice().reverse(), false);
      ctx.closePath();
      ctx.fill();
    };

    const drawPixel = (now: number) => {
      for (let i = 0; i < squares.length; i++) {
        const sq = squares[i];
        const t = (now - sq.born) / pixelLife; // 0 → 1
        if (t >= 1) continue;
        const size = Math.max(1, Math.round(cell * (1 - taper * t)));
        const col = gradient ? mix(c1, c2, t) : c1;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = rgba(col, 1);
        // 칸 중앙 기준, 정수 좌표로 또렷하게
        const off = Math.round((cell - size) / 2);
        ctx.fillRect(sq.cx * cell + off, sq.cy * cell + off, size, size);
      }
      ctx.globalAlpha = 1;
    };

    const drawGhost = () => {
      const h = Math.max(8, headSize);
      // 네이티브 커서가 머리 자리를 차지하므로 index 1부터, 노드가 많으면 하나 걸러 그린다
      const stepI = n > 16 ? 2 : 1;
      for (let i = n - 1; i >= 1; i--) {
        if (i % stepI !== 0) continue;
        const t = i / (n - 1);
        const sc = h * (1 - 0.4 * taper * t);
        const col = gradient ? mix(c1, c2, t) : c1;
        const alpha = Math.max(0.04, 0.6 * (1 - t * (0.4 + 0.6 * taper)));
        ctx.beginPath();
        ARROW.forEach(([ax, ay], k) => {
          const x = pts[i].x + ax * sc, y = pts[i].y + ay * sc;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = rgba(col, 1);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = rgba(col, 1);
        ctx.lineWidth = 1;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const drawComet = (now: number) => {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const t = (now - p.born) / p.life;
        if (t >= 1) continue;
        const col = gradient ? mix(c1, c2, t) : c1;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * (1 - t * 0.6)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const r = Math.max(2, headSize / 2);
      const hx = target.x, hy = target.y;
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 2);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.35, rgba(c1, 0.8));
      g.addColorStop(1, rgba(gradient ? c2 : c1, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hx, hy, r * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    };

    const draw = (now: number) => {
      clear();
      if (!visible) return;
      if (style === 'ribbon') drawRibbon();
      else if (style === 'pixel') drawPixel(now);
      else if (style === 'ghost') drawGhost();
      else if (style === 'comet') drawComet(now);
      else drawDots();
    };

    // 수명이 다한 사각형·입자 제거
    const prune = (now: number) => {
      for (let i = squares.length - 1; i >= 0; i--) if (now - squares[i].born >= pixelLife) squares.splice(i, 1);
      for (let i = particles.length - 1; i >= 0; i--) if (now - particles[i].born >= particles[i].life) particles.splice(i, 1);
    };

    const spawnParticles = (now: number) => {
      if (Math.hypot(vel.x, vel.y) < 0.5) return;
      const count = 1 + Math.floor(nodes / 10);
      const size = Math.max(1, (headSize * (1 - taper)) / 2);
      for (let k = 0; k < count && particles.length < maxParticles; k++) {
        const back = 0.08 + Math.random() * 0.1;
        particles.push({
          x: target.x + (Math.random() - 0.5) * headSize * 0.5,
          y: target.y + (Math.random() - 0.5) * headSize * 0.5,
          vx: -vel.x * back + (Math.random() - 0.5) * 0.6,
          vy: -vel.y * back + (Math.random() - 0.5) * 0.6,
          born: now,
          life: cometLife * (0.6 + Math.random() * 0.4),
          size: size * (0.6 + Math.random() * 0.4),
        });
      }
    };

    const tick = () => {
      raf = 0;
      const now = performance.now();
      let animating = false;
      pts[0].x = target.x;
      pts[0].y = target.y;
      for (let i = 1; i < n; i++) {
        const dx = pts[i - 1].x - pts[i].x;
        const dy = pts[i - 1].y - pts[i].y;
        pts[i].x += dx * ease;
        pts[i].y += dy * ease;
        if (Math.abs(dx) > SETTLE_EPS || Math.abs(dy) > SETTLE_EPS) animating = true;
      }
      if (style === 'pixel') {
        prune(now);
        animating = squares.length > 0; // 사각형이 남아 있는 동안만 루프 유지
      } else if (style === 'comet') {
        if (moved) { spawnParticles(now); moved = false; }
        else vel = { x: 0, y: 0 };
        for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy *= 0.96; }
        prune(now);
        animating = particles.length > 0;
      }
      draw(now);
      if (animating) raf = requestAnimationFrame(tick); // 다 모이면 루프 중단
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      vel = { x: e.clientX - target.x, y: e.clientY - target.y };
      target.x = e.clientX;
      target.y = e.clientY;
      moved = true;
      if (style === 'pixel') {
        // 지나온 칸마다 사각형 생성 (빠르게 움직여도 끊기지 않게 보간)
        const cx = Math.floor(e.clientX / cell), cy = Math.floor(e.clientY / cell);
        const from = lastCell ?? { x: cx, y: cy };
        const steps = Math.min(40, Math.max(Math.abs(cx - from.x), Math.abs(cy - from.y)));
        const now = performance.now();
        for (let k = lastCell ? 1 : 0; k <= Math.max(1, steps); k++) {
          const f = steps ? k / steps : 1;
          const sx = Math.round(from.x + (cx - from.x) * f), sy = Math.round(from.y + (cy - from.y) * f);
          if (lastCell && sx === lastCell.x && sy === lastCell.y) continue;
          squares.push({ cx: sx, cy: sy, born: now });
          lastCell = { x: sx, y: sy };
        }
        if (squares.length > maxSquares) squares.splice(0, squares.length - maxSquares);
      }
      if (!visible) {
        // 처음 나타날 때는 모든 점을 포인터 위치에서 시작
        pts.forEach((p) => { p.x = e.clientX; p.y = e.clientY; });
        visible = true;
        vel = { x: 0, y: 0 };
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const hide = () => {
      visible = false;
      lastCell = null;
      squares.length = 0;
      particles.length = 0;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      clear();
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) hide();
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('mouseout', onOut);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('blur', hide);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, nodes, ease, headSize, taper, gradient, style, settings.themeId]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999] h-screen w-screen"
    />
  );
}
```

### 8.10 설정 옵션 전체 (`options.ts`)

```ts
// frontend/src/appearance/options.ts
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
  { id: 'pretendard', name: 'Pretendard', family: '"Pretendard Variable", Pretendard', sample: '총계 12,480' },
  { id: 'noto-sans-kr', name: 'Noto Sans KR', family: '"Noto Sans KR"', sample: '총계 12,480' },
  { id: 'ibm-plex-sans-kr', name: 'IBM Plex Sans KR', family: '"IBM Plex Sans KR"', sample: '총계 12,480' },
  { id: 'nanum-gothic', name: '나눔고딕', family: '"Nanum Gothic"', sample: '총계 12,480' },
  { id: 'gowun-dodum', name: '고운돋움', family: '"Gowun Dodum"', sample: '총계 12,480' },
  { id: 'system', name: '시스템 기본', family: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic"', sample: '총계 12,480' },
];

export const MONO_FONTS: FontOption[] = [
  { id: 'jetbrains-mono', name: 'JetBrains Mono', family: '"JetBrains Mono"', sample: 'LABEL 1,325.4' },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', family: '"IBM Plex Mono"', sample: 'LABEL 1,325.4' },
  { id: 'fira-code', name: 'Fira Code', family: '"Fira Code"', sample: 'LABEL 1,325.4' },
  { id: 'nanum-gothic-coding', name: '나눔고딕코딩', family: '"Nanum Gothic Coding"', sample: '보조 값 1,325.4' },
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

// 커서 트레일(Cascading Dots) 설정 범위 — 설정 UI 슬라이더도 이 값으로 만든다
export const CURSOR_TRAIL_LIMITS = {
  nodes: { min: 3, max: 30, step: 1 },
  ease: { min: 0.05, max: 0.9, step: 0.01 },
  headSize: { min: 6, max: 48, step: 1 },
  taper: { min: 0, max: 1, step: 0.05 },
} as const;

// 카드 그라데이션(광원) 설정 범위
export const CARD_GLOW_LIMITS = {
  intensity: { min: 0, max: 0.5, step: 0.01 }, // 광원 불투명도
  size: { min: 20, max: 120, step: 5 }, // 광원 반경(%)
  x: { min: 0, max: 100, step: 5 }, // 광원 위치 가로(%)
  y: { min: 0, max: 100, step: 5 }, // 광원 위치 세로(%)
} as const;

// 커서 프리셋 (모양 설정 > 효과 갤러리)
export const POINTER_PRESETS = [
  { id: 'native', name: '기본 커서', description: '운영체제 커서 그대로' },
  { id: 'dot-ring', name: '점과 링', description: '작은 점 + 늦게 따라오는 링, 버튼 위에서 커짐' },
  { id: 'squish', name: '속도 찌그러짐', description: '움직이는 방향으로 늘어나는 원' },
  { id: 'crosshair', name: '크로스헤어', description: '십자선과 좌표 표시' },
  { id: 'eyes', name: '눈', description: '움직이는 쪽을 바라보는 두 눈' },
] as const;
export type PointerPresetId = (typeof POINTER_PRESETS)[number]['id'];

export const TRAIL_PRESETS = [
  { id: 'dots', name: '점 사슬', description: '점이 사슬처럼 이어짐' },
  { id: 'ribbon', name: '리본', description: '부드럽게 휘어지는 띠' },
  { id: 'pixel', name: '픽셀', description: '격자에 맞춘 네모 조각' },
  { id: 'ghost', name: '잔상', description: '커서 모양 잔상이 겹침' },
  { id: 'comet', name: '혜성', description: '빛나는 머리와 흩어지는 꼬리' },
] as const;
export type TrailPresetId = (typeof TRAIL_PRESETS)[number]['id'];

// 카드 입체감 설정 범위
export const CARD_DEPTH_LIMITS = {
  depth: { min: 0, max: 1, step: 0.05 },
  bevel: { min: 0, max: 1, step: 0.05 },
  tilt: { min: 0, max: 12, step: 1 }, // 도
  lift: { min: 0, max: 10, step: 1 }, // px
} as const;
```

---

## 9. 모양 설정 화면 스펙

### 9.1 전체 구조

설정 모달 = **Portal + `role="dialog"` 패널(`surface`)**, 3단 구조(헤더 / 본문 / 푸터).

```
오버레이  fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm
└ 패널    surface flex w-full max-w-4xl max-h-[85vh] flex-col outline-none   (role=dialog aria-modal aria-label="모양", tabIndex -1)
   ├ 헤더  flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]
   │       h2.text-base.font-semibold.text-white "모양"   +  btn-icon(X) "닫기"
   ├ 본문  flex min-h-0 flex-1 flex-col md:flex-row
   │   ├ nav  shrink-0 p-3 md:w-48 md:border-r md:border-white/[0.08]
   │   │      모바일(<md): glass-pill flex p-1 gap-1 안에 pill-item flex-1 ×4  (활성 pill-item-active)
   │   │      데스크톱(md+): 세로 버튼 목록 (w-full rounded-xl px-3 py-2.5 text-left text-sm, 선택 ring-1 ring-mint-400/60 bg-white/[0.06] text-white / 비선택 text-zinc-400 ring-1 ring-white/10 hover:bg-white/[0.04])
   │   └ 콘텐츠 min-h-0 flex-1 overflow-y-auto p-4 sm:p-5   (선택된 섹션 하나만 렌더)
   └ 푸터  flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-white/[0.08]
           왼쪽 text-xs text-zinc-500 "변경 사항은 이 기기에 자동 저장됩니다"
           오른쪽 [btn-ghost !rounded-xl + RotateCcw 아이콘 "기본값으로 되돌리기"] [btn-primary "완료"]
```
- 닫기: Esc / 오버레이 `onMouseDown`(target===currentTarget) / 헤더 X / "완료". 열릴 때 패널에 `focus()`.
- **즉시 적용**: 모든 컨트롤은 `update(patch)` 를 호출하고 즉시 `<html>` 변수에 반영된다(저장 버튼 없음). 모달 뒤의 실제 화면이 바로 바뀌는 것이 라이브 미리보기다.

### 9.2 섹션 4개

`Section = 'theme' | 'card' | 'font' | 'effects'`, 라벨은 `앱 테마 / 카드 스타일 / 글꼴 / 효과`. 기본 선택 `theme`.

| 섹션 | 구성 |
|------|------|
| **테마** | `SettingsGroup(Palette, "앱 테마")` 안에 **다크** / **라이트** 두 그룹(`label-mono mb-2` 제목 + `grid grid-cols-1 sm:grid-cols-2 gap-2`). 타일 = 테마 미니 미리보기 64×40 + 이름 |
| **카드 스타일** | `SettingsGroup(LayoutTemplate, "카드 스타일")`, 8개 타일 `grid grid-cols-1 sm:grid-cols-2 gap-2`. 타일 = 88×56 실제 컴포넌트 미리보기(§5.6) + 이름(`text-sm font-medium text-white`) + 설명(`text-xs text-zinc-400 line-clamp-2`) |
| **글꼴** | `SettingsGroup(Type, "글꼴")`: ① 샘플 `surface p-4`(라벨 + `text-3xl font-semibold` 큰 값 + `num label-mono` 보조값) ② 본문 글꼴 목록 ③ 고정폭 글꼴 목록 ④ `SettingRow "글자 크기"` + Slider(인덱스 0~2, 포맷 `15px/16px/17px`) |
| **효과** | 위→아래: `CursorPresetGallery`(프리셋) → `CardGlowGroup`(카드 그라데이션) → `CardDepthGroup`(카드 입체감) → "트레일 세부 조정" → "색상" → 전체 초기화 버튼 |

**테마 미리보기(64×40)**: 배경 = 테마 `bg`, inset 1px 테두리 `mix(bg, fg, 0.15)`.
- 상단바 11px 높이, 색 `theme.surface ?? mix(bg, fg, 0.05)`, 4px 점 3개(첫 점 = accent, 나머지 `mix(bg, fg, 0.35)`), 점 간격 3px.
- 본문: 막대 3개 — fg 75% 폭(불투명 .9), fg 55% 폭(.45), accent 30% 폭(높이 4px).
- 선택 = `ring-2 ring-mint-400 bg-mint-400/10`.

**글꼴 목록 타일**: 이름(`label-mono mb-1`) + 샘플 문구(`text-sm text-white truncate`, `style={{fontFamily: f.family}}` 로 해당 글꼴로 렌더). 샘플 문구는 숫자·한글이 섞인 짧은 문장(예: `총계 12,480` / mono: `LABEL 1,325.4`).

**효과 섹션 컨트롤**
- 카드 그라데이션 / 카드 입체감 그룹: 헤더 우측 `Switch`(켜기), 설명 `text-xs leading-relaxed text-zinc-500`, **적용 범위** 세그먼트(`glass-pill inline-flex gap-1 p-1` + `pill-item`, 값 `대표 카드(hero)` / `모든 카드(all)`), 슬라이더들(§8.2 limits), 켜기 전에는 컨트롤 `disabled`.
  - 그라데이션: 강도/퍼짐/위치(가로)/위치(세로) + `두 가지 색`(힌트 "반대쪽에 하늘색 광원") 스위치 + 미리보기 `hero-grain flex h-24 items-end p-4`.
  - 입체감: 그림자 깊이/모서리 빛/기울기/떠오름 + 미리보기(§9.4).
- 트레일 세부 조정: 점 개수 / 따라오는 속도 / 머리 크기 / 꼬리 줄어듦. 헤더 우측 현재 프리셋 이름(mono), 트레일이 꺼져 있으면 `없음`, 컨트롤 disabled.
- 색상: `그라데이션` 스위치(힌트 "강조색에서 하늘색으로") + `색상` 행(`h-5 w-5 rounded-md bg-mint-400 ring-1 ring-white/20` 스와치, 그라데이션이면 `bg-sky-400` 스와치 추가, "앱 테마 강조색을 따름").
- 맨 아래 `btn-ghost w-full justify-center !rounded-full !py-2.5` "효과 초기화" → `cursorTrail/cursorPointer/cardGlow/cardDepth` 만 기본값으로(테마·카드 스타일·글꼴은 유지).

### 9.3 설정 컴포넌트 전체 소스

#### AppearanceSettings.tsx

> 미리보기 안의 문구(`총계`, `12,480`, `LABEL 1,325.4` 등)는 중립 예시입니다. 앱에 맞는 문구로 바꿔도 됩니다.

```tsx
// frontend/src/components/settings/AppearanceSettings.tsx
import { useEffect, useRef, useState } from 'react';
import { X, Palette, LayoutTemplate, Type, RotateCcw, MousePointer2, Contrast, SunMedium, Box } from 'lucide-react';
import {
  useAppearance,
  DEFAULT_CURSOR_TRAIL,
  DEFAULT_CARD_GLOW,
  DEFAULT_CARD_DEPTH,
  type CardDepthSettings,
  DEFAULT_CURSOR_POINTER,
  type CursorTrailSettings,
  type CardGlowSettings,
} from '../../appearance/AppearanceContext';
import Switch from '../ui/Switch';
import CursorPresetGallery from './CursorPresetGallery';
import { THEMES, mix, type AppTheme } from '../../appearance/themes';
import Portal from '../ui/Portal';
import Slider from '../ui/Slider';
import { SettingsGroup, SettingRow } from '../ui/SettingsGroup';
import {
  CARD_STYLES,
  SANS_FONTS,
  MONO_FONTS,
  FONT_SIZES,
  CURSOR_TRAIL_LIMITS,
  TRAIL_PRESETS,
  CARD_GLOW_LIMITS,
  CARD_DEPTH_LIMITS,
  type FontOption,
} from '../../appearance/options';

type Section = 'theme' | 'card' | 'font' | 'effects';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'theme', label: '앱 테마' },
  { id: 'card', label: '카드 스타일' },
  { id: 'font', label: '글꼴' },
  { id: 'effects', label: '효과' },
];

const selectedCls = 'ring-2 ring-mint-400 bg-mint-400/10';
const idleCls = 'ring-1 ring-white/10 hover:bg-white/[0.04]';

function ThemePreview({ theme }: { theme: AppTheme }) {
  const bar = theme.surface ?? mix(theme.bg, theme.fg, 0.05);
  const dim = mix(theme.bg, theme.fg, 0.35);
  return (
    <div
      className="shrink-0 overflow-hidden rounded-md"
      style={{ width: 64, height: 40, background: theme.bg, boxShadow: `inset 0 0 0 1px ${mix(theme.bg, theme.fg, 0.15)}` }}
    >
      <div className="flex items-center gap-[3px] px-1.5" style={{ height: 11, background: bar }}>
        <span className="rounded-full" style={{ width: 4, height: 4, background: theme.accent }} />
        <span className="rounded-full" style={{ width: 4, height: 4, background: dim }} />
        <span className="rounded-full" style={{ width: 4, height: 4, background: dim }} />
      </div>
      <div className="px-1.5 pt-1.5">
        <div className="rounded-full" style={{ height: 3, width: '75%', background: theme.fg, opacity: 0.9 }} />
        <div className="mt-[3px] rounded-full" style={{ height: 3, width: '55%', background: theme.fg, opacity: 0.45 }} />
        <div className="mt-1.5 rounded-full" style={{ height: 4, width: '30%', background: theme.accent }} />
      </div>
    </div>
  );
}

function ThemeGroup({ title, themes }: { title: string; themes: AppTheme[] }) {
  const { settings, update } = useAppearance();
  if (themes.length === 0) return null;
  return (
    <div>
      <div className="label-mono mb-2">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {themes.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => update({ themeId: t.id })}
            aria-pressed={settings.themeId === t.id}
            className={`flex items-center gap-3 rounded-xl p-2 text-left transition-colors ${
              settings.themeId === t.id ? selectedCls : idleCls
            }`}
          >
            <ThemePreview theme={t} />
            <span className="text-sm text-white truncate">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemeSection() {
  return (
    <SettingsGroup icon={Palette} title="앱 테마">
      <ThemeGroup title="다크" themes={THEMES.filter((t) => t.mode === 'dark')} />
      <ThemeGroup title="라이트" themes={THEMES.filter((t) => t.mode === 'light')} />
    </SettingsGroup>
  );
}

function CardSection() {
  const { settings, update } = useAppearance();
  return (
    <SettingsGroup icon={LayoutTemplate} title="카드 스타일">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {CARD_STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => update({ cardStyle: s.id })}
          aria-pressed={settings.cardStyle === s.id}
          className={`flex items-start gap-3 rounded-xl p-2.5 text-left transition-colors ${
            settings.cardStyle === s.id ? selectedCls : idleCls
          }`}
        >
          <div
            data-card={s.id}
            className="app-bg shrink-0 overflow-hidden rounded-lg flex items-center gap-1.5 p-2"
            style={{ width: 88, height: 56 }}
          >
            <div className="surface flex-1 h-full !rounded-md" />
            <div className="flex-1 h-full flex flex-col gap-1">
              <div className="surface flex-1 !rounded-md" />
              <div className="btn-primary !p-0 !min-h-0 h-2.5 !rounded-full" />
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white">{s.name}</div>
            <div className="mt-0.5 text-xs text-zinc-400 line-clamp-2">{s.description}</div>
          </div>
        </button>
      ))}
    </div>
    </SettingsGroup>
  );
}

function FontList({
  fonts,
  value,
  onSelect,
}: {
  fonts: FontOption[];
  value: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {fonts.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onSelect(f.id)}
          aria-pressed={value === f.id}
          className={`rounded-xl px-3 py-2.5 text-left transition-colors ${value === f.id ? selectedCls : idleCls}`}
        >
          <div className="label-mono mb-1">{f.name}</div>
          <div className="text-sm text-white truncate" style={{ fontFamily: f.family }}>
            {f.sample}
          </div>
        </button>
      ))}
    </div>
  );
}

function FontSection() {
  const { settings, update } = useAppearance();
  const sizeIdx = Math.max(0, FONT_SIZES.findIndex((f) => f.id === settings.fontSize));
  return (
    <SettingsGroup icon={Type} title="글꼴">
      <div className="surface p-4">
        <div className="label-mono">총계</div>
        <div className="mt-1 text-3xl font-semibold tracking-tight text-white">12,480</div>
        <div className="num label-mono mt-2">LABEL 1,325.4</div>
      </div>
      <div>
        <div className="label-mono mb-2">본문 글꼴</div>
        <FontList fonts={SANS_FONTS} value={settings.sansFont} onSelect={(id) => update({ sansFont: id })} />
      </div>
      <div>
        <div className="label-mono mb-2">숫자 · 라벨 글꼴 (고정폭)</div>
        <FontList fonts={MONO_FONTS} value={settings.monoFont} onSelect={(id) => update({ monoFont: id })} />
      </div>
      <SettingRow label="글자 크기">
        <Slider
          value={sizeIdx}
          min={0}
          max={FONT_SIZES.length - 1}
          step={1}
          ariaLabel="글자 크기"
          format={(i) => `${FONT_SIZES[i].px}px`}
          onChange={(i) => update({ fontSize: FONT_SIZES[i].id })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

function CardGlowGroup() {
  const { settings, update } = useAppearance();
  const glow = settings.cardGlow;
  const set = (patch: Partial<CardGlowSettings>) => update({ cardGlow: { ...glow, ...patch } });
  const L = CARD_GLOW_LIMITS;
  const sliders: { key: 'intensity' | 'size' | 'x' | 'y'; label: string; format: (v: number) => string }[] = [
    { key: 'intensity', label: '강도', format: (v) => `${Math.round(v * 100)}%` },
    { key: 'size', label: '퍼짐', format: (v) => `${v}%` },
    { key: 'x', label: '위치 (가로)', format: (v) => `${v}%` },
    { key: 'y', label: '위치 (세로)', format: (v) => `${v}%` },
  ];
  return (
    <SettingsGroup
      icon={SunMedium}
      title="카드 그라데이션"
      action={<Switch checked={glow.enabled} onChange={(v) => set({ enabled: v })} label="카드 그라데이션 켜기" />}
    >
      <p className="text-xs leading-relaxed text-zinc-500">카드 위에 강조색 광원을 겹칩니다. 바뀐 모양은 뒤쪽 화면에 바로 반영됩니다.</p>
      <SettingRow label="적용 범위">
        <div className="glass-pill inline-flex gap-1 p-1">
          {(
            [
              { value: 'hero', label: '대표 카드' },
              { value: 'all', label: '모든 카드' },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={!glow.enabled}
              onClick={() => set({ scope: o.value })}
              className={`pill-item disabled:opacity-50 ${glow.scope === o.value ? 'pill-item-active' : ''}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </SettingRow>
      {sliders.map((s) => (
        <SettingRow key={s.key} label={s.label}>
          <Slider
            value={glow[s.key]}
            min={L[s.key].min}
            max={L[s.key].max}
            step={L[s.key].step}
            ariaLabel={`카드 그라데이션 ${s.label}`}
            format={s.format}
            disabled={!glow.enabled}
            onChange={(v) => set({ [s.key]: v })}
          />
        </SettingRow>
      ))}
      <SettingRow label="두 가지 색" hint="반대쪽에 하늘색 광원">
        <Switch checked={glow.gradient} onChange={(v) => set({ gradient: v })} label="두 가지 색 광원" disabled={!glow.enabled} />
      </SettingRow>
      {/* 미리보기: 대표 카드와 같은 클래스 */}
      <div className="hero-grain flex h-24 items-end p-4" aria-hidden>
        <div>
          <div className="label-mono">총계 라벨</div>
          <div className="mt-1 text-2xl font-light tracking-tight text-white">12,480</div>
        </div>
      </div>
    </SettingsGroup>
  );
}

function CardDepthGroup() {
  const { settings, update } = useAppearance();
  const depth = settings.cardDepth;
  const set = (patch: Partial<CardDepthSettings>) => update({ cardDepth: { ...depth, ...patch } });
  const L = CARD_DEPTH_LIMITS;
  const sliders: { key: 'depth' | 'bevel' | 'tilt' | 'lift'; label: string; format: (v: number) => string }[] = [
    { key: 'depth', label: '그림자 깊이', format: (v) => `${Math.round(v * 100)}%` },
    { key: 'bevel', label: '모서리 빛', format: (v) => `${Math.round(v * 100)}%` },
    { key: 'tilt', label: '기울기', format: (v) => (v === 0 ? '끔' : `${v}°`) },
    { key: 'lift', label: '떠오름', format: (v) => (v === 0 ? '끔' : `${v}px`) },
  ];
  return (
    <SettingsGroup
      icon={Box}
      title="카드 입체감"
      action={<Switch checked={depth.enabled} onChange={(v) => set({ enabled: v })} label="카드 입체감 켜기" />}
    >
      <p className="text-xs leading-relaxed text-zinc-500">
        그림자와 모서리 빛으로 카드를 띄우고, 마우스를 올리면 포인터 쪽으로 기울어집니다. 아래 미리보기 카드에 마우스를 올려 보세요.
      </p>
      <SettingRow label="적용 범위">
        <div className="glass-pill inline-flex gap-1 p-1">
          {(
            [
              { value: 'hero', label: '대표 카드' },
              { value: 'all', label: '모든 카드' },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={!depth.enabled}
              onClick={() => set({ scope: o.value })}
              className={`pill-item disabled:opacity-50 ${depth.scope === o.value ? 'pill-item-active' : ''}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </SettingRow>
      {sliders.map((s) => (
        <SettingRow key={s.key} label={s.label}>
          <Slider
            value={depth[s.key]}
            min={L[s.key].min}
            max={L[s.key].max}
            step={L[s.key].step}
            ariaLabel={`카드 입체감 ${s.label}`}
            format={s.format}
            disabled={!depth.enabled}
            onChange={(v) => set({ [s.key]: v })}
          />
        </SettingRow>
      ))}
      {/* 설정 창 안의 카드는 기울지 않으므로 미리보기는 여기서 직접 기울인다 */}
      <DepthPreview />
    </SettingsGroup>
  );
}

function DepthPreview() {
  const { settings } = useAppearance();
  const { enabled, tilt, lift } = settings.cardDepth;
  const [t, setT] = useState('');
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setT(`perspective(800px) rotateX(${(-py * 2 * tilt).toFixed(2)}deg) rotateY(${(px * 2 * tilt).toFixed(2)}deg) translateY(${-lift}px)`);
  };
  return (
    <div className="px-2 pb-2 pt-3">
      <div
        className="hero-grain flex h-24 items-end p-4"
        style={{ transform: t, transition: t ? 'transform 0.12s ease-out' : 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)' }}
        onPointerMove={move}
        onPointerLeave={() => setT('')}
      >
        <div>
          <div className="label-mono">총계 라벨</div>
          <div className="mt-1 text-2xl font-light tracking-tight text-white">12,480</div>
        </div>
      </div>
    </div>
  );
}

function EffectsSection() {
  const { settings, update } = useAppearance();
  const trail = settings.cursorTrail;
  const set = (patch: Partial<CursorTrailSettings>) => update({ cursorTrail: { ...trail, ...patch } });
  const L = CURSOR_TRAIL_LIMITS;
  const presetName = TRAIL_PRESETS.find((p) => p.id === trail.style)?.name ?? '';
  const sliders: { key: 'nodes' | 'ease' | 'headSize' | 'taper'; label: string; format: (v: number) => string }[] = [
    { key: 'nodes', label: '점 개수', format: (v) => String(v) },
    { key: 'ease', label: '따라오는 속도', format: (v) => v.toFixed(2) },
    { key: 'headSize', label: '머리 크기', format: (v) => `${v}px` },
    { key: 'taper', label: '꼬리 줄어듦', format: (v) => v.toFixed(2) },
  ];
  return (
    <div className="space-y-4">
      <CursorPresetGallery />
      <CardGlowGroup />
      <CardDepthGroup />
      <SettingsGroup
        icon={MousePointer2}
        title="트레일 세부 조정"
        action={<span className="label-mono">{trail.enabled ? presetName : '없음'}</span>}
      >
        <p className="text-xs leading-relaxed text-zinc-500">
          위 프리셋에서 트레일을 고른 뒤 모양을 다듬을 수 있습니다. 트레일이 꺼져 있으면 조절할 수 없습니다.
        </p>
        {sliders.map((s) => (
          <SettingRow key={s.key} label={s.label}>
            <Slider
              value={trail[s.key]}
              min={L[s.key].min}
              max={L[s.key].max}
              step={L[s.key].step}
              ariaLabel={s.label}
              format={s.format}
              disabled={!trail.enabled}
              onChange={(v) => set({ [s.key]: v })}
            />
          </SettingRow>
        ))}
      </SettingsGroup>
      <SettingsGroup icon={Contrast} title="색상">
        <SettingRow label="그라데이션" hint="강조색에서 하늘색으로">
          <Switch checked={trail.gradient} onChange={(v) => set({ gradient: v })} label="그라데이션" disabled={!trail.enabled} />
        </SettingRow>
        <SettingRow label="색상">
          <span className="inline-flex items-center gap-2 text-xs text-zinc-400">
            <span className="h-5 w-5 rounded-md bg-mint-400 ring-1 ring-white/20" />
            {trail.gradient && <span className="h-5 w-5 rounded-md bg-sky-400 ring-1 ring-white/20" />}
            앱 테마 강조색을 따름
          </span>
        </SettingRow>
      </SettingsGroup>
      <button type="button" className="btn-ghost w-full justify-center !rounded-full !py-2.5" onClick={() => update({ cursorTrail: DEFAULT_CURSOR_TRAIL, cursorPointer: DEFAULT_CURSOR_POINTER, cardGlow: DEFAULT_CARD_GLOW, cardDepth: DEFAULT_CARD_DEPTH })}>
        <RotateCcw className="h-4 w-4" />
        효과 초기화
      </button>
    </div>
  );
}

export default function AppearanceSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reset } = useAppearance();
  const [section, setSection] = useState<Section>('theme');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="모양"
          className="surface flex w-full max-w-4xl max-h-[85vh] flex-col outline-none"
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]">
            <h2 className="text-base font-semibold text-white">모양</h2>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <nav className="shrink-0 p-3 md:w-48 md:border-r md:border-white/[0.08]">
              <div className="glass-pill flex md:hidden p-1 gap-1">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSection(s.id)}
                    className={`pill-item flex-1 ${section === s.id ? 'pill-item-active' : ''}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="hidden md:flex flex-col gap-2">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSection(s.id)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                      section === s.id
                        ? 'ring-1 ring-mint-400/60 bg-white/[0.06] text-white'
                        : 'text-zinc-400 ring-1 ring-white/10 hover:bg-white/[0.04]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {section === 'theme' && <ThemeSection />}
              {section === 'card' && <CardSection />}
              {section === 'font' && <FontSection />}
              {section === 'effects' && <EffectsSection />}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-white/[0.08]">
            <span className="text-xs text-zinc-500">변경 사항은 이 기기에 자동 저장됩니다</span>
            <div className="flex flex-1 sm:flex-none items-center gap-2">
              <button
                type="button"
                className="btn-ghost flex flex-1 sm:flex-none items-center justify-center gap-1.5 !rounded-xl"
                onClick={reset}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                기본값으로 되돌리기
              </button>
              <button type="button" className="btn-primary" onClick={onClose}>
                완료
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
```

#### CursorPresetGallery.tsx

```tsx
// frontend/src/components/settings/CursorPresetGallery.tsx
import type { ReactNode } from 'react';
import { MousePointer2 } from 'lucide-react';
import { useAppearance } from '../../appearance/AppearanceContext';
import { POINTER_PRESETS, TRAIL_PRESETS, type PointerPresetId, type TrailPresetId } from '../../appearance/options';
import { SettingsGroup } from '../ui/SettingsGroup';

const selectedCls = 'ring-2 ring-mint-400 bg-mint-400/10';
const idleCls = 'ring-1 ring-white/10 hover:bg-white/[0.04]';

// 화살표 커서 경로 (24x24 기준 좌상단 팁)
const ARROW = 'M2 2 L2 17 L6 13 L9 20 L12 18.8 L9 12 L15 12 Z';

// 호버 시에만 재생되는 미세 애니메이션 (움직임 줄이기 설정 존중)
const PREVIEW_CSS = `
.cpg-anim { transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .cpg-tile:hover .cpg-pulse { animation: cpg-pulse 0.9s ease-in-out infinite; }
  .cpg-tile:hover .cpg-slide { animation: cpg-slide 0.9s ease-in-out infinite alternate; }
}
@keyframes cpg-pulse { 50% { transform: scale(1.18); } }
@keyframes cpg-slide { to { transform: translateX(3px); } }
`;

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="48" height="32" viewBox="0 0 48 32" fill="none" aria-hidden="true" className="overflow-visible">
      {children}
    </svg>
  );
}

function Arrow({ x, y, opacity = 1, className = 'text-mint-400' }: { x: number; y: number; opacity?: number; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(0.7)`} opacity={opacity} className={className}>
      <path d={ARROW} fill="currentColor" stroke="rgba(0,0,0,0.35)" strokeWidth="1" strokeLinejoin="round" />
    </g>
  );
}

const POINTER_PREVIEWS: Record<PointerPresetId, ReactNode> = {
  native: (
    <Svg>
      <Arrow x={17} y={6} className="text-zinc-400" />
    </Svg>
  ),
  'dot-ring': (
    <Svg>
      <circle className="cpg-anim cpg-pulse text-mint-400" cx="24" cy="16" r="11" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <circle cx="24" cy="16" r="3" className="text-mint-400" fill="currentColor" />
    </Svg>
  ),
  squish: (
    <Svg>
      <ellipse className="cpg-anim cpg-slide text-mint-400" cx="22" cy="16" rx="14" ry="6" fill="currentColor" opacity="0.85" />
    </Svg>
  ),
  crosshair: (
    <Svg>
      <g className="text-mint-400" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M24 3 V13 M24 19 V29 M9 16 H19 M29 16 H39" />
      </g>
      <rect x="22" y="14" width="4" height="4" className="text-sky-400" fill="currentColor" />
    </Svg>
  ),
  eyes: (
    <Svg>
      <g className="text-zinc-400" stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="15" cy="16" rx="7" ry="9" fill="rgba(255,255,255,0.9)" />
        <ellipse cx="33" cy="16" rx="7" ry="9" fill="rgba(255,255,255,0.9)" />
      </g>
      <g className="cpg-anim cpg-slide">
        <circle cx="17" cy="17" r="3.2" fill="#111" />
        <circle cx="35" cy="17" r="3.2" fill="#111" />
      </g>
    </Svg>
  ),
};

const TRAIL_PREVIEWS: Record<TrailPresetId, ReactNode> = {
  dots: (
    <Svg>
      <g className="text-mint-400" fill="currentColor">
        <circle cx="8" cy="22" r="1.8" opacity="0.3" />
        <circle cx="16" cy="19" r="2.6" opacity="0.5" />
        <circle cx="25" cy="15" r="3.6" opacity="0.75" />
        <circle cx="36" cy="10" r="5" />
      </g>
    </Svg>
  ),
  ribbon: (
    <Svg>
      <path d="M4 24 C14 24 16 8 26 12 C34 15 36 8 44 6 C36 11 34 20 26 17 C16 14 14 28 4 24 Z" className="text-mint-400" fill="currentColor" opacity="0.85" />
    </Svg>
  ),
  pixel: (
    <Svg>
      <g className="text-mint-400" fill="currentColor">
        <rect x="6" y="22" width="4" height="4" opacity="0.3" />
        <rect x="14" y="18" width="5" height="5" opacity="0.5" />
        <rect x="23" y="13" width="6" height="6" opacity="0.75" />
        <rect x="33" y="6" width="7" height="7" />
      </g>
    </Svg>
  ),
  ghost: (
    <Svg>
      <Arrow x={6} y={8} opacity={0.25} />
      <Arrow x={14} y={6} opacity={0.5} />
      <Arrow x={22} y={4} opacity={1} />
    </Svg>
  ),
  comet: (
    <Svg>
      <path d="M4 26 L34 12 L34 20 Z" className="text-mint-400" fill="currentColor" opacity="0.3" />
      <circle cx="36" cy="16" r="9" className="text-sky-400" fill="currentColor" opacity="0.25" />
      <circle cx="36" cy="16" r="5" className="text-mint-400" fill="currentColor" />
    </Svg>
  ),
};

function Tile({
  name,
  description,
  selected,
  onSelect,
  children,
}: {
  name: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${name}: ${description}`}
      title={description}
      className={`cpg-tile flex flex-col gap-1.5 rounded-xl p-1.5 text-left transition-colors ${selected ? selectedCls : idleCls}`}
    >
      <div className="flex h-16 w-full items-center justify-center rounded-lg bg-ink-900 ring-1 ring-white/5">{children}</div>
      <span className="truncate px-1 text-xs text-white">{name}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label-mono mb-2 uppercase tracking-widest">{label}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

// 커서 포인터·트레일 프리셋 갤러리
export default function CursorPresetGallery() {
  const { settings, update } = useAppearance();
  const trail = settings.cursorTrail;
  const pointer = settings.cursorPointer.style;
  return (
    <SettingsGroup icon={MousePointer2} title="프리셋">
      <style>{PREVIEW_CSS}</style>
      <Group label="포인터">
        {POINTER_PRESETS.map((p) => (
          <Tile
            key={p.id}
            name={p.name}
            description={p.description}
            selected={pointer === p.id}
            onSelect={() => update({ cursorPointer: { style: p.id } })}
          >
            {POINTER_PREVIEWS[p.id]}
          </Tile>
        ))}
      </Group>
      <Group label="트레일">
        <Tile
          name="없음"
          description="커서 트레일을 사용하지 않음"
          selected={!trail.enabled}
          onSelect={() => update({ cursorTrail: { ...trail, enabled: false } })}
        >
          <Svg>
            <g className="text-zinc-400" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6">
              <circle cx="24" cy="16" r="9" />
              <path d="M18 22 L30 10" />
            </g>
          </Svg>
        </Tile>
        {TRAIL_PRESETS.map((p) => (
          <Tile
            key={p.id}
            name={p.name}
            description={p.description}
            selected={trail.enabled && trail.style === p.id}
            onSelect={() => update({ cursorTrail: { ...trail, enabled: true, style: p.id } })}
          >
            {TRAIL_PREVIEWS[p.id]}
          </Tile>
        ))}
      </Group>
    </SettingsGroup>
  );
}
```

### 9.4 입체감 미리보기가 직접 기울어지는 이유

설정 모달은 `role="dialog"` 이므로 전역 `CardTilt` 가 모달 안 카드를 **의도적으로 제외**한다(§7.5). 그래서 미리보기 카드(`hero-grain flex h-24 items-end p-4`)가 `onPointerMove` 로 직접 `perspective(800px) rotateX(-py*2*tilt) rotateY(px*2*tilt) translateY(-lift)` 를 계산한다(스케일 k 없음, 효과가 꺼져 있으면 무시). 전환: 움직이는 동안 `transform 0.12s ease-out`, 벗어나면 `transform 0.35s cubic-bezier(0.22,1,0.36,1)`. 미리보기를 감싸는 `div` 는 `px-2 pb-2 pt-3`(기울 때 잘리지 않게 여백).
카드 그림자·모서리 빛은 `--fx-depth-hero` 가 `.hero-grain` 에 적용되므로 모달 안에서도 미리보기 히어로에는 보인다(히어로 변수는 `.fixed` 규칙이 리셋하지 않는다 — 리셋 대상은 `--fx-glow-card`, `--fx-depth-card` 뿐).

### 9.5 영속성: `{ settings, vars, attrs }`

- `localStorage` 키 **하나** (이식 시 앱 고유 이름으로 정한다. 문서 코드에서는 `app-appearance`). 값은 JSON:
  ```json
  { "settings": { …AppearanceSettings }, "vars": { "--c-white": "255 255 255", … }, "attrs": { "data-card": "glass", "data-theme-mode": "dark", "data-theme": "default" } }
  ```
- `vars`/`attrs` 를 함께 저장하는 이유: **첫 페인트 전에** 스크립트(`index.html` 의 인라인 스크립트 또는 `initAppearance()`)가 저장본을 읽어 `<html>` 에 바로 적용해 테마 깜빡임을 막을 수 있게 하기 위함. React 가 설정을 다시 계산하지 않아도 화면이 맞다.
- 읽기(`loadSettings`): JSON 파싱 실패/없음 → `DEFAULT_APPEARANCE`. `{...DEFAULT, ...saved}` 로 병합한 뒤, 사라진 선택지(카드 스타일·글꼴·글자 크기)는 기본값으로, 중첩 설정 4개는 `sanitize*` 로 **필드 단위** 검증/clamp.
- 쓰기(`applyToRoot`): 변수·속성 적용 → `localStorage.setItem` (예외는 삼킴: 사생활 모드 등에서도 화면 적용 유지).
- **`initAppearance()`** 는 `main.tsx` 에서 첫 렌더 전에 호출. (원본은 이 함수로 충분했고, `index.html` 에 별도 인라인 스크립트는 없다. 더 일찍 칠하고 싶으면 인라인 스크립트에서 `JSON.parse(localStorage[KEY]).vars/attrs` 를 `<html>` 에 적용하면 된다.)
- **리셋 동작**: 푸터 "기본값으로 되돌리기" = `reset()` → `DEFAULT_APPEARANCE` 전체(테마·카드 스타일·글꼴·크기·효과 4종). "효과 초기화" = 효과 4종만. 리셋 후에도 저장은 동일 경로(effect)로 이뤄진다.
- 변경 시 기타 부수효과: 테마가 바뀌면 `useEffect([settings.themeId])` 가 데스크톱 제목 표시줄 색을 갱신(§10), 커서 효과들은 테마 색을 다시 읽는다.

### 9.6 `AppearanceContext.tsx` 전체 소스

핵심 함수: `sanitize*`(검증/clamp), `cardDepthShadow`/`cardGlowLayer`(효과 → CSS), `computeRootStyle`(설정 → 변수/속성), `applyToRoot`, `initAppearance`, `AppearanceProvider`/`useAppearance`, `useThemeColors`(차트용 색).

> 제목 표시줄 호출은 §10.0 의 데스크톱 브리지 `desktop.setTitleBarColors()` 를 씁니다(`import { desktop } from '../platform/desktop'`). 웹·Wails·Tauri 를 실행 중에 감지하므로 셸이 바뀌어도 이 코드는 그대로이고, 웹에서는 아무 일도 하지 않습니다.

```tsx
// frontend/src/appearance/AppearanceContext.tsx
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState, CSSProperties } from 'react';
import { buildThemeVars, getTheme, hexToRgb, rgbToHex, DEFAULT_THEME_ID, AppTheme } from './themes';
import { desktop } from '../platform/desktop';
// 데스크톱 셸이 아니면 제목 표시줄 브리지(setTitleBarColors)와 아래 useEffect 를 삭제
import {
  DEFAULT_CARD_STYLE, DEFAULT_FONT_SIZE, DEFAULT_MONO, DEFAULT_SANS, FONT_SIZES, FontSizeId,
  MONO_FALLBACK, MONO_FONTS, SANS_FALLBACK, SANS_FONTS, CARD_STYLES, CURSOR_TRAIL_LIMITS,
  CARD_GLOW_LIMITS, CARD_DEPTH_LIMITS, POINTER_PRESETS, TRAIL_PRESETS, type PointerPresetId, type TrailPresetId,
} from './options';

// 커서를 따라다니는 점 체인 효과 (장식용, 기본 꺼짐)
export interface CursorTrailSettings {
  enabled: boolean;
  nodes: number; // 점 개수
  ease: number; // 앞 점을 따라가는 빠르기 (클수록 빠름)
  headSize: number; // 머리 점 지름(px)
  taper: number; // 꼬리로 갈수록 작아지는 정도 (0~1)
  gradient: boolean; // 체인을 따라 mint → sky 그라디언트
  style: TrailPresetId; // 트레일 프리셋 (수치 설정은 모든 프리셋이 공유)
}

export const DEFAULT_CURSOR_TRAIL: CursorTrailSettings = {
  enabled: false, nodes: 14, ease: 0.34, headSize: 24, taper: 0.8, gradient: false, style: 'dots',
};

// 마우스 포인터 자체를 바꾸는 프리셋 ('native' = 운영체제 커서)
export interface CursorPointerSettings {
  style: PointerPresetId;
}

export const DEFAULT_CURSOR_POINTER: CursorPointerSettings = { style: 'native' };

// 카드에 덧입히는 원형 광원 그라데이션 (기본 꺼짐 → 카드 스타일 본래 모양)
export interface CardGlowSettings {
  enabled: boolean;
  scope: 'hero' | 'all'; // 대표 카드(hero)만 / 모든 카드
  intensity: number; // 0~0.5
  size: number; // 광원 반경(%)
  x: number; // 광원 중심 가로(%)
  y: number; // 광원 중심 세로(%)
  gradient: boolean; // 강조색 → 하늘색 두 광원
}

export const DEFAULT_CARD_GLOW: CardGlowSettings = {
  enabled: false, scope: 'hero', intensity: 0.18, size: 65, x: 0, y: 0, gradient: false,
};

// 카드 입체감: 그림자 깊이·모서리 빛(베벨)·마우스 기울기·떠오름 (기본 꺼짐)
export interface CardDepthSettings {
  enabled: boolean;
  scope: 'hero' | 'all';
  depth: number; // 바깥 그림자 0~1
  bevel: number; // 위 모서리 빛 / 아래 모서리 그늘 0~1
  tilt: number; // 마우스를 올렸을 때 최대 기울기(도), 0 = 끔
  lift: number; // 마우스를 올렸을 때 떠오르는 높이(px)
}

export const DEFAULT_CARD_DEPTH: CardDepthSettings = {
  enabled: false, scope: 'all', depth: 0.5, bevel: 0.5, tilt: 5, lift: 3,
};

export interface AppearanceSettings {
  themeId: string;
  cardStyle: string;
  sansFont: string;
  monoFont: string;
  fontSize: FontSizeId;
  cursorTrail: CursorTrailSettings;
  cursorPointer: CursorPointerSettings;
  cardGlow: CardGlowSettings;
  cardDepth: CardDepthSettings;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeId: DEFAULT_THEME_ID,
  cardStyle: DEFAULT_CARD_STYLE,
  sansFont: DEFAULT_SANS,
  monoFont: DEFAULT_MONO,
  fontSize: DEFAULT_FONT_SIZE,
  cursorTrail: DEFAULT_CURSOR_TRAIL,
  cursorPointer: DEFAULT_CURSOR_POINTER,
  cardGlow: DEFAULT_CARD_GLOW,
  cardDepth: DEFAULT_CARD_DEPTH,
};

// index.html 의 첫 페인트 전 스크립트도 이 키를 읽는다 (깜빡임 방지)
const STORAGE_KEY = 'app-appearance';

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
    style: TRAIL_PRESETS.some((p) => p.id === r.style) ? (r.style as TrailPresetId) : d.style,
  };
}

function sanitizeCursorPointer(raw: unknown): CursorPointerSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    style: POINTER_PRESETS.some((p) => p.id === r.style) ? (r.style as PointerPresetId) : DEFAULT_CURSOR_POINTER.style,
  };
}

function sanitizeCardGlow(raw: unknown): CardGlowSettings {
  const d = DEFAULT_CARD_GLOW;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = CARD_GLOW_LIMITS;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    scope: r.scope === 'all' || r.scope === 'hero' ? r.scope : d.scope,
    intensity: clampNum(r.intensity, L.intensity, d.intensity),
    size: clampNum(r.size, L.size, d.size),
    x: clampNum(r.x, L.x, d.x),
    y: clampNum(r.y, L.y, d.y),
    gradient: typeof r.gradient === 'boolean' ? r.gradient : d.gradient,
  };
}

function sanitizeCardDepth(raw: unknown): CardDepthSettings {
  const d = DEFAULT_CARD_DEPTH;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = CARD_DEPTH_LIMITS;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    scope: r.scope === 'all' || r.scope === 'hero' ? r.scope : d.scope,
    depth: clampNum(r.depth, L.depth, d.depth),
    bevel: clampNum(r.bevel, L.bevel, d.bevel),
    tilt: clampNum(r.tilt, L.tilt, d.tilt),
    lift: clampNum(r.lift, L.lift, d.lift),
  };
}

// 카드 본래 그림자 앞에 덧붙일 입체 그림자 (.surface / .hero-grain 이 --fx-depth-* 를 읽는다)
function cardDepthShadow(c: CardDepthSettings) {
  const { depth: d, bevel: b } = c;
  const f = (v: number) => v.toFixed(2);
  const parts: string[] = [];
  if (d > 0) {
    parts.push(`0 ${f(1 + 2 * d)}px ${f(2 + 4 * d)}px rgb(var(--c-shadow) / ${f(0.3 * d)})`);
    parts.push(`0 ${f(8 + 20 * d)}px ${f(16 + 40 * d)}px -${f(6 + 8 * d)}px rgb(var(--c-shadow) / ${f(0.75 * d)})`);
  }
  if (b > 0) {
    // 위쪽은 밝게, 아래쪽은 어둡게 → 돌출된 느낌 (라이트 테마에서도 같은 흰 빛)
    parts.push(`inset 0 1px 0 rgb(255 255 255 / ${f(0.16 * b)})`);
    parts.push(`inset 0 -${f(1 + 2 * b)}px ${f(2 + 3 * b)}px rgb(var(--c-shadow) / ${f(0.4 * b)})`);
  }
  return parts.length ? parts.join(', ') : '0 0 #0000';
}

// 카드 배경 맨 위에 겹칠 광원 레이어 (.surface / .hero-grain 이 --fx-glow-* 를 읽는다)
function cardGlowLayer(g: CardGlowSettings) {
  const a = g.intensity.toFixed(3);
  const main = `radial-gradient(circle at ${g.x}% ${g.y}%, rgb(var(--c-mint-400) / ${a}) 0%, transparent ${g.size}%)`;
  if (!g.gradient) return main;
  // 두 번째 광원은 반대쪽 모서리에서 하늘색으로
  const sub = `radial-gradient(circle at ${100 - g.x}% ${100 - g.y}%, rgb(var(--c-sky-400) / ${(g.intensity * 0.8).toFixed(3)}) 0%, transparent ${g.size}%)`;
  return `${main}, ${sub}`;
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
    merged.cursorPointer = sanitizeCursorPointer(saved.cursorPointer);
    merged.cardGlow = sanitizeCardGlow(saved.cardGlow);
    merged.cardDepth = sanitizeCardDepth(saved.cardDepth);
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
  const glow = s.cardGlow?.enabled ? cardGlowLayer(s.cardGlow) : 'none';
  vars['--fx-glow-hero'] = glow;
  vars['--fx-glow-card'] = s.cardGlow?.enabled && s.cardGlow.scope === 'all' ? glow : 'none';
  const depth = s.cardDepth?.enabled ? cardDepthShadow(s.cardDepth) : '0 0 #0000';
  vars['--fx-depth-hero'] = depth;
  vars['--fx-depth-card'] = s.cardDepth?.enabled && s.cardDepth.scope === 'all' ? depth : '0 0 #0000';
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

  // 데스크톱 창 제목 표시줄을 앱 배경(ink-950)과 같은 색으로 맞춘다
  useEffect(() => {
    const theme = getTheme(settings.themeId);
    const css = getComputedStyle(document.documentElement);
    const triplet = (name: string) => css.getPropertyValue(name).trim().split(/\s+/).map(Number);
    const toHex = (v: number[], fallback: string) =>
      v.length === 3 && v.every(Number.isFinite) ? rgbToHex(v as [number, number, number]) : fallback;
    const bg = toHex(triplet('--c-ink-950'), theme.bg);
    const text = toHex(triplet('--c-zinc-300'), theme.fg);
    desktop.setTitleBarColors(bg, text, theme.mode === 'dark'); // §10.0 브리지 — 웹이면 아무것도 안 함
  }, [settings.themeId]);

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
  accent: string; // 강조 (차트 주 계열)
  accentSoft: string;
  restricted: string; // 보조 상태 계열 (앰버)
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
```

---

## 10. 데스크톱 통합 (선택) — 웹 · Wails · Tauri 공통

> 웹 전용 앱이면 이 장은 건너뛰어도 됩니다. 데스크톱 셸에서 **창 제목 표시줄을 앱 테마와 같은 색**으로 맞추고, 첫 화면의 흰색 번쩍임을 없애고, 앱 아이콘을 만드는 방법입니다.
> 디자인 코드(§3~§9)는 셸과 무관하게 **그대로** 씁니다. 셸마다 다른 것은 ① 프런트에서 네이티브를 부르는 방법, ② 네이티브 쪽 제목 표시줄 구현, ③ 창 초기 설정, ④ 아이콘 배치 네 가지뿐이고, ①은 아래 **데스크톱 브리지** 하나로 감춥니다.
>
> | 셸 | 웹뷰 | 네이티브 언어 | 이 문서 위치 |
> |----|------|---------------|--------------|
> | 웹(브라우저) | — | — | 브리지가 아무것도 하지 않음 |
> | Wails v2 | Windows: WebView2(Chromium) · macOS: WKWebView · Linux: WebKitGTK | Go | §10.2, §10.3 |
> | Tauri v2 | Windows: WebView2(Chromium) · macOS: WKWebView · Linux: WebKitGTK | Rust | §10.5 |
> | Electron | Chromium 내장 | Node | §10.2 의 DWM 값으로 `BrowserWindow` 의 `titleBarOverlay`/`backgroundColor` 를 설정 |

### 10.0 데스크톱 브리지 (`src/platform/desktop.ts`)

디자인 코드는 네이티브 기능을 **이 파일로만** 부릅니다. 셸을 바꿀 때 이 파일만 고치면 됩니다. 실행 환경은 런타임에 감지합니다(Wails 는 `window.go`, Tauri v2 는 `window.__TAURI_INTERNALS__` 를 주입).

```ts
// 데스크톱 브리지 — 디자인 코드는 네이티브 기능을 이 파일로만 부른다.
// 웹(아무것도 안 함) · Wails(window.go) · Tauri v2(window.__TAURI__ / __TAURI_INTERNALS__) 를 실행 중에 감지한다.

type Shell = 'web' | 'wails' | 'tauri';

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
interface DesktopGlobals {
  go?: { main?: { App?: { SetTitleBarColors?: (background: string, text: string, dark: boolean) => Promise<void> } } };
  __TAURI__?: { core?: { invoke?: TauriInvoke } }; // tauri.conf.json 의 app.withGlobalTauri: true 일 때
  __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
}

const g = () => window as unknown as DesktopGlobals;

export function detectShell(): Shell {
  const w = g();
  if (w.__TAURI__ || w.__TAURI_INTERNALS__) return 'tauri';
  if (w.go) return 'wails';
  return 'web';
}

function tauriInvoke(): TauriInvoke | undefined {
  const w = g();
  return w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke;
}

export const desktop = {
  /** 제목 표시줄 배경·글자색(#rrggbb)과 어두운 모드 여부. 지원하지 않는 환경이면 조용히 무시한다. */
  async setTitleBarColors(background: string, text: string, dark: boolean): Promise<void> {
    try {
      const shell = detectShell();
      if (shell === 'tauri') {
        await tauriInvoke()?.('set_title_bar_colors', { background, text, dark });
      } else if (shell === 'wails') {
        await g().go?.main?.App?.SetTitleBarColors?.(background, text, dark);
      }
    } catch {
      // 지원하지 않는 OS·버전이면 기본 제목 표시줄 그대로 둔다
    }
  },
};
```

- **의존성 없음**: Tauri 는 `@tauri-apps/api` 를 설치하지 않아도 `tauri.conf.json` 의 `app.withGlobalTauri: true` 로 노출되는 `window.__TAURI__.core.invoke` 를 쓴다(§10.5.4). 설정을 켜지 않았으면 내부 객체 `__TAURI_INTERNALS__.invoke` 로 대신 호출한다. `@tauri-apps/api` 를 이미 쓰는 프로젝트라면 `import { invoke } from '@tauri-apps/api/core'` 로 바꿔도 같다.
- **Wails** 는 바인딩한 Go 메서드를 `window.go.<패키지>.<구조체>.<메서드>` 로 노출한다(생성 바인딩 `wailsjs/go/main/App.js` 도 내부적으로 같은 경로를 부른다). 그래서 웹 빌드에서 바인딩 파일을 스텁으로 바꿔 끼울 필요가 없다.
- 웹 빌드에서는 두 전역이 모두 없으므로 아무 일도 하지 않는다.
- 이후 기능(예: 알림, 창 최소화)도 같은 객체에 메서드로 추가한다.

### 10.1 동기화할 색

| 용도 | 값 | 이유 |
|------|----|------|
| 제목 표시줄 배경 | `--c-ink-950` (= 앱 배경) | 창 상단과 본문이 끊김 없이 이어짐 |
| 제목 글자 | `--c-zinc-300` | 가독성 있는 보조 글자색 |
| 테두리 | 배경과 동일 | 창 외곽선이 튀지 않게 |
| 어두운 모드 플래그 | `theme.mode === 'dark'` | 최소화/최대화/닫기 버튼 색, Windows 10·macOS·Linux 폴백 |

프런트엔드 측(`AppearanceProvider` 안의 `useEffect`, 테마가 바뀔 때마다 실행):
```ts
import { desktop } from '../platform/desktop';

useEffect(() => {
  const theme = getTheme(settings.themeId);
  // CSS 변수 "R G B" → #hex → 네이티브 호출 (applyToRoot 가 먼저 실행된 뒤라 새 테마 값이 읽힌다)
  const css = getComputedStyle(document.documentElement);
  const triplet = (name: string) => css.getPropertyValue(name).trim().split(/\s+/).map(Number);
  const toHex = (v: number[], fallback: string) =>
    v.length === 3 && v.every(Number.isFinite) ? rgbToHex(v as [number, number, number]) : fallback;
  const bg = toHex(triplet('--c-ink-950'), theme.bg);
  const text = toHex(triplet('--c-zinc-300'), theme.fg);
  desktop.setTitleBarColors(bg, text, theme.mode === 'dark');
}, [settings.themeId]);
```

### 10.2 [Wails · Go] Windows 구현 (`titlebar_windows.go`)

- Windows 11(빌드 22000+)의 **DWM 캡션 색 API**: `DWMWA_CAPTION_COLOR(35)`, `DWMWA_TEXT_COLOR(36)`, `DWMWA_BORDER_COLOR(34)`.
- **Windows 10 폴백**: 캡션 색 지정은 실패하므로 `DWMWA_USE_IMMERSIVE_DARK_MODE(20)` 만 먼저 적용(어두운/밝은 제목 표시줄만 맞춤). 캡션 색 호출이 에러면 조용히 `nil` 반환.
- 순서: ① 어두운 모드 플래그 → ② 캡션 배경 → ③ 글자 → ④ 테두리. ①은 버튼 색이 배경에 맞도록 **먼저** 해야 한다.
- 색 형식: `COLORREF = 0x00BBGGRR` (hex `#RRGGBB` 에서 바이트 순서를 뒤집음).
- 창 핸들: 이 프로세스의 **보이는 최상위(소유자 없음) 창**을 `EnumWindows` 로 탐색.

```go
// titlebar_windows.go
//go:build windows

package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// 창 제목 표시줄 색을 앱 테마에 맞춘다 (Windows 11 의 DWM 캡션 색 API).
// Windows 10 에서는 캡션 색 지정이 안 되므로 어두운/밝은 제목 표시줄만 맞춘다.

const (
	dwmwaUseImmersiveDarkMode = 20
	dwmwaBorderColor          = 34
	dwmwaCaptionColor         = 35
	dwmwaTextColor            = 36
)

var (
	user32                       = windows.NewLazySystemDLL("user32.dll")
	dwmapi                       = windows.NewLazySystemDLL("dwmapi.dll")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
	procGetWindow                = user32.NewProc("GetWindow")
	procDwmSetWindowAttribute    = dwmapi.NewProc("DwmSetWindowAttribute")
)

const gwOwner = 4

// mainWindow 는 이 프로세스의 보이는 최상위 창(소유자 없음)을 찾는다.
func mainWindow() uintptr {
	pid := uint32(os.Getpid())
	var found uintptr
	cb := windows.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var wpid uint32
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&wpid)))
		if wpid != pid {
			return 1
		}
		if visible, _, _ := procIsWindowVisible.Call(hwnd); visible == 0 {
			return 1
		}
		if owner, _, _ := procGetWindow.Call(hwnd, gwOwner); owner != 0 {
			return 1
		}
		found = hwnd
		return 0 // 찾았으면 중단
	})
	procEnumWindows.Call(cb, 0)
	return found
}

// "#RRGGBB" → COLORREF (0x00BBGGRR)
func colorRef(hex string) (uint32, error) {
	h := strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(h) != 6 {
		return 0, fmt.Errorf("invalid color %q", hex)
	}
	v, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid color %q", hex)
	}
	r, g, b := uint32(v>>16)&0xff, uint32(v>>8)&0xff, uint32(v)&0xff
	return b<<16 | g<<8 | r, nil
}

func setDwmAttr(hwnd uintptr, attr uint32, value uint32) error {
	if err := procDwmSetWindowAttribute.Find(); err != nil {
		return err
	}
	hr, _, _ := procDwmSetWindowAttribute.Call(hwnd, uintptr(attr), uintptr(unsafe.Pointer(&value)), unsafe.Sizeof(value))
	if hr != 0 {
		return fmt.Errorf("DwmSetWindowAttribute(%d) failed: 0x%x", attr, hr)
	}
	return nil
}

// SetTitleBarColors 는 제목 표시줄 배경·글자·테두리 색과 어두운 모드 여부를 설정한다 (프론트엔드가 테마 변경 시 호출).
func (a *App) SetTitleBarColors(background, text string, dark bool) error {
	hwnd := mainWindow()
	if hwnd == 0 {
		return fmt.Errorf("main window not found")
	}
	darkFlag := uint32(0)
	if dark {
		darkFlag = 1
	}
	// 최소화/최대화/닫기 버튼 색이 배경에 맞도록 먼저 어두운 모드를 맞춘다 (Windows 10 은 여기까지만 적용)
	_ = setDwmAttr(hwnd, dwmwaUseImmersiveDarkMode, darkFlag)

	bg, err := colorRef(background)
	if err != nil {
		return err
	}
	fg, err := colorRef(text)
	if err != nil {
		return err
	}
	// Windows 11 22000 미만에서는 실패한다 → 어두운 모드만 적용된 상태로 둔다
	if err := setDwmAttr(hwnd, dwmwaCaptionColor, bg); err != nil {
		return nil
	}
	_ = setDwmAttr(hwnd, dwmwaTextColor, fg)
	_ = setDwmAttr(hwnd, dwmwaBorderColor, bg)
	return nil
}
```

다른 OS 는 no-op:

```go
// titlebar_other.go
//go:build !windows

package main

// SetTitleBarColors 는 Windows 에서만 동작한다 (다른 OS 에서는 아무것도 하지 않음).
func (a *App) SetTitleBarColors(background, text string, dark bool) error {
	return nil
}
```

### 10.3 [Wails · Go] 초기 다크 테마 · 배경색 (깜빡임 방지)

창이 만들어지는 순간(웹뷰가 렌더되기 전)의 색을 기본 테마와 맞춘다. 기본 테마 배경 `#060607` = RGB `(6, 6, 7)`.

```go
err := wails.Run(&options.App{
    Title:  "App Name",
    Width:  1280,
    Height: 1360,
    AssetServer: &assetserver.Options{Assets: assets},
    // 기본 테마 배경색 — 첫 화면이 그려지기 전 깜빡임을 줄인다 (이후 프론트엔드가 테마에 맞게 제목 표시줄 색을 바꾼다)
    BackgroundColour: &options.RGBA{R: 6, G: 6, B: 7, A: 1},
    Windows: &windows.Options{
        Theme: windows.Dark,   // 시작은 다크 제목 표시줄
    },
    OnStartup: app.startup,
    Bind: []interface{}{ app },   // app 의 SetTitleBarColors(background, text string, dark bool) error 가 프런트에 노출됨
})
```
- 프런트는 §10.0 브리지(`desktop.setTitleBarColors`)가 `window.go.main.App.SetTitleBarColors` 로 호출한다. 생성 바인딩(`wailsjs/go/main/App`)을 직접 import 해도 같다.
- 라이트 테마로 시작하는 사용자는 첫 화면에서 잠깐 다크 제목 표시줄이 보일 수 있다 — 저장된 테마를 읽어 `BackgroundColour` 를 정하는 방법도 있지만 원본은 기본 테마 고정 + 이후 동기화로 단순화했다.

### 10.4 앱 아이콘 · 파비콘 가이드

실제로 적용해 검증한 절차다 (원본: 2048px 정사각 PNG, 어두운 여백 위에 흰 테두리의 둥근 사각 배지 + 마크 + 워드마크 + 태그라인).

- **배지 크롭**: 원본에서 배지의 흰 테두리 바깥 경계를 픽셀 스캔으로 찾는다(가운데 행·열에서 밝은 픽셀(R,G,B > 200)이 처음/마지막으로 나오는 좌표, 모서리 반경은 윗변 바로 아래 줄에서 테두리가 처음 나오는 x − 왼쪽 경계). 경계에서 4px 바깥까지 잘라 정사각 캔버스 가운데에 **97% 크기**로 놓고, 같은 반경의 `roundRect` 로 clip 해서 **모서리 바깥을 투명**하게 만든다. 원본 여백에 있던 워터마크·장식도 이때 함께 빠진다.
- **작은 크기(≤48px)는 핵심 도형만**: 워드마크·태그라인은 48px 이하에서 읽히지 않고 마크만 작아진다. 배지 안쪽에서 **마크(도형)만 포함하는 정사각 영역**을 잘라(글자 윗변보다 위에서 끝나게) 꽉 차게 그리고, 둥근 모서리 clip + **얇은 흰 테두리**(`rgba(255,255,255,0.55)`, 두께 `max(1, size/32)`)를 그려 작은 크기에서도 윤곽이 보이게 한다.
- **멀티사이즈 ICO(Windows)**: 9개 크기를 PNG 엔트리로 담는다 — **16·20·24·32·40·48 = 핵심 도형 버전**, **64·128·256 = 배지 전체**. ICO 형식: 헤더 6바이트(reserved 0, type 1, count) + 엔트리당 16바이트(width/height 는 256 이면 0, planes 1, bpp 32, 데이터 크기, 오프셋) + PNG 바이트들. Windows Vista 이후는 모든 크기의 PNG 엔트리를 지원한다.
- **배치(Wails)**: `build/appicon.png` = 배지 전체 1024px(저장소에 커밋). `build/windows/icon.ico` = 위의 멀티사이즈 ICO. 이 폴더는 보통 git 에서 제외되고, ICO 가 없으면 Wails 가 `appicon.png` 를 그대로 줄여 ICO 를 만든다(작은 크기에도 글자가 들어감) → 직접 만든 ICO 를 두는 편이 낫다. 빌드한 exe 에서 아이콘을 꺼내(`System.Drawing.Icon.ExtractAssociatedIcon`) 적용 여부를 확인할 수 있다.
- **웹 파비콘**: `frontend/public/favicon.png`(배지 전체 256px) + `index.html`:
  ```html
  <link rel="icon" type="image/png" href="/favicon.png" />
  ```
- 아이콘 색은 기본 테마(다크 + 민트) 기준으로 고정한다 — 아이콘은 테마를 따라 바뀌지 않는다.

### 10.5 [Tauri v2 · Rust] 제목 표시줄 · 창 설정 · CSP · 아이콘

Tauri 도 Windows 에서는 WebView2(Chromium)를 쓰므로 **화면은 Wails 와 픽셀 단위로 같습니다.** 아래만 Rust/설정으로 옮기면 됩니다. 프런트 호출은 §10.0 브리지가 `invoke('set_title_bar_colors', …)` 로 처리합니다.

#### 10.5.1 의존성 (`src-tauri/Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = [] }
raw-window-handle = "0.6"   # Tauri 버전과 무관하게 HWND 를 얻기 위해

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = ["Win32_Foundation", "Win32_Graphics_Dwm"] }
```
프런트는 추가 패키지가 필요 없다(§10.0 브리지가 전역 `window.__TAURI__` 사용). 다른 Tauri API 를 쓸 계획이면 `npm i @tauri-apps/api`.

#### 10.5.2 제목 표시줄 명령 (`src-tauri/src/titlebar.rs`)

- **Windows 11**: Wails 버전(§10.2)과 같은 DWM 속성(34 테두리 / 35 캡션 / 36 글자 / 20 어두운 모드). 창 핸들은 `raw-window-handle` 로 바로 얻으므로 프로세스 창을 열거할 필요가 없다.
- **Windows 10**: 캡션 색 지정이 실패하면 어두운/밝은 제목 표시줄만 맞춘 채 둔다(오류로 취급하지 않음).
- **macOS**: 창 설정 `titleBarStyle: "Transparent"`(§10.5.4) + 창 배경색을 테마 배경으로 바꾸면 제목 표시줄이 같은 색으로 보인다.
- **Linux**: 제목 표시줄은 창 관리자가 그리므로 어두운/밝은 테마 선호만 전달한다.

```rust
// src-tauri/src/titlebar.rs — 창 제목 표시줄을 앱 테마 색에 맞춘다
use tauri::WebviewWindow;

fn parse_hex(hex: &str) -> Result<(u8, u8, u8), String> {
    let h = hex.trim().trim_start_matches('#');
    if h.len() != 6 {
        return Err(format!("invalid color {hex}"));
    }
    let v = u32::from_str_radix(h, 16).map_err(|_| format!("invalid color {hex}"))?;
    Ok(((v >> 16) as u8, (v >> 8) as u8, v as u8))
}

#[tauri::command]
pub fn set_title_bar_colors(window: WebviewWindow, background: String, text: String, dark: bool) -> Result<(), String> {
    let bg = parse_hex(&background)?;
    let fg = parse_hex(&text)?;
    // 모든 OS: 어두운/밝은 창 테마 (Windows 10·Linux 는 여기까지만 적용된다)
    let _ = window.set_theme(Some(if dark { tauri::Theme::Dark } else { tauri::Theme::Light }));

    #[cfg(target_os = "windows")]
    windows_caption(&window, bg, fg, dark)?;

    #[cfg(target_os = "macos")]
    {
        // titleBarStyle: "Transparent" 이면 제목 표시줄에 창 배경색이 비친다
        let _ = window.set_background_color(Some(tauri::window::Color(bg.0, bg.1, bg.2, 255)));
        let _ = fg;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = (bg, fg);

    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_caption(window: &WebviewWindow, bg: (u8, u8, u8), fg: (u8, u8, u8), dark: bool) -> Result<(), String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWINDOWATTRIBUTE, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR,
        DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
    };

    let handle = window.window_handle().map_err(|e| e.to_string())?;
    let RawWindowHandle::Win32(h) = handle.as_raw() else {
        return Err("not a Win32 window".into());
    };
    let hwnd = HWND(h.hwnd.get() as _);
    // COLORREF = 0x00BBGGRR
    let colorref = |(r, g, b): (u8, u8, u8)| (b as u32) << 16 | (g as u32) << 8 | r as u32;
    let set = |attr: DWMWINDOWATTRIBUTE, value: u32| unsafe {
        DwmSetWindowAttribute(hwnd, attr, &value as *const u32 as *const _, std::mem::size_of::<u32>() as u32)
    };

    // 최소화/최대화/닫기 버튼 색이 배경에 맞도록 먼저 어두운 모드를 맞춘다
    let _ = set(DWMWA_USE_IMMERSIVE_DARK_MODE, dark as u32);
    // Windows 11 22000 미만에서는 실패한다 → 어두운 모드만 적용된 상태로 둔다
    if set(DWMWA_CAPTION_COLOR, colorref(bg)).is_err() {
        return Ok(());
    }
    let _ = set(DWMWA_TEXT_COLOR, colorref(fg));
    let _ = set(DWMWA_BORDER_COLOR, colorref(bg));
    Ok(())
}
```

등록 (`src-tauri/src/lib.rs` — v2 기본 템플릿 기준):
```rust
mod titlebar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![titlebar::set_title_bar_colors])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
- 앱이 직접 정의한 명령은 기본적으로 모든 창에서 호출할 수 있어 **추가 권한(capability)이 필요 없다.** 대신 JS 에서 `getCurrentWindow().setTheme()` 같은 내장 API 를 직접 부르는 방식을 쓰면 `capabilities/default.json` 에 `core:window:allow-set-theme` 등을 추가해야 한다.
- 인자 이름은 Rust 의 `snake_case` 와 JS 의 `camelCase` 가 자동 변환된다. 여기서는 한 단어(`background`, `text`, `dark`)라 그대로 같다.
- `set_background_color` 와 창 설정의 `backgroundColor` 는 Tauri 2.1 이상에서 제공된다. 더 낮은 버전이면 macOS 분기와 해당 설정을 빼고 `set_theme` 만 쓴다.
- `windows` crate 버전에 따라 `HWND` 의 안쪽 타입이 `isize`(0.52 이하) 또는 `*mut c_void`(0.58)로 다르다. `h.hwnd.get() as _` 는 두 경우 모두 컴파일된다.

#### 10.5.3 첫 화면 깜빡임 방지

Wails §10.3 과 같은 목적입니다. 프런트가 테마를 적용하기 전 흰 창이 잠깐 보이지 않도록, 창을 **기본 테마 배경색 + 어두운 테마**로 띄웁니다(§10.5.4 의 `theme`·`backgroundColor`). 이후 §10.1 의 `useEffect` 가 저장된 실제 테마로 바꿉니다.

#### 10.5.4 창 설정 (`src-tauri/tauri.conf.json`)

```json
{
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "Product Name",
        "width": 1280,
        "height": 900,
        "minWidth": 380,
        "theme": "Dark",
        "backgroundColor": "#060607",
        "titleBarStyle": "Transparent"
      }
    ],
    "security": {
      "csp": {
        "default-src": "'self'",
        "script-src": "'self'",
        "style-src": "'self' 'unsafe-inline'",
        "img-src": "'self' data: blob: asset: http://asset.localhost",
        "font-src": "'self' data:",
        "connect-src": "'self' ipc: http://ipc.localhost"
      }
    }
  }
}
```
- `withGlobalTauri: true`: §10.0 브리지가 별도 패키지 없이 `window.__TAURI__.core.invoke` 를 쓰게 한다.
- `theme: "Dark"` + `backgroundColor`(= 기본 테마 `ink-950`): 첫 화면 깜빡임 방지. 사용자가 라이트 테마를 저장해 뒀다면 시작 직후 잠깐 어두웠다가 바뀐다(Wails 와 같은 단순화).
- `titleBarStyle: "Transparent"`: macOS 전용, 다른 OS 에서는 무시된다.
- **CSP 가 이 디자인에서 요구하는 것**
  - `style-src 'unsafe-inline'`: 커서 포인터 효과가 `<style>` 요소를 넣어 기본 커서를 숨기고(§8), 개발 모드의 Vite 도 `<style>` 을 주입한다. React 의 `style={{…}}` 와 JS 의 `el.style.x = …` 는 CSSOM 이라 CSP 에 막히지 않는다.
  - `img-src data:`: 히어로 카드의 그레인 질감이 CSS 안의 `data:image/svg+xml` 이다(§6).
  - `font-src 'self'`: 글꼴은 전부 npm 패키지(`pretendard`, `@fontsource/*`)로 번들되므로 외부 글꼴 도메인을 열 필요가 없다. **CDN 글꼴(`fonts.googleapis.com` 등)로 바꾸지 말 것** — 오프라인·CSP 양쪽에서 깨진다.
  - `connect-src`: 앱이 부르는 외부 API 출처를 여기에 추가한다.

#### 10.5.5 (선택) 직접 그린 제목 표시줄

창 틀까지 완전히 테마로 그리고 싶다면 `"decorations": false` 로 기본 창 틀을 없애고 헤더를 제목 표시줄로 씁니다.
- 헤더 바탕 요소에 `data-tauri-drag-region` 속성 → 끌어서 창 이동, 더블클릭으로 최대화.
- 최소화/최대화/닫기 버튼을 `btn-icon` 으로 만들고 `getCurrentWindow().minimize() / toggleMaximize() / close()` 호출. 권한: `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close`, `core:window:allow-start-dragging`.
- macOS 는 `"titleBarStyle": "Overlay"` + `"hiddenTitle": true` 로 신호등 버튼만 남기고 헤더가 그 자리까지 올라가게 할 수 있다 → 헤더 왼쪽에 약 **80px** 여백을 둔다(신호등 버튼 자리).
- 단점: Windows 11 의 최대화 버튼 위 **스냅 레이아웃 팝업**과 창 가장자리 그림자·크기 조절 감각이 기본 창보다 떨어진다. 그래서 이 문서는 **기본 창 틀 + 색 맞추기(§10.5.2)** 를 기본안으로 한다.

#### 10.5.6 앱 아이콘

```bash
npm run tauri icon ./app-icon-1024.png   # src-tauri/icons/ 에 png·ico·icns 를 모두 생성
```
- 입력은 §10.4 의 **배지 전체 1024px PNG**(모서리 바깥 투명).
- 생성기는 모든 크기를 같은 이미지에서 줄이므로 작은 크기에 글자가 뭉개진다 → 생성 후 `src-tauri/icons/icon.ico` 를 §10.4 의 **9개 크기 ICO**(16–48 핵심 도형 / 64–256 배지 전체)로 덮어쓰고, `32x32.png` 도 핵심 도형 버전으로 바꾼다. macOS `icon.icns` 는 큰 크기 위주라 그대로 둬도 된다.
- `tauri.conf.json` 의 `bundle.icon` 목록이 위 파일들을 가리키는지 확인한다(기본 템플릿 그대로면 맞다).

### 10.6 웹뷰 호환성 (WebView2 · macOS WebKit · Linux WebKitGTK)

Wails·Tauri 모두 macOS·Linux 에서는 **WebKit** 으로 그립니다. 이 디자인이 쓰는 최신 기능과, 지원하지 않을 때의 동작입니다. **표의 대체 동작은 모두 코드에 이미 반영돼 있어, 별도 작업 없이 "덜 화려하게" 보일 뿐 깨지지 않습니다.**

| 기능 | 쓰는 곳 | WebView2 (Chromium) | macOS WebKit | Linux WebKitGTK | 지원 안 될 때 |
|------|---------|---------------------|--------------|-----------------|----------------|
| `@property` (각도 애니메이션) | 탭 보더 빔 회전 | 지원 | Safari 16.4+ | 2.40+ 권장 | 기본값 `--beam-angle: 0deg` 를 둬서 **회전 없는 정지된 빛**으로 보임. 기본값이 없으면 반 주기마다 깜빡이므로 반드시 둘 것 |
| `mask` + `mask-composite: exclude` | 보더 빔 테두리만 남기기 | 지원 | `-webkit-mask-composite: xor` 로 지원 (둘 다 선언) | 같음 | — |
| `conic-gradient` | 보더 빔 | 지원 | 12.1+ | 지원 | — |
| `backdrop-filter` | 알약·헤더 흐림 | 지원 | `-webkit-backdrop-filter` 필요 (둘 다 선언) | 지원하나 소프트웨어 렌더링이면 느릴 수 있음 | 흐림 없이 반투명 바탕. 느리면 `--pill-blur: none` 으로 끈다 |
| `color-mix()` | 링 게이지 발광, 커서 링 채움 등 **장식만** | 지원 | 16.2+ | 2.40+ | 해당 선언만 무시돼 발광·채움이 빠짐 |
| `scrollbar-width` | 스크롤바 숨김 | 지원 | 미지원 | 미지원 | `::-webkit-scrollbar { display: none }` 도 함께 선언 |
| `position: sticky` | 헤더, 스택 카드 | 지원 | 지원 | 지원 | — |
| Canvas 2D, Pointer Events, `matchMedia` | 커서 효과, 움직임 줄이기 감지 | 지원 | 지원 | 지원 | — |
| SVG `url(#id)` 그라데이션 | 브랜드 마크 | 지원 | `:` 가 든 id 를 못 읽는 버전이 있음 | 같음 | React `useId()` 결과에서 `:` 를 빼서 사용 (`brand-${useId().replace(/:/g,'')}`) |

Linux 추가 메모:
- 일부 GPU 드라이버(특히 NVIDIA)에서 WebKitGTK 창이 비어 보이면 실행 환경 변수 `WEBKIT_DISABLE_DMABUF_RENDERER=1` 을 준다(Tauri 문서의 알려진 문제).
- 흐림·커서 트레일이 버벅이면 모양 설정에서 효과를 끄면 된다. 효과는 기본값이 모두 꺼짐이라 기본 상태에서는 부담이 없다.


---

## 11. 차트 스타일 가이드 (Recharts)

### 11.1 색은 항상 `useThemeColors()` 에서

SVG 속성/인라인 스타일에서는 CSS 클래스를 못 쓰므로, 현재 테마를 JS 로 읽는 훅을 사용한다 (§9.6 소스 하단). 반환값:

| 키 | 값 | 용도 |
|----|----|------|
| `mode` | `'dark' \| 'light'` | 분기 |
| `accent` | `mint-400` | 주 계열(메인 선) |
| `accentSoft` | `mint-300` | |
| `restricted` | `amber-400` | 보조 상태 계열(경고/제한 성격) |
| `positive` / `negative` | `mint-400` / `rose-400` | 증감 |
| `text` | `--c-white` | 최대 대비 글자, 추정 영역 채움 |
| `muted` | `zinc-400` | 범례 글자 |
| `axis` | `zinc-500` | 축 눈금 글자 |
| `grid` | `ink-600` | 격자·축선 |
| `surface` | `--c-surface` | |
| `palette` | 범주형 색 배열 | 두 번째 이후 계열·파이 |
| `tooltip` | `{contentStyle, labelStyle, itemStyle}` | 툴팁 |

`palette` 순서: `mint-400, sky-400, amber-400, rose-400, orange-400, emerald-400, mint-200, sky-200, amber-200, rose-200, zinc-400` 를 앞에서부터 고르되 **이미 고른 색과 RGB 유클리드 거리 70 미만이면 건너뜀** (`distinctColors`). 강조색이 상태색과 겹치는 테마에서도 구분 가능한 팔레트가 나온다. 사용: 주 계열 `tc.accent`, 두 번째 `tc.palette[1]`, 세 번째 `tc.palette[2] ?? tc.axis`.

툴팁 기본값:
```ts
const border = theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
tooltip: {
  contentStyle: { background: c('ink-850'), border: `1px solid ${border}`, borderRadius: 12, fontSize: 12, color: c('zinc-100') },
  labelStyle: { color: c('zinc-300') },
  itemStyle: { color: c('zinc-100') },
}
```
커스텀 툴팁은 `<div style={{ ...tc.tooltip.contentStyle, padding: '10px 12px' }}>` + 라벨 `marginBottom: 4`, 계열별 줄을 해당 계열 색으로, 합계 줄은 `tc.text` + `marginTop: 2`.

### 11.2 컨테이너 · 축 · 격자

```tsx
const axisTick = { fontSize: 11, fill: tc.axis, fontFamily: 'JetBrains Mono, monospace' };  // 원본은 JetBrains Mono 고정; var(--font-mono) 를 쓰면 설정 글꼴을 따른다

<div className="h-64">{/* 큰 차트 팝업은 h-80 */}
  <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
      <CartesianGrid stroke={tc.grid} strokeOpacity={0.4} vertical={false} />   {/* 가로선만 */}
      <XAxis dataKey="label" tick={axisTick} minTickGap={30 /* 팝업: 36 */} axisLine={{ stroke: tc.grid }} tickLine={false} />
      <YAxis tick={axisTick} domain={[0, 'auto']} width={55} axisLine={false} tickLine={false} tickFormatter={compact} />
      <Tooltip … />
      <Legend wrapperStyle={{ fontSize: 11, color: tc.muted }} iconType="circle" iconSize={8} />
      …
    </AreaChart>
  </ResponsiveContainer>
</div>
```
- 차트 컨테이너는 카드(`surface p-5 sm:p-6`) 안에 두고, 위에는 섹션 헤더(§6.13), 메트릭 타일(§6.11), 칩 줄(메모).
- 축: 글자 11px mono, X 축선은 `tc.grid`, Y 축선 없음, 눈금선(`tickLine`) 없음. Y 폭 55.
- 격자: 가로선만(`vertical={false}`), `strokeOpacity 0.4`.

### 11.3 영역(Area)·선(Line) 규격

| 요소 | 규격 |
|------|------|
| 주 영역(Area) | `type="monotone"`, `stroke` 색, `strokeWidth={1.75}`, `dot={false}`, `isAnimationActive={false}`(팝업) |
| 영역 채움 | `linearGradient` 세로(`x1=0 y1=0 x2=0 y2=1`): `0%` 색 `stopOpacity 0.32` → `100%` `stopOpacity 0` (보조 계열은 0.28 등 근사). **id 는 차트마다 고유 접두사** (`prefix-total` 등) |
| 보조 기준선(Line) | `strokeWidth={1.5}`, `strokeDasharray="5 4"` (점선) |
| 쌓은 영역 | 두 Area 에 같은 `stackId` |
| 범례 | `iconType="circle" iconSize={8}`, 글자 11px `tc.muted`, 한 계열뿐이면 생략 |

### 11.4 추정(estimated) vs 실제(real) 표현

- **추정 구간 선**: 같은 색, `strokeOpacity={0.55}`, `strokeDasharray="4 3"`, `strokeWidth={1.5}`, 채움 그라데이션 알파 **0.14**(실제 0.32 의 절반 이하), `legendType="none"`(범례에서 숨김).
- **실제 구간 선**: 실선 1.75, 채움 0.32.
- 두 구간이 이어 보이도록 **경계 점을 양쪽 데이터에 모두 넣는다**(`total_real` 과 `total_est` 가 경계 한 점을 공유, 나머지는 `null`) + `connectNulls={false}`.
- **음영 영역**: 연속된 추정 구간마다 `ReferenceArea`:
  ```tsx
  <ReferenceArea x1={r.x1} x2={r.x2} fill={tc.text} fillOpacity={0.04 /* 팝업 0.05 */} stroke="none"
                 ifOverflow="extendDomain"
                 label={{ value: '추정', position: 'insideTop', fill: tc.axis, fontSize: 10 }} />
  ```
  연속 구간 계산: 데이터를 순회하며 `estimated` 가 true 인 시작/끝 라벨을 모아 `{x1, x2}[]` 로.
- **툴팁**: 추정 점은 라벨 뒤에 ` (추정)` 표기.
- **표**: 추정 행 라벨 옆에 `ml-1.5 chip !px-1.5 !py-0 !text-[10px]` "추정" 칩.
- **각주**: 추정이 있으면 차트 아래 `mt-2 label-mono !text-zinc-500 normal-case` 로 한 줄 설명.

### 11.5 컴팩트 숫자 포맷터 (축용)

한국어 단위 예시(원본). 다른 로케일은 같은 구조로 단위만 교체(`K/M/B` 등).

```ts
const compact = (v: number) => {
  if (v >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
  if (v >= 10000) return `${Math.round(v / 10000).toLocaleString()}만`;
  return `${Math.round(v).toLocaleString('ko-KR')}`;
};
```
- 값 표시(툴팁/타일)는 풀 포맷(`Math.round(v).toLocaleString('ko-KR')`), 축 눈금은 compact. 증감 표기는 `signed = (v) => ${v >= 0 ? '+' : '-'}${fmt(Math.abs(v))}`, 퍼센트 `signedPct = ${v>=0?'+':'-'}${Math.abs(v).toFixed(1)}%`.
- 날짜 눈금: 장기 범위(1y 이상)는 `YY.MM`, 단기는 `M/D`. 월 라벨은 `key.slice(2).replace('-', '.')` → `YY.MM`.

### 11.6 Y 도메인 맞춤 규칙

기본은 `domain={[0, 'auto']}`(0 기준 — 쌓은 영역 차트 등). 선형 추이처럼 **변화가 납작해 보이면** 값이 있는 구간에 맞춘다:

```ts
const yDomain = useMemo<[number, number] | [number, 'auto']>(() => {
  if (stackedView || points.length === 0) return [0, 'auto'];      // 쌓은 영역은 0 기준 유지
  const vals = points.flatMap((p) => [p.a, p.b]).filter((v) => v > 0);
  if (vals.length === 0) return [0, 'auto'];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.12, hi * 0.01);               // 위아래 12% (최소 1%) 여백
  // 눈금이 깔끔하도록 자릿수에 맞춰 내림/올림
  const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(hi - lo + pad * 2, 1))) - 1));
  return [Math.max(0, Math.floor((lo - pad) / step) * step), Math.ceil((hi + pad) / step) * step];
}, [points, view]);
// <YAxis domain={yDomain} allowDataOverflow … />
```
- 0 이하 값은 도메인 계산에서 제외, 하한은 0 미만으로 내려가지 않게 `Math.max(0, …)`.
- `allowDataOverflow` 로 계산된 도메인을 강제.

### 11.7 차트 체크리스트

1. 색은 전부 `useThemeColors()`; 하드코딩 hex 금지. 2. 그라데이션 `<defs>` id 충돌 방지. 3. 애니메이션이 필요 없는 팝업 차트는 `isAnimationActive={false}`. 4. 로딩은 스켈레톤(§6.15), 빈 데이터는 중앙 문구. 5. 모든 숫자는 mono/tabular. 6. 라이트 테마에서 `tc.text` 오버레이(`fill={tc.text}`)가 어두운 알파가 되는 것을 확인.

---

## 12. 함정 & 교훈 (디자인 관련만)

1. **모달은 반드시 Portal.** 카드의 `backdrop-filter`, `transform`, `filter`, `perspective`, `will-change: transform` 중 하나라도 있으면 그 요소가 `position: fixed` 자손의 **containing block** 이 된다. 카드 안에서 렌더한 모달은 화면이 아니라 카드 기준으로 배치되어 중앙에서 어긋나고 잘린다. 글라스 카드/스택 카드/틸트 카드가 모두 해당. → `createPortal(…, document.body)`.
2. **효과 변수는 `.fixed, [role='dialog']` 에서 리셋.** `--fx-glow-card: none; --fx-depth-card: 0 0 #0000;` 안 하면 카드 광원/입체감이 모달·드롭다운·토스트에까지 번진다. (`--fx-*-hero` 는 일부러 리셋하지 않는다 — 설정 미리보기 히어로가 보여야 하므로.) JS 틸트도 같은 영역을 제외한다.
3. **`box-shadow` 리스트에 `none` 불가.** 효과 그림자를 `var(--fx-depth-card), var(--card-shadow)` 로 이어붙이는 구조라 어느 한 쪽이 `none` 이면 선언 전체가 무효. "없음"은 `0 0 #0000`. (그림자를 앞에 덧붙이지 않는 변수는 `none` 가능.)
4. **오래 켜 둔 dev 서버(Vite)는 `tailwind.config.js` 변경을 못 따라간다.** 색 매핑·테마 색이 이상해 보이면 버그로 단정하기 전에 dev 서버를 **재시작**(고아 Vite 프로세스도 종료). 데스크톱 셸의 dev 모드에서도 동일.
5. **라이트 테마에서 `white` 의 의미.** `text-white`/`bg-white/10`/`border-white/10` 은 "최대 대비색(라이트에서는 어두운 색)" 이다. 라이트 테마에서도 **항상 흰 면**이 필요하면 `bg-paper` 를, 항상 검은 면이 필요하면 `#000` 직접(드묾). `bg-black/60` 모달 막은 라이트에서 **흰 막**이 되는 것이 의도.
6. **`--c-black` 도 반전.** 다크 `#000`, 라이트 `#fff`. 배지(`.badge-new` = `bg-black text-white`)는 라이트에서 "흰 바탕 + 어두운 글자"로 자연스럽게 반전된다.
7. **상태색 충돌.** 강조색이 주황/노랑 계열이면 amber/orange(경고·제한 표시)와 구분이 안 된다 → 테마의 `status` 로 amber·orange 를 다른 색상환 위치로 옮긴다(§3.3). 새 테마 추가 시 반드시 강조색과 상태색 5종을 눈으로 대조.
8. **라이트 테마의 상태색**은 `mix(raw, fg, 0.38)` 로 어둡게 보정되어야 글자로 읽힌다.
9. **neumorph 는 라이트에서 별도 보정.** 하이라이트 흰 95%, 그림자 `shadow/0.32` (`[data-theme-mode='light']` 블록).
10. **`@property` 없이 `--beam-angle` 을 애니메이션하면 끊겨 보인다.** 등록(`syntax:'<angle>'`)이 필수. 그리고 reduced-motion 에서 `infinite` 애니메이션은 반드시 `animation:none`(§7.9).
11. **카드 스타일 변수 누락 = 상속 오염.** 새 스타일이 변수 하나를 빼면 상위(기본 glass) 값이 새어 들어와 섞인다. 모든 변수 정의.
12. **`select` 옵션 배경.** 네이티브 드롭다운은 OS 스타일이라 다크/라이트가 어긋나기 쉽다 → `select.input-field option { background: ink-800; color: zinc-100 }` 와 `color-scheme` 인라인 설정.
13. **스크롤바도 테마 변수로.** `scrollbar-color`(Firefox) + `::-webkit-scrollbar*`(Chromium) 를 `ink-500/600/900` 으로. 트랙 `ink-900`, 썸 `ink-600`(hover `ink-500`), 썸에 트랙색 2px 테두리로 둥글게 보이게.
14. **오로라는 헤더/배경이 달라야 한다.** `--header-bg` 로 헤더를 더 투명하게(0.2) 해야 배경 색 덩어리가 보인다. `body` 는 `background-attachment: fixed`.
15. **CardStack 안에서 투명 카드가 비친다.** `.card-stack-card` 가 불투명 `ink-950` 바탕을 깔아야 뒤 카드가 비치지 않는다(특히 aurora/glass 반투명).
16. **고정 레이어 z-index 질서**: 헤더 `z-20` < 모달 `z-50` < 토스트 `z-[60]` < 커서 효과 `z-[9999]`.
17. **커서 효과 켠 상태에서 입력창**: `cursor:none !important` 를 텍스트 입력(캐럿)·`select` 에는 적용하지 않고 오버레이도 숨긴다 — 안 그러면 입력 위치를 가늠할 수 없다.
18. **무한 rAF 금지**: 커서·트레일은 움직임이 있을 때만 rAF(수렴 epsilon). 정지 상태에서 CPU 를 쓰지 않는다.
19. **그림자 알파는 `--shadow-k` 로 감쇠.** 라이트 테마에서 검은 그림자를 그대로 쓰면 얼룩져 보인다(0.18 배).
20. **`.hero-grain > *` 는 `position: relative`.** 그레인 의사요소(`::before`, `inset:0`) 위로 콘텐츠가 올라오게 한다.

---

## 13. 부록

### 13.1 복사할 파일 매니페스트

경로는 프런트엔드 루트(`frontend/`) 기준. "→" 오른쪽은 이 문서의 절.

| 경로 | 내용 | 비고 |
|------|------|------|
| `tailwind.config.js` | 색 → CSS 변수 매핑(`white/black/paper/surface/ink/zinc/mint/amber/rose/emerald/sky/orange`), `fontFamily`, `borderRadius.4xl`, `fade-up` 키프레임/애니메이션 | §3.1 |
| `index.html` | `lang`, viewport, `<link rel="icon" type="image/png" href="/favicon.png">`, `#root`, `/src/main.tsx` | §13.3 |
| `public/favicon.png` | 파비콘 | §10.4 |
| `src/main.tsx` | `import './index.css'` → `initAppearance()` → Provider + 효과 3종 + 앱 | §8.5 |
| `src/index.css` | `@import` 2개, `@tailwind`, 스크롤바, body, `@layer components`(surface…tab-card 보더 빔), `@property`, `@layer utilities`(scrollbar-hide), 키프레임, `.toast-in`, `.focus-flash`, reduced-motion | §6.0 |
| `src/styles/card-styles.css` | 변수 계약 헤더 + 8개 카드 스타일 + neumorph 라이트 보정 | §5.4 |
| `src/appearance/fonts.css` | 글꼴 `@import` | §4.1 |
| `src/appearance/themes.ts` | 17 테마, `hexToRgb/rgbToHex/mix`, `scale`, `buildThemeVars`, `getTheme` | §3.5 |
| `src/appearance/options.ts` | 카드 스타일·글꼴·글자 크기·포인터/트레일 프리셋·LIMITS 3종 | §8.10 |
| `src/appearance/AppearanceContext.tsx` | 설정 모델·기본값·sanitize·효과 CSS 공식·`computeRootStyle`·`initAppearance`·Provider·`useThemeColors` | §9.6 |
| `src/components/ui/Brand.tsx` | 마크 + 워드마크 | §6.2 |
| `src/components/ui/IconTile.tsx` | 아이콘 타일 | §6.2 |
| `src/components/ui/Chip.tsx` | 칩 | §6.2 |
| `src/components/ui/Switch.tsx` | 토글 | §6.2 |
| `src/components/ui/Slider.tsx` + `slider.css` | 슬라이더 | §6.2 |
| `src/components/ui/SettingsGroup.tsx` | `SettingsGroup`, `SettingRow` | §6.2 |
| `src/components/ui/Portal.tsx` | body 포털 | §6.2 |
| `src/components/ui/RingGauge.tsx` | 링 게이지 | §6.2 |
| `src/components/ui/CardStack.tsx` | 스크롤 스택 | §6.2, §7.4 |
| `src/components/effects/CursorTrail.tsx` | 트레일 5종 | §8.9 |
| `src/components/effects/CursorPointer.tsx` | 포인터 4종 + 네이티브 숨김 | §8.9 |
| `src/components/effects/CardTilt.tsx` | 카드 기울기 | §8.9 |
| `src/components/settings/AppearanceSettings.tsx` | 설정 모달(섹션 4개) | §9.3 |
| `src/components/settings/CursorPresetGallery.tsx` | 프리셋 갤러리 | §9.3 |
| `src/components/CountUp.tsx` | 숫자 카운트 업 | §7.7 |
| (선택) 토스트 컴포넌트 | 토스트 스택 패턴 | §6.14 |
| (선택) 차트 컴포넌트 | Recharts 규칙 | §11 |
| `src/platform/desktop.ts` | 데스크톱 브리지 (웹·Wails·Tauri 감지 후 네이티브 호출) | §10.0 |
| (Wails 선택) `titlebar_windows.go`, `titlebar_other.go`, `main.go` 발췌 | 데스크톱 제목 표시줄 (Go) | §10.2–10.3 |
| (Tauri 선택) `src-tauri/src/titlebar.rs`, `lib.rs` 등록, `Cargo.toml`, `tauri.conf.json` | 데스크톱 제목 표시줄·창·CSP (Rust) | §10.5 |

### 13.2 기본 테마 변수 값 (CSS 폴백용)

`buildThemeVars(getTheme('default'))` 의 실제 출력입니다. JS 가 실행되기 전/비 React 환경에서 **정적 폴백**으로 `:root` 에 붙여두면 첫 페인트 전에도 기본 테마로 그려집니다. (JS 가 돌면 같은 변수를 인라인으로 덮어씁니다.)

```css
:root {
  --c-white: 255 255 255;
  --c-black: 0 0 0;
  --c-paper: 255 255 255;
  --c-shadow: 0 0 0;
  --c-ink-500: 56 56 57;
  --c-ink-600: 38 38 39;
  --c-ink-700: 27 27 28;
  --c-ink-800: 20 20 21;
  --c-ink-850: 15 15 16;
  --c-ink-900: 10 10 11;
  --c-ink-950: 6 6 7;
  --c-surface: 13 13 14;
  --c-zinc-50: 248 248 248;
  --c-zinc-100: 235 235 235;
  --c-zinc-200: 215 215 215;
  --c-zinc-300: 185 185 186;
  --c-zinc-400: 155 155 156;
  --c-zinc-500: 118 118 119;
  --c-zinc-600: 88 88 89;
  --c-zinc-700: 61 61 62;
  --c-zinc-800: 41 41 42;
  --c-zinc-900: 26 26 27;
  --c-zinc-950: 16 16 17;
  --c-mint-50: 236 250 243;
  --c-mint-100: 219 246 233;
  --c-mint-200: 193 240 217;
  --c-mint-300: 161 232 198;
  --c-mint-400: 125 223 176;
  --c-mint-500: 111 197 156;
  --c-mint-600: 95 169 134;
  --c-mint-700: 77 136 108;
  --c-mint-800: 60 104 83;
  --c-mint-900: 42 71 58;
  --c-mint-950: 27 45 37;
  --c-amber-50: 254 245 222;
  --c-amber-100: 254 237 194;
  --c-amber-200: 253 224 150;
  --c-amber-300: 252 209 97;
  --c-amber-400: 251 191 36;
  --c-amber-500: 222 169 33;
  --c-amber-600: 190 145 29;
  --c-amber-700: 153 117 24;
  --c-amber-800: 116 89 20;
  --c-amber-900: 80 62 16;
  --c-amber-950: 50 39 12;
  --c-rose-50: 254 234 237;
  --c-rose-100: 254 215 221;
  --c-rose-200: 253 187 196;
  --c-rose-300: 252 153 167;
  --c-rose-400: 251 113 133;
  --c-rose-500: 222 100 118;
  --c-rose-600: 190 86 102;
  --c-rose-700: 153 70 83;
  --c-rose-800: 116 54 64;
  --c-rose-900: 80 38 45;
  --c-rose-950: 50 25 30;
  --c-emerald-50: 225 248 240;
  --c-emerald-100: 198 243 226;
  --c-emerald-200: 158 234 206;
  --c-emerald-300: 109 223 182;
  --c-emerald-400: 52 211 153;
  --c-emerald-500: 46 186 135;
  --c-emerald-600: 41 160 117;
  --c-emerald-700: 34 129 95;
  --c-emerald-800: 27 98 73;
  --c-emerald-900: 20 68 51;
  --c-emerald-950: 14 43 33;
  --c-sky-50: 225 245 254;
  --c-sky-100: 199 237 253;
  --c-sky-200: 159 223 252;
  --c-sky-300: 112 207 250;
  --c-sky-400: 56 189 248;
  --c-sky-500: 50 167 219;
  --c-sky-600: 44 143 188;
  --c-sky-700: 36 116 152;
  --c-sky-800: 28 88 115;
  --c-sky-900: 21 61 79;
  --c-sky-950: 15 39 50;
  --c-orange-50: 254 239 226;
  --c-orange-100: 254 224 200;
  --c-orange-200: 253 203 161;
  --c-orange-300: 252 177 115;
  --c-orange-400: 251 146 60;
  --c-orange-500: 222 129 54;
  --c-orange-600: 190 111 47;
  --c-orange-700: 153 90 39;
  --c-orange-800: 116 69 31;
  --c-orange-900: 80 48 23;
  --c-orange-950: 50 31 17;
  --shadow-k: 1;
  color-scheme: dark;
}
```

### 13.3 스타터 스니펫 세트

최소 구성으로 "똑같은 모양"의 화면을 띄우기 위한 조각입니다. 전체 파일은 위 장에 있으니 아래는 **연결 방법**만 보여줍니다.

#### (1) `index.html`

```html
<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App Name</title>
    <link rel="icon" type="image/png" href="/favicon.png" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

#### (2) `src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppearanceProvider, initAppearance } from './appearance/AppearanceContext';
import CursorTrail from './components/effects/CursorTrail';
import CursorPointer from './components/effects/CursorPointer';
import CardTilt from './components/effects/CardTilt';
import './index.css';

initAppearance();   // 첫 렌더 전에 — 저장된 테마로 바로 그려진다

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <CursorTrail />
      <CursorPointer />
      <CardTilt />
      <App />
    </AppearanceProvider>
  </React.StrictMode>
);
```

#### (3) 최소 화면 — 클래스 사용 예 (앱 셸 + 카드 그리드 + 모달 트리거)

```tsx
import { useState } from 'react';
import { Layers, Plus, Settings2 } from 'lucide-react';
import Brand from './components/ui/Brand';
import IconTile from './components/ui/IconTile';
import CountUp from './components/CountUp';
import AppearanceSettings from './components/settings/AppearanceSettings';

export default function App() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative min-h-screen app-bg text-zinc-100">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[420px]"
           style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgb(var(--c-white) / 0.06) 0%, transparent 70%)' }} />

      <header className="app-header sticky top-0 z-20 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <Brand />
            <button type="button" onClick={() => setOpen(true)} aria-label="모양 설정"
                    className="glass-pill flex h-9 w-9 items-center justify-center text-zinc-400 hover:text-white transition-colors">
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      </header>

      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-fade-up">
        {/* 페이지 헤더 */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <IconTile icon={Layers} tone="mint" />
            <div className="min-w-0">
              <h2 className="text-2xl font-light tracking-tight text-white">페이지 제목</h2>
              <p className="label-mono">3 items</p>
            </div>
          </div>
          <button className="btn-primary shrink-0"><Plus className="w-5 h-5" />추가</button>
        </div>

        {/* 히어로 */}
        <div className="hero-grain p-6 mb-6">
          <div className="label-mono">총계 라벨</div>
          <div className="num mt-1 text-4xl font-light tracking-tight text-white">
            <CountUp value={12480} format={(v) => Math.round(v).toLocaleString('ko-KR')} />
          </div>
        </div>

        {/* 카드 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="surface surface-interactive flex h-full flex-col p-5">
              <h3 className="text-lg font-medium tracking-tight text-white">항목 {n}</h3>
              <p className="label-mono mt-1">부제</p>
              <div className="mt-3 flex flex-wrap gap-1.5"><span className="chip">속성</span><span className="chip">속성</span></div>
              <div className="label-mono mt-auto border-t border-white/[0.06] pt-3">메타 정보</div>
            </div>
          ))}
        </div>
      </main>

      <AppearanceSettings open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
```

#### (4) 모달 최소형

```tsx
<Portal>
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
       onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label="제목" className="surface w-full max-w-2xl max-h-[85vh] overflow-y-auto p-4 sm:p-6">
      …
    </div>
  </div>
</Portal>
```

#### (5) 새 앱 이식 완료 점검표

- [ ] `<html>` 에 `data-card`, `data-theme-mode`, `data-theme` 속성과 `--c-*` 인라인 변수가 붙는다 (개발자 도구 확인)
- [ ] 설정 모달에서 테마 17개·카드 스타일 8개를 바꿔도 모든 화면이 따라온다 (하드코딩 색 없음)
- [ ] 라이트 테마에서 모달 막(`bg-black/60`)이 흰 막, 글자 대비 정상, `bg-paper` 타일은 흰색 유지
- [ ] 모달이 스택/글라스 카드 안에서 열려도 화면 중앙 (Portal)
- [ ] OS "동작 줄이기" 켜면 보더 빔 정지, 커서/트레일/틸트 비활성, CountUp 즉시 값
- [ ] 효과(커서·글로우·입체감)가 기본 꺼짐, 켜도 모달·토스트에는 새지 않음
- [ ] 새로고침해도 깜빡임 없이 저장된 테마로 시작 (`initAppearance()` 첫 렌더 전)
- [ ] 차트 색이 테마를 따른다 (`useThemeColors`)
- [ ] `tailwind.config.js` 수정 후 dev 서버 재시작 확인

---

*끝.*
