# UI 디자인 템플릿 — 다크 글라스 · 사이드바 셸

다른 앱에서 이 앱의 **화면 틀과 질감**을 그대로 쓰기 위한 템플릿입니다. 색 토큰 · 17개 테마 · 카드 스타일 8종 · 글꼴 · 사이드바 메뉴 · 상단 바 · 목록-상세 화면 · 모양 설정 창까지 지금 코드 기준으로 정리했습니다.

- **들어 있는 것:** 토큰과 테마 생성 규칙, 레이아웃 치수, 컴포넌트 클래스, 모양 설정 화면 사양, 원본 CSS(부록).
- **뺀 것:** 앱 아이콘·로고 그림과 아이콘 세트. 아이콘이 들어갈 자리와 크기만 적었으니 각 앱의 아이콘을 쓰면 됩니다. 업무 화면(계좌·매매 신호 등)의 내용도 뺐습니다.
- **기술 전제:** React + Tailwind CSS 3 기준입니다. Tailwind 없이도 부록의 CSS 변수와 클래스 규칙만 옮기면 같은 모양이 나옵니다.
- **기준 시점:** Stock Manager v1.1.5 (2026-11). 이전 화면 구성(가로 탭 헤더)과 효과 컴포넌트 전체 소스는 `docs/DESIGN_SYSTEM.md`에 있습니다.

## 목차

1. [디자인 원칙](#1-디자인-원칙)
2. [빠른 적용 순서](#2-빠른-적용-순서)
3. [색 토큰과 테마](#3-색-토큰과-테마)
4. [타이포그래피](#4-타이포그래피)
5. [카드 스타일 8종](#5-카드-스타일-8종)
6. [앱 셸 — 사이드바 · 상단 바 · 본문](#6-앱-셸--사이드바--상단-바--본문)
7. [목록-상세 화면](#7-목록-상세-화면)
8. [모바일 배치](#8-모바일-배치)
9. [컴포넌트 클래스](#9-컴포넌트-클래스)
10. [모양 설정 창](#10-모양-설정-창)
11. [효과 (선택)](#11-효과-선택)
12. [모션 · 접근성](#12-모션--접근성)
13. [이식 체크리스트](#13-이식-체크리스트)
- [부록 A. 테마 생성 코드 `themes.ts`](#부록-a-테마-생성-코드-themests)
- [부록 B. 기본·라이트 테마 계산 결과 (CSS 변수)](#부록-b-기본라이트-테마-계산-결과-css-변수)
- [부록 C. Tailwind 설정 `tailwind.config.js`](#부록-c-tailwind-설정-tailwindconfigjs)
- [부록 D. 카드 스타일 `card-styles.css` 전문](#부록-d-카드-스타일-card-stylescss-전문)
- [부록 E. 컴포넌트 클래스 `index.css` 전문](#부록-e-컴포넌트-클래스-indexcss-전문)

---

## 1. 디자인 원칙

| 원칙 | 내용 |
|---|---|
| 어두운 바탕 위 얇은 빛 | 거의 검정인 배경에 흰색 4~10% 투명도의 면·테두리를 겹쳐 깊이를 만든다. 진한 색 면은 쓰지 않는다. |
| 색은 강조 하나 + 상태 넷 | 테마마다 강조색(`mint`) 하나만 고르고, 상태색(rose·amber·sky·emerald)은 의미에만 쓴다. |
| 모든 색은 변수 | 화면 코드에 hex 를 쓰지 않는다. `rgb(var(--c-…) / 알파)` 또는 Tailwind 색 이름만 쓴다. 테마·라이트 모드가 자동으로 따라온다. |
| 모양은 카드 스타일 변수 | 반경·테두리·그림자·블러는 `--card-*` 등 변수로만 정한다. `data-card` 속성 하나로 8가지 질감이 바뀐다. |
| 숫자는 고정폭·정렬 | 금액·비율은 `.num`(tabular-nums), 보조 라벨은 고정폭 `.label-mono`. |
| 위계는 크기보다 밝기 | 제목 white, 본문 zinc-100~300, 보조 zinc-400~500, 비활성 zinc-600. |

---

## 2. 빠른 적용 순서

1. 글꼴 패키지 설치 후 `fonts.css` 임포트 (§4.1).
2. `tailwind.config.js` 의 색을 CSS 변수로 연결 (부록 C).
3. 테마 생성 코드(부록 A)로 `<html>` 에 `--c-*` 변수, `data-theme`, `data-theme-mode`, `data-card` 를 넣는다 (§3.4). 렌더 전에 한 번 적용해 깜빡임을 막는다.
4. `card-styles.css`(부록 D)와 `index.css`(부록 E)를 그대로 가져온다.
5. 앱 셸을 §6 치수대로 만든다: 왼쪽 사이드바 + sticky 상단 바 + 본문.
6. 목록이 있는 화면은 §7 목록-상세 배치를 쓴다.
7. 사이드바 아래 '모양 설정'에서 §10 의 모양 설정 창을 연다.

---

## 3. 색 토큰과 테마

### 3.1 변수 체계

모든 색 변수는 `R G B` 세 숫자(예: `125 223 176`)로 저장하고 `rgb(var(--c-mint-400) / 0.3)` 처럼 알파를 붙여 쓴다.

| 변수 | 단계 | 역할 |
|---|---|---|
| `--c-white` | - | 최대 대비 글자·얇은 면·테두리 (라이트 테마에서는 어두운 글자색) |
| `--c-black` | - | 모달 배경막 (다크=검정, 라이트=흰색) |
| `--c-paper` | - | 항상 흰색 (로고 바탕 등) |
| `--c-shadow` | - | 그림자 색 |
| `--c-surface` | - | 카드 바탕 |
| `--c-ink-*` | 950·900·850·800·700·600·500 | 배경 → 카드 → 테두리 순으로 밝아지는 무채색 면 |
| `--c-zinc-*` | 50~950 | 글자·아이콘 중립색 (50 이 가장 밝음) |
| `--c-mint-*` | 50~950 | **테마 강조색** (이름은 mint 지만 테마마다 색이 다름) |
| `--c-rose-*` | 50~950 | 위험·매도·오류·하락 |
| `--c-amber-*` | 50~950 | 주의·충돌·제한 |
| `--c-emerald-*` | 50~950 | 성공 보조 |
| `--c-sky-*` | 50~950 | 정보·보조 강조(그라데이션 두 번째 색) |
| `--c-orange-*` | 50~950 | 아이콘 타일 기본 글로우 |
| `--shadow-k` | 1 / 0.18 | 그림자 세기 계수 (라이트 테마에서 약하게) |

**상태색 쓰임 규칙**

| 의미 | 글자 | 배지 (테두리 / 바탕 / 글자) | 점 |
|---|---|---|---|
| 긍정·상승·선택 | `text-mint-300` | `border-mint-400/30 bg-mint-400/10 text-mint-300` | `bg-mint-400` |
| 위험·하락·매도 | `text-rose-300` | `border-rose-400/30 bg-rose-500/10 text-rose-200` | `bg-rose-400` |
| 주의·충돌 | `text-amber-300` | `border-amber-400/30 bg-amber-400/10 text-amber-200` | `bg-amber-400` |
| 중립 | `text-zinc-300` | `border-white/10 bg-white/[0.05] text-zinc-300` | `bg-zinc-400` |
| 없음·비활성 | `text-zinc-500` | `border-white/10 bg-white/[0.04] text-zinc-500` | `bg-zinc-500` |

### 3.2 테마 17종

테마는 **배경(bg)·글자(fg)·강조(accent) 세 색**만 정하고 나머지는 섞어서 만든다(부록 A). 강조색이 주황·노랑 계열이면 상태색 amber 와 겹치지 않게 상태색을 덮어쓴다. 아래 오른쪽 세 칸은 실제 계산 결과다.

| id | 이름 | 모드 | 배경 bg | 글자 fg | 강조 accent | 카드 바탕 surface | 테두리 기준 ink-700 | 보조 글자 zinc-400 | 상태 색 덮어쓰기 |
|---|---|---|---|---|---|---|---|---|---|
| `default` | 기본 (블랙 · 민트) | dark | `#060607` | `#ffffff` | `#7ddfb0` | `#0d0d0e` | `#1b1b1c` | `#9b9b9c` | - |
| `graphite-blue` | 그라파이트 · 파랑 | dark | `#111113` | `#f4f4f5` | `#6aa8ff` | `#18181a` | `#242426` | `#99999b` | - |
| `graphite-orange` | 그라파이트 · 주황 | dark | `#111113` | `#f4f4f5` | `#f59e6b` | `#18181a` | `#242426` | `#99999b` | amber #a5b4fc, orange #f472b6 |
| `monochrome` | 모노크롬 | dark | `#0a0a0a` | `#fafafa` | `#d4d4d8` | `#111111` | `#1e1e1e` | `#9a9a9a` | - |
| `mauve` | 모브 (회보라) | dark | `#16131b` | `#f3eef7` | `#c4a7e7` | `#1d1a22` | `#29262e` | `#9b969f` | - |
| `mocha` | 모카 (갈색) | dark | `#191411` | `#f5ede6` | `#d9a46f` | `#201b17` | `#2c2623` | `#9d9691` | amber #9fc4d9, orange #e48fa8 |
| `slate` | 슬레이트 (청회색) | dark | `#0e131a` | `#e8eef5` | `#7fb0d9` | `#151a21` | `#21262d` | `#91969d` | - |
| `dracula` | Dracula | dark | `#21222c` | `#f8f8f2` | `#bd93f9` | `#272832` | `#33343d` | `#a2a2a3` | - |
| `nord` | Nord | dark | `#2e3440` | `#eceff4` | `#88c0d0` | `#343a45` | `#3e444f` | `#a0a4ac` | - |
| `tokyo-night` | Tokyo Night | dark | `#1a1b26` | `#c0caf5` | `#7aa2f7` | `#1f202c` | `#282a38` | `#7e84a2` | - |
| `catppuccin-mocha` | Catppuccin Mocha | dark | `#1e1e2e` | `#cdd6f4` | `#cba6f7` | `#232434` | `#2d2e3f` | `#878ca5` | - |
| `gruvbox` | Gruvbox | dark | `#1d2021` | `#ebdbb2` | `#fe8019` | `#232625` | `#2f302d` | `#999078` | amber #d3869b, orange #83a598, emerald #b8bb26, rose #fb4934 |
| `rose-pine` | Rosé Pine | dark | `#191724` | `#e0def4` | `#ebbcba` | `#1f1d2a` | `#2a2836` | `#908ea1` | - |
| `solarized-dark` | Solarized Dark | dark | `#002b36` | `#eee8d5` | `#2aa198` | `#07313b` | `#143b44` | `#8f9c95` | - |
| `light` | 라이트 (민트) | light | `#f4f5f7` | `#111113` | `#0f9f6e` | `#ffffff` | `#e1e2e4` | `#6c6c6e` | - |
| `solarized-light` | Solarized Light | light | `#fdf6e3` | `#073642` | `#268bd2` | `#fffbef` | `#e8e6d5` | `#698382` | - |
| `catppuccin-latte` | Catppuccin Latte | light | `#eff1f5` | `#4c4f69` | `#8839ef` | `#ffffff` | `#e1e3e9` | `#8d90a1` | - |

### 3.3 단계 생성 규칙 요약

- `mix(a, b, t)`: a 에서 b 쪽으로 t 만큼 섞는다 (RGB 선형).
- **ink**(면): `mix(bg, fg, t)` — 950: 0, 900: 0.016, 850: 0.035, 800: 0.055, 700: 0.085, 600: 0.13, 500: 0.2
- **surface**(카드 바탕): 테마에 지정한 값, 없으면 `mix(bg, fg, 0.03)`
- **zinc**(중립 글자): `mix(bg, fg, t)` — 50: 0.97, 100: 0.92, 200: 0.84, 300: 0.72, 400: 0.6, 500: 0.45, 600: 0.33, 700: 0.22, 800: 0.14, 900: 0.08, 950: 0.04
- **강조·상태색 단계**: 400 = 기준색, 낮은 단계는 fg 쪽(50: 0.85, 100: 0.72, 200: 0.52, 300: 0.28), 높은 단계는 bg 쪽(500: 0.12, 600: 0.25, 700: 0.4, 800: 0.55, 900: 0.7, 950: 0.82)
- 상태색 기준값: amber `#fbbf24`, rose `#fb7185`, emerald `#34d399`, sky `#38bdf8`, orange `#fb923c`. 라이트 테마에서는 글자로 읽히도록 `mix(기준, fg, 0.38)` 로 어둡게 옮긴다.
- `--c-black`: 다크 `#000000`, 라이트 `#ffffff`. `--c-shadow`: 다크 `#000000`, 라이트 `mix(fg, bg, 0.3)`. `--shadow-k`: 다크 1, 라이트 0.18.

### 3.4 적용 방법

```ts
// 설정(테마·카드 스타일·글꼴·크기·효과) → <html> 에 변수와 속성을 넣는다
const root = document.documentElement;
Object.entries(buildThemeVars(theme)).forEach(([k, v]) => root.style.setProperty(k, v));
root.style.setProperty('--font-sans', `${sans.family}, ${SANS_FALLBACK}`);
root.style.setProperty('--font-mono', `${mono.family}, ${MONO_FALLBACK}`);
root.style.setProperty('font-size', '16px'); // 15 / 16 / 17
root.setAttribute('data-theme', theme.id);        // 'default' 등
root.setAttribute('data-theme-mode', theme.mode); // 'dark' | 'light'
root.setAttribute('data-card', 'glass');          // 카드 스타일 (§5)
```

- 설정은 `localStorage` 에 저장하고, **React 렌더 전에** 한 번 적용한다(`main.tsx` 에서 `initAppearance()` 호출 후 `createRoot`). 첫 화면이 기본 테마로 깜빡이지 않는다.
- 변수 이름을 바꾸지 않으면 Tailwind 클래스(`bg-ink-900`, `text-mint-300`, `border-white/10` …)가 모든 테마에서 그대로 맞는다.

---

## 4. 타이포그래피

### 4.1 글꼴

| 구분 | 선택지 (기본 굵게) | CSS family |
|---|---|---|
| 본문 | **Pretendard**, Noto Sans KR, IBM Plex Sans KR, 나눔고딕, 고운돋움, 시스템 기본 | `"Pretendard Variable", Pretendard` 등 |
| 숫자·라벨 (고정폭) | **JetBrains Mono**, IBM Plex Mono, Fira Code, 나눔고딕코딩 | `"JetBrains Mono"` 등 |

- 대체 글꼴: 본문 `"Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif` / 고정폭 `"Pretendard Variable", ui-monospace, SFMono-Regular, Menlo, monospace` (고정폭 글꼴에 한글이 없을 때 Pretendard 로).
- 패키지: `pretendard`, `@fontsource/noto-sans-kr`, `@fontsource/ibm-plex-sans-kr`, `@fontsource/nanum-gothic`, `@fontsource/gowun-dodum`, `@fontsource/jetbrains-mono`, `@fontsource/ibm-plex-mono`, `@fontsource/fira-code`, `@fontsource/nanum-gothic-coding`.
- Tailwind: `fontFamily: { sans: ['var(--font-sans)'], mono: ['var(--font-mono)'] }`.

`frontend/src/appearance/fonts.css`

```css
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

### 4.2 글자 크기와 역할

루트 글자 크기는 **15 / 16(기본) / 17px** 세 단계. 모든 rem 값이 함께 커진다.

| 역할 | 클래스 | 값 |
|---|---|---|
| 페이지 제목 (상단 바) | `text-lg font-semibold tracking-tight text-white` | 18px |
| 상세 제목 | `text-xl font-semibold tracking-tight text-white` | 20px |
| 섹션 제목 | `.section-title` | 15px semibold white |
| 큰 숫자 | `text-2xl~3xl font-light tracking-tight text-white num` | 24~30px 가는 굵기 |
| 본문 | `text-sm text-zinc-100~300` | 14px |
| 보조 라벨 | `.label-mono` | 11px 고정폭 zinc-500, 자간 넓게 |
| 메뉴 묶음 이름 | `.nav-group-label` | 10px 고정폭 대문자, 자간 0.16em, zinc-600 |
| 숫자 정렬 | `.num` | `font-variant-numeric: tabular-nums` |

### 4.3 워드마크 (브랜드 글자)

사이드바 맨 위 브랜드는 **두 굵기 워드마크**다. 마크 그림은 각 앱의 것을 쓴다(34×34px 자리, 왼쪽, 글자와 12px 간격).

```html
<div class="flex items-center gap-3 select-none">
  <img src="/brand-mark.svg" alt="" width="34" height="34" /> <!-- 각 앱의 마크 -->
  <div class="leading-none whitespace-nowrap text-[17px] tracking-tight text-white">
    <span class="font-semibold">Product</span> <span class="font-light text-zinc-400">Name</span>
  </div>
</div>
```

---

## 5. 카드 스타일 8종

카드·패널·알약·버튼·입력·아이콘 타일·칩·히어로의 모양은 **CSS 변수로만** 정의한다. `<html data-card="glass">` 처럼 속성 하나로 앱 전체 질감이 바뀌고, 미리보기처럼 `<div data-card="brutal">` 을 중첩해도 그 안만 바뀐다. 전체 CSS 는 부록 D.

| id | 이름 | 카드 반경 | 테두리 | 그림자·질감 | 알약·버튼 반경 | 입력 반경 | hover |
|---|---|---|---|---|---|---|---|
| `glass` (기본) | 리퀴드 글라스 | 24px | 1px 흰 8% | 위쪽 안쪽 광택 + 깊은 아래 그림자, 흰 4.5→1.2% 세로 그라데이션 | 원형 | 12px | 1px 떠오름 |
| `minimal` | 모노라인 미니멀 | 10px | 1px 흰 13% | 그림자 없음, 바탕 = 배경 | 8px | 8px | 테두리만 밝아짐 |
| `flat` | 플랫 톤 계층 | 20px | 없음 | 밝기 단계로만 층 구분 | 원형 | 14px | 없음 |
| `neumorph` | 뉴모피즘 | 22px | 없음 | 밝은/어두운 그림자 두 개로 돌출 | 원형 / 버튼 14px | 14px | 없음 |
| `paper` | 레이어드 페이퍼 | 14px | 1px | 아래로 겹친 종이 장 그림자 | 12px / 10px | 10px | 2px 떠오름 |
| `glow` | 아웃라인 글로우 | 16px | 1px | 그림자 없음, 활성 요소만 강조색 발광 | 원형 | 12px | 없음 |
| `aurora` | 오로라 | 22px | 없음 | 흐린 색 덩어리 배경 + 반투명 카드(블러 18px), 상단 바·사이드바도 더 투명 | 원형 | 14px | 2px 떠오름 |
| `brutal` | 브루탈리즘 | 4px | 2px 단색 | 4px 오프셋 단색 그림자 | 2px | 2px | (-3, -3)px 이동 |

**변수 계약** — 새 스타일을 만들 때 아래를 모두 정의한다(빠지면 바깥 스타일 값을 물려받는다).

| 묶음 | 변수 |
|---|---|
| 배경 | `--app-bg` (선택: `--header-bg`, `--sidebar-bg`) |
| 카드 | `--card-radius --card-border-w --card-border --card-bg --card-shadow --card-blur --card-hover-border --card-hover-shadow --card-hover-transform` |
| 패널 | `--inset-radius --inset-border-w --inset-border --inset-bg --inset-shadow` |
| 알약 | `--pill-radius --pill-border-w --pill-border --pill-bg --pill-shadow --pill-blur --pill-active-bg --pill-active-fg --pill-active-border --pill-active-shadow` |
| 탭 카드 | `--tab-radius --tab-border-w --tab-border --tab-bg --tab-shadow --tab-hover-border --tab-active-border --tab-active-bg --tab-active-shadow` |
| 버튼 | `--btn-radius --btn-icon-radius --btn-border-w`, `--btn-primary-fg/-bg/-hover-bg/-border/-shadow/-active-transform/-active-shadow`, `--btn-ghost-border/-bg/-shadow/-hover-border/-hover-bg`, `--btn-icon-border/-bg/-shadow` |
| 아이콘 타일 | `--tile-radius --tile-border-w --tile-border --tile-base --tile-glow --tile-shadow` |
| 칩 | `--chip-radius --chip-border-w --chip-border --chip-bg --chip-shadow` |
| 입력 | `--input-radius --input-border-w --input-border --input-bg --input-shadow --input-focus-border --input-focus-shadow` |
| 히어로 | `--hero-radius --hero-border-w --hero-border --hero-bg --hero-shadow --hero-grain-opacity` |

> 그림자 변수는 `none` 대신 투명 그림자 `0 0 #0000` 을 쓴다. 효과(§11)의 그림자를 앞에 덧붙여도 깨지지 않게 하기 위해서다.

---

## 6. 앱 셸 — 사이드바 · 상단 바 · 본문

### 6.1 전체 구조

```
┌──────────┬─────────────────────────────────────────────────────────┐
│ 사이드바  │ 상단 바 (sticky, 56px~)  제목 │ 페이지 도구 …   │ 도구 │ 알림 │
│ 208px    ├─────────────────────────────────────────────────────────┤
│ (64px    │ 본문 (최대 1536px, 좌우 16/24px, 위아래 20/24px)            │
│  레일)    │                                                         │
│          │   ┌─목록───────────┬─상세──────────────────────────┐       │
│ 묶음 이름  │   │ 행             │ 제목 · 배지                    │       │
│ ▸ 메뉴    │   │ 행 (선택)       │ 개요 │ 규칙 │ …  (밑줄 탭)       │       │
│ ▸ 메뉴    │   │ 행             │ 내용                           │       │
│ …        │   └────────────────┴──────────────────────────────┘       │
│ 상태 알약  │                                                         │
│ 모양 설정  │                                                         │
│ 메뉴 접기  │                                                         │
│ v1.2.3   │                                                         │
└──────────┴─────────────────────────────────────────────────────────┘
```

- 바깥 배경: `.app-bg` (`--app-bg`).
- **앰비언트 광원**: 본문 위쪽에 고정된 420px 높이 빛. `background: radial-gradient(60% 100% at 50% 0%, rgb(var(--c-white) / 0.06) 0%, transparent 70%)`, `pointer-events: none`.
- 본문 영역은 사이드바 폭만큼 왼쪽 여백(`pl-52` / 레일일 때 `pl-16`)을 두고, 폭이 바뀔 때 `transition: padding 300ms`.

### 6.2 사이드바 (메뉴 스타일)

| 부분 | 사양 |
|---|---|
| 틀 | `position: fixed; inset-y: 0; left: 0; z-index: 40`, 폭 **208px**(펼침) / **64px**(레일) / 256px(모바일 서랍). 폭·위치 변화 300ms. |
| 바탕 | `.app-sidebar` — `rgb(var(--c-ink-900) / 0.88)` + 오른쪽 1px `white/7%` + `backdrop-filter: blur(20px)`. aurora 스타일은 `--sidebar-bg` 로 더 투명하게. |
| 브랜드 행 | 높이 56px, 좌우 16px. 워드마크(§4.3). 레일에서는 마크만 가운데. |
| 메뉴 영역 | 좌우 12px, 세로 스크롤(스크롤바 숨김). |
| 묶음 이름 | `.nav-group-label` — 위 20px·아래 6px 여백, 10px 고정폭 대문자, 자간 0.16em, zinc-600. 레일에서는 이름 대신 묶음 사이에 1px `white/7%` 구분선(좌우 8px, 위아래 12px). |
| 메뉴 항목 | `.nav-item` — 높이 **36px**, 좌우 10px, 아이콘-글자 간격 10px, 14px 글자 zinc-400, 반경 = 입력 반경(glass 12px), 1px 투명 테두리. 항목 사이 2px. |
| hover | 글자 zinc-100, 바탕 `white/4%`. |
| 선택 | `.nav-item-active` — 글자 white, 바탕 `mint-400 / 10%`, 테두리 `mint-400 / 28%`, 아이콘 mint-400. `aria-current="page"`. |
| 키보드 초점 | `outline: 2px solid mint-400/60; outline-offset: 1px`. |
| 아이콘 자리 | 16×16px 선 아이콘, 선 굵기 1.75, `currentColor`. (아이콘 세트는 각 앱이 정함) |
| 새 기능 표시 | 펼침: 오른쪽 끝 `.badge-new` ("New", 검정 바탕·흰 테두리 80%·10px). 레일: 아이콘 오른쪽 위(오른쪽 10px, 위 8px) 6px mint 점. |
| 레일 모드 | 아이콘만 가운데, 글자 대신 `title` 툴팁. |

**사이드바 아래쪽** (위에서 아래 순서, 좌우 12px·아래 12px, 항목 사이 4px)

1. **상태 알약** — 앱의 핵심 실시간 값 하나(예: 환율·연결 상태). `.glass-pill` 높이 36px·좌우 12px: 6px 강조색 점(`box-shadow: 0 0 8px mint-400/0.8`) + `.label-mono` 이름 + 오른쪽 끝 값(14px medium white, `.num`). 레일에서는 9px 라벨과 11px 값 두 줄.
2. **모양 설정** — `.nav-item` (§10 창 열기).
3. **메뉴 접기 / 펼치기** — `.nav-item`, `aria-expanded`. 모바일에는 없음.
4. **업데이트 버튼** (새 버전이 있을 때만) — `.btn-primary` 전체 폭, 위아래 6px, 12px 글자, "업데이트 v1.2.3".
5. **버전 줄** — 위 1px `white/6%` 구분선, 위 10px 여백, 11px 고정폭 zinc-500(hover zinc-300). 왼쪽 태그(semibold zinc-300) + 오른쪽 커밋 7자리, 커밋 안 된 변경이 있으면 amber `*`. 누르면 새 버전 확인(확인 중 회전 표시 → "✓ 최신 버전입니다"(mint-300) 또는 오류(rose-300)).

**접힘 규칙**

| 창 폭 | 기본 | 사용자가 바꾸면 |
|---|---|---|
| 768px 미만 | 서랍 (§8) | - |
| 768~1280px | 레일(64px) | 펼쳐도 저장하지 않음 (앱을 다시 켜면 레일) |
| 1280px 초과 | 펼침(208px) | 접음 여부를 `localStorage` 에 저장 |

### 6.3 상단 바

| 부분 | 사양 |
|---|---|
| 틀 | `position: sticky; top: 0; z-index: 20`, `.app-header` 바탕(`--header-bg`, 기본 `ink-950 / 0.7`), 아래 1px `white/7%`, `backdrop-filter: blur(24px)`. |
| 안쪽 | 최대 폭 1536px 가운데, 최소 높이 56px, 좌우 16px(640px↑ 24px), 위아래 10px, 요소 간격 12px. |
| 왼쪽 | 페이지 제목 `h1` (18px semibold white, 줄바꿈 없음) → **앞쪽 도구 칸**(계좌 선택 등, 간격 8px). |
| 오른쪽 | **뒤쪽 도구 칸**(추가 버튼·새로고침 등) → 알림 버튼(`.btn-icon` 원형). |
| 넘칠 때 | 데스크톱에서 도구가 한 줄에 안 들어가면 오른쪽 묶음이 다음 줄로 내려간다(`flex-wrap`, 줄 간격 8px). |
| 높이 전달 | 상단 바 높이를 `ResizeObserver` 로 재서 `--app-header-h` 로 알려 준다. 목록-상세 높이 계산(§7)에 쓴다. |

**페이지 도구 칸(포털)** — 각 페이지가 자기 버튼을 상단 바에 넣는다. 상단 바에 빈 `div` 두 개(앞쪽·뒤쪽)를 두고, 페이지에서는 `createPortal(children, slotElement)` 로 그 안에 그린다. 빈 칸은 `empty:hidden` 으로 숨긴다.

```tsx
// 페이지 안에서
<PageActions slot="lead"><AccountSelect /></PageActions>
<PageActions><button className="btn-primary">+ 추가</button></PageActions>
```

### 6.4 본문

- `<main>`: 최대 폭 1536px 가운데, 좌우 16px(640px↑ 24px), 위아래 20px(640px↑ 24px).
- 페이지가 바뀔 때마다 `key` 를 바꿔 `animate-fade-up` (아래에서 8px 올라오며 나타남, 0.45s `cubic-bezier(0.22, 1, 0.36, 1)`).
- 주소는 해시 라우팅(`#accounts`) — 새로고침·뒤로 가기에 강하고 데스크톱 웹뷰에서도 그대로 동작.

---

## 7. 목록-상세 화면

목록이 있는 화면(계좌·종목·기록·신호 등)은 **왼쪽 목록 + 오른쪽 상세** 한 카드로 보여 준다.

| 상황 | 배치 |
|---|---|
| 담는 칸 폭 ≥ **900px** | 한 `.surface` 안에 목록(기본 480px, 화면마다 조절) + 상세. 높이 `calc(100vh - var(--app-header-h) - 3rem)`, 최소 520px. 목록과 상세가 **각자 스크롤**. 목록 오른쪽 1px `white/7%`. 상세 안쪽 여백 20px(640px↑ 24px). |
| 900px 미만 | 목록 화면 ↔ 상세 화면 전환. 상세 위에 `.btn-ghost` 작은 버튼 "← 목록으로". |

- 폭은 창이 아니라 **담는 칸**을 `ResizeObserver` 로 잰다(사이드바가 접히고 펼쳐질 때도 맞게). 그리기 전에 재서 첫 화면부터 맞는 배치를 쓴다.
- 넓은 화면에서는 첫 항목을 자동 선택하고, 좁은 화면에서는 목록부터 보여 준다.

**목록 행**

| 상태 | 스타일 |
|---|---|
| 기본 | 아래 1px `white/4%`, 좌우 16px·위아래 8px, 이름 13px zinc-100 + 아래줄 10.5px 고정폭 zinc-500 |
| hover | 바탕 `white/3%` |
| 선택 | 바탕 `mint-400 / 8%` + **왼쪽 3px 강조색 막대** `box-shadow: inset 3px 0 0 rgb(var(--c-mint-400))`, 이름 medium white |
| 키보드 초점 | `ring-1 ring-inset ring-mint-400/60` |
| 접근성 | 목록 `role="listbox"`, 행 `role="option" aria-selected`, ↑↓ 로 이동, 선택 행이 보이게 자동 스크롤 |

- 목록 위쪽: 필터 알약(`.glass-pill` + `.pill-item`, 개수는 색 숫자) → 검색 입력 + 드롭다운 → 열 머리글(`.table-head`).
- 숫자 열은 오른쪽 정렬 `.num`, 오르면 mint-300 / 내리면 rose-300.

**상세 패널**

```
제목 (20px semibold)                       [묶음 칩] [상태 배지]
보조 줄 (.label-mono: 코드 · 통화 · 개수)
개요   규칙   전략 추천   이력        ← 밑줄 탭
────────────────────────────────────
내용
```

- 밑줄 탭: 탭 사이 20px, 아래 1px `white/7%`. 탭 버튼 14px, 아래 2px 테두리(`-mb-px`), 위아래 여백 아래쪽 10px. 선택 = `border-mint-400 text-white`, 기본 = 투명 테두리 zinc-400(hover zinc-200). `role="tablist"` / `role="tab" aria-selected` / 내용 `role="tabpanel"`.
- 상태 배지: `.badge` + §3.1 상태색 + 6px 점.

---

## 8. 모바일 배치

768px 미만에서 바뀌는 것.

| 부분 | 사양 |
|---|---|
| 사이드바 | 256px **서랍**. 닫혀 있으면 `translate-x: -100%` + `invisible`. 열면 뒤에 `black/60` + `backdrop-blur(4px)` 배경막(z 30), 브랜드 행 오른쪽에 닫기 `.btn-icon`. |
| 하단 탭 | 화면 아래 고정, `.app-header` 바탕 + 위 1px `white/8%` + 블러 24px. **4칸 격자**: 메뉴 묶음 3개 + "더보기"(서랍 열기). 칸: 아이콘 20px 위·글자 11px 아래, 위아래 8px. 선택 mint-300 / 기본 zinc-500. 아래 여백 `env(safe-area-inset-bottom)`. |
| 묶음 안 페이지 | 상단 바 아래 가로 스크롤 알약 줄(좌우 16px, 위 12px, 간격 6px): `rounded-full border px-3 py-1.5 text-xs`, 선택 `border-mint-400/40 bg-mint-400/10 text-white`, 기본 `border-white/10 text-zinc-400`. |
| 상단 바 | 제목만 고정(말줄임). 페이지 도구는 바 아래 줄로 내려 본문과 함께 스크롤. |
| 본문 | 아래 여백 96px (하단 탭 가림 방지). |
| 하단 탭 묶음 이동 | 묶음을 누르면 그 묶음에서 **마지막으로 본 페이지**로 간다. |

---

## 9. 컴포넌트 클래스

정확한 CSS 는 부록 E. 모양 값은 모두 §5 변수를 읽는다.

| 클래스 | 용도 · 핵심 |
|---|---|
| `.surface` | 최상위 카드. `--card-*` + 효과 그림자·광원(§11). |
| `.surface-inset` | 카드 안 패널. `--inset-*`. |
| `.surface-interactive` | 누를 수 있는 카드. hover 시 `--card-hover-*`. |
| `.glass-pill` / `.pill-item` / `.pill-item-active` | 알약 그룹과 세그먼트 버튼(좌우 14px·위아래 6px·14px 글자). |
| `.btn-primary` | 주 행동. glass 에서는 흰색 세로 그라데이션 + 검정 글자, 알약형. |
| `.btn-ghost` | 보조 행동. 흰 14% 테두리 + 아주 옅은 바탕. |
| `.btn-danger` | 위험 행동. rose 25% 테두리 · 10% 바탕 · rose-200 글자. |
| `.btn-icon` | 32×32 아이콘 버튼. |
| `.input-field` · `select.input-field` · `.field-label` | 입력(좌우 14px·위아래 10px, 초점 시 강조색 50% 테두리 + 2px 15% 링) · 화살표 내장 셀렉트 · 12px 라벨. |
| `.chip` | 11px 고정폭 칩. |
| `.badge` · `.badge-new` | 상태 배지(11px, 원형) · "New" 표시. |
| `.icon-tile` (+`-mint` `-amber` `-sky`) | 40×40 아이콘 타일, 아래쪽 색 글로우. 작은 크기 32×32. |
| `.label-mono` · `.section-title` · `.num` | §4.2. |
| `.table-head` · `.table-row` | 11px 고정폭 대문자 머리글 · 아래 1px `white/5%` 행(hover `white/2.5%`). |
| `.divider-v` | 세로 1px `white/7%` 구분선. |
| `.hero-grain` | 대표 카드: 사선 광원 + 그레인 노이즈(SVG). |
| `.tab-card` / `.tab-card-active` | 큰 탭 카드, 선택 시 테두리를 도는 빛줄기(`@property --beam-angle`, 3.2s). |
| `.app-bg` · `.app-header` · `.app-sidebar` · `.nav-*` | 셸(§6). |
| `.toast-in` · `.focus-flash` | 토스트 등장 · 알림에서 이동했을 때 2.4s 강조 링. |

**자주 쓰는 조각**

- **토글(Switch)**: 36×20 알약. 켜짐 `border-mint-400/60 bg-mint-400/30` + 14px 손잡이 mint-300(왼쪽 18px), 꺼짐 `border-white/15 bg-white/[0.06]` + 손잡이 zinc-400(왼쪽 2px). `role="switch" aria-checked`.
- **설정 묶음(SettingsGroup)**: `.surface-inset p-4`, 머리(작은 아이콘 타일 + `.section-title` + 오른쪽 동작) 아래 12px 간격 내용.
- **설정 한 줄(SettingRow)**: 왼쪽 라벨 칸 112px(640px↑ 128px, 14px white + `.label-mono` 힌트) / 오른쪽 컨트롤 오른쪽 정렬. 라벨 폭을 고정해 슬라이더 시작점을 맞춘다.
- **모달**: `document.body` 로 포털. 배경막 `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm`, 바깥 클릭·Esc 로 닫기. 창은 `.surface` + 머리(아래 1px `white/8%`, 좌우 20px·위아래 14px) / 스크롤되는 몸통 / 바닥(위 1px `white/8%`, 오른쪽 버튼). `role="dialog" aria-modal="true"`. 모달 안 카드에는 효과(광원·입체감)를 덧입히지 않는다.

---

## 10. 모양 설정 창

사이드바 '모양 설정'으로 여는 창. 테마·카드 스타일·글꼴·효과를 고르면 **뒤쪽 화면에 바로 반영**되고 이 기기에 자동 저장된다.

```
┌ 모양 ───────────────────────────────────────────────────── (×) ┐
│ ┌───────────┐ │ ┌ [타일] 앱 테마 ───────────────────────────────┐ │
│ │ 앱 테마    │ │ │ 다크                                          │ │
│ ├───────────┤ │ │ [미리보기] 기본 (블랙·민트) │ [미리보기] 그라파이트·파랑 │ │
│ │ 카드 스타일 │ │ │ [미리보기] 그라파이트·주황 │ [미리보기] 모노크롬       │ │
│ ├───────────┤ │ │ …                                             │ │
│ │ 글꼴       │ │ │ 라이트                                        │ │
│ ├───────────┤ │ │ [미리보기] 라이트 (민트)   │ [미리보기] Solarized Light│ │
│ │ 효과       │ │ └───────────────────────────────────────────────┘ │
│ └───────────┘ │                                                   │
├────────────────────────────────────────────────────────────────┤
│ 변경 사항은 이 기기에 자동 저장됩니다       [↺ 기본값으로 되돌리기] [완료] │
└────────────────────────────────────────────────────────────────┘
```

| 부분 | 사양 |
|---|---|
| 창 | `.surface`, 최대 폭 **896px**(`max-w-4xl`), 최대 높이 85vh, 세로 배치. 바깥 여백 12px(640px↑ 24px). |
| 머리 | "모양"(16px semibold) + 닫기 `.btn-icon`. |
| 왼쪽 메뉴 (768px↑) | 폭 **192px**, 여백 12px, 오른쪽 1px `white/8%`. 섹션 버튼 세로 간격 8px: `rounded-xl px-3 py-2.5 text-sm text-left`. 선택 = `ring-1 ring-mint-400/60 bg-white/[0.06] text-white`, 기본 = `ring-1 ring-white/10 text-zinc-400 hover:bg-white/[0.04]`. |
| 왼쪽 메뉴 (768px 미만) | 위쪽 `.glass-pill` 세그먼트(4칸 같은 폭). |
| 섹션 | 앱 테마 · 카드 스타일 · 글꼴 · 효과. 몸통은 여백 16px(640px↑ 20px)로 스크롤. 각 섹션은 설정 묶음(§9). |
| 바닥 | 왼쪽 12px zinc-500 안내문, 오른쪽 `.btn-ghost`(rounded-xl, 되돌리기 아이콘 + "기본값으로 되돌리기") + `.btn-primary` "완료". |

**갤러리 항목 (공통)**

- 격자 1열(640px↑ 2열), 간격 8px. 항목은 `rounded-xl`, 선택 `ring-2 ring-mint-400 bg-mint-400/10`, 기본 `ring-1 ring-white/10 hover:bg-white/[0.04]`, `aria-pressed`.
- 묶음 제목(예: 다크 / 라이트)은 `.label-mono` + 아래 8px.

**앱 테마 미리보기 (64×40px 작은 창 그림)** — 항목: 여백 8px, 미리보기와 이름(14px white) 간격 12px.

```tsx
const bar = theme.surface ?? mix(theme.bg, theme.fg, 0.05);   // 제목 줄 색
const dim = mix(theme.bg, theme.fg, 0.35);                    // 꺼진 점 색
<div style={{ width: 64, height: 40, borderRadius: 6, overflow: 'hidden', background: theme.bg,
              boxShadow: `inset 0 0 0 1px ${mix(theme.bg, theme.fg, 0.15)}` }}>
  {/* 제목 줄 11px: 점 3개(4px, 간격 3px) — 강조색, 흐린 색, 흐린 색 */}
  <div style={{ height: 11, background: bar, display: 'flex', alignItems: 'center', gap: 3, padding: '0 6px' }}>
    <i style={{ width: 4, height: 4, borderRadius: 9999, background: theme.accent }} />
    <i style={{ width: 4, height: 4, borderRadius: 9999, background: dim }} />
    <i style={{ width: 4, height: 4, borderRadius: 9999, background: dim }} />
  </div>
  {/* 본문: 글자 줄 두 개(3px, 75%·55%, fg 불투명도 0.9·0.45) + 강조색 막대(4px, 30%) */}
  <div style={{ padding: '6px 6px 0' }}>
    <div style={{ height: 3, width: '75%', borderRadius: 9999, background: theme.fg, opacity: 0.9 }} />
    <div style={{ height: 3, width: '55%', borderRadius: 9999, background: theme.fg, opacity: 0.45, marginTop: 3 }} />
    <div style={{ height: 4, width: '30%', borderRadius: 9999, background: theme.accent, marginTop: 6 }} />
  </div>
</div>
```

**카드 스타일 미리보기 (88×56px)** — 항목 여백 10px. 미리보기 안에 `data-card="{id}"` 를 중첩해 진짜 클래스로 그린다: `.app-bg` 바탕(여백 8px, 간격 6px) 위에 왼쪽 `.surface` 하나, 오른쪽에 `.surface` + 높이 10px `.btn-primary` 막대. 오른쪽에 이름(14px medium white)과 설명(12px zinc-400, 두 줄 말줄임).

**글꼴** — 위쪽 견본 카드(`.surface p-4`: 라벨, 30px semibold 큰 숫자, 고정폭 보조 줄) → 본문 글꼴 목록 → 숫자·라벨 글꼴 목록(각 항목: `.label-mono` 이름 + 그 글꼴로 쓴 견본 문장) → '글자 크기' 3단계 슬라이더(15/16/17px).

**효과** — 카드 그라데이션 · 카드 입체감 · 커서 포인터/트레일 갤러리(§11). 각 묶음 머리 오른쪽에 켜기 토글, 적용 범위는 알약 세그먼트(대표 카드만 / 모든 카드), 수치는 슬라이더, 아래에 `.hero-grain` 견본 카드. 맨 아래 효과만 되돌리기(`.btn-ghost` 전체 폭, 원형).

**저장**: `localStorage` 한 키에 `{ settings, vars, attrs }` 를 저장하고, 읽을 때 값 범위를 다시 확인(clamp)한다. 모르는 테마·스타일 id 는 기본값으로.

---

## 11. 효과 (선택)

모두 기본은 꺼짐이다. 켜면 `<html>` 변수만 바뀌고 `.surface`/`.hero-grain` 이 그 변수를 읽는다.

**카드 그라데이션(광원)** — `--fx-glow-hero`(대표 카드), `--fx-glow-card`(범위가 '모든 카드'일 때). 범위: 세기 0~0.5, 크기 20~120%, 위치 x·y 0~100%.

```ts
const main = `radial-gradient(circle at ${x}% ${y}%, rgb(var(--c-mint-400) / ${intensity}) 0%, transparent ${size}%)`;
// '두 가지 색' 켜면 반대편에 sky 광원 추가 (세기 0.8배)
const sub  = `radial-gradient(circle at ${100 - x}% ${100 - y}%, rgb(var(--c-sky-400) / ${intensity * 0.8}) 0%, transparent ${size}%)`;
```

**카드 입체감** — `--fx-depth-hero` / `--fx-depth-card` 그림자를 카드 그림자 앞에 덧붙인다. 깊이 d·베벨 b 는 0~1, 마우스 기울기 0~12°, 떠오름 0~10px.

```ts
// 바깥 그림자 (d > 0)
`0 ${1 + 2*d}px ${2 + 4*d}px rgb(var(--c-shadow) / ${0.3*d})`,
`0 ${8 + 20*d}px ${16 + 40*d}px -${6 + 8*d}px rgb(var(--c-shadow) / ${0.75*d})`,
// 모서리 빛·그늘 (b > 0)
`inset 0 1px 0 rgb(255 255 255 / ${0.16*b})`,
`inset 0 -${1 + 2*b}px ${2 + 3*b}px rgb(var(--c-shadow) / ${0.4*b})`,
```

**커서** — 포인터 프리셋 5종(기본 커서 · 점과 링 · 속도 찌그러짐 · 크로스헤어 · 눈), 트레일 프리셋 5종(점 사슬 · 리본 · 픽셀 · 잔상 · 혜성). 장식 효과라 이식은 선택이다. 구현 소스는 `docs/DESIGN_SYSTEM.md` §8.

> 고정 창(`.fixed`, `[role="dialog"]`) 안에서는 `--fx-glow-card: none; --fx-depth-card: 0 0 #0000;` 로 효과를 끈다(부록 E).

---

## 12. 모션 · 접근성

| 항목 | 값 |
|---|---|
| 페이지 진입 | `fade-up` 0.45s `cubic-bezier(0.22, 1, 0.36, 1)` (아래 8px → 제자리) |
| 사이드바 접기 | 폭·본문 왼쪽 여백 300ms |
| 카드 hover | 300ms, 스타일별 transform(§5) |
| 토스트 | `toastIn` 0.28s (아래 12px → 제자리) |
| 알림 이동 강조 | `focusFlash` 2.4s 강조색 링 |
| 탭 빛줄기 | `beamSpin` 3.2s linear 무한 |
| 움직임 줄이기 | `prefers-reduced-motion: reduce` 이면 모든 애니메이션·전환 0.01ms, 빛줄기 정지(300° 위치) |

- 현재 페이지 `aria-current="page"`, 레일·아이콘 버튼은 `title`/`aria-label`.
- 모달 `role="dialog" aria-modal="true"`, Esc 로 닫기, 열릴 때 창에 초점.
- 갤러리·세그먼트 선택은 `aria-pressed`, 토글은 `role="switch" aria-checked`, 탭은 `role="tablist/tab/tabpanel"`.
- 초점 표시는 강조색 링(`mint-400/60`)으로 통일.

---

## 13. 이식 체크리스트

- [ ] 화면 코드에 hex·rgb 직접 쓰지 않기 — 토큰(`text-zinc-400`, `bg-white/[0.04]`, `rgb(var(--c-…))`)만.
- [ ] 강조색은 `mint-*` 이름 하나로만 (테마가 실제 색을 정함).
- [ ] 모양(반경·테두리·그림자)은 `--card-*` 등 변수로 — 컴포넌트에 `rounded-2xl shadow-xl` 같은 고정값 금지(예외: 미리보기 등 의도적인 경우).
- [ ] 숫자는 `.num`, 보조 라벨은 `.label-mono`.
- [ ] 렌더 전에 테마 적용(깜빡임 방지), 설정은 기기에 저장.
- [ ] 셸 치수: 사이드바 208/64/256px, 상단 바 56px~, 본문 최대 1536px, 목록-상세 분할 900px, 모바일 768px.
- [ ] 아이콘은 각 앱의 세트로 — 메뉴 16px, 하단 탭 20px, 선 굵기 1.75, `currentColor`.
- [ ] 라이트 테마 3종에서도 대비 확인 (`--c-white` 가 어두운 글자가 된다).
- [ ] `prefers-reduced-motion` 규칙 포함.

---

## 부록 A. 테마 생성 코드 `themes.ts`

`frontend/src/appearance/themes.ts`

```ts
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
```

## 부록 B. 기본·라이트 테마 계산 결과 (CSS 변수)

Tailwind 나 TypeScript 없이 쓰려면 아래 값을 그대로 CSS 에 넣으면 된다. 다른 테마는 부록 A 로 계산한다. 주석은 같은 색의 hex.

```css
:root, [data-theme='default'] {
  --c-white: 255 255 255; /* #ffffff */
  --c-black: 0 0 0; /* #000000 */
  --c-paper: 255 255 255; /* #ffffff */
  --c-shadow: 0 0 0; /* #000000 */
  --c-ink-500: 56 56 57; /* #383839 */
  --c-ink-600: 38 38 39; /* #262627 */
  --c-ink-700: 27 27 28; /* #1b1b1c */
  --c-ink-800: 20 20 21; /* #141415 */
  --c-ink-850: 15 15 16; /* #0f0f10 */
  --c-ink-900: 10 10 11; /* #0a0a0b */
  --c-ink-950: 6 6 7; /* #060607 */
  --c-surface: 13 13 14; /* #0d0d0e */
  --c-zinc-50: 248 248 248; /* #f8f8f8 */
  --c-zinc-100: 235 235 235; /* #ebebeb */
  --c-zinc-200: 215 215 215; /* #d7d7d7 */
  --c-zinc-300: 185 185 186; /* #b9b9ba */
  --c-zinc-400: 155 155 156; /* #9b9b9c */
  --c-zinc-500: 118 118 119; /* #767677 */
  --c-zinc-600: 88 88 89; /* #585859 */
  --c-zinc-700: 61 61 62; /* #3d3d3e */
  --c-zinc-800: 41 41 42; /* #29292a */
  --c-zinc-900: 26 26 27; /* #1a1a1b */
  --c-zinc-950: 16 16 17; /* #101011 */
  --c-mint-50: 236 250 243; /* #ecfaf3 */
  --c-mint-100: 219 246 233; /* #dbf6e9 */
  --c-mint-200: 193 240 217; /* #c1f0d9 */
  --c-mint-300: 161 232 198; /* #a1e8c6 */
  --c-mint-400: 125 223 176; /* #7ddfb0 */
  --c-mint-500: 111 197 156; /* #6fc59c */
  --c-mint-600: 95 169 134; /* #5fa986 */
  --c-mint-700: 77 136 108; /* #4d886c */
  --c-mint-800: 60 104 83; /* #3c6853 */
  --c-mint-900: 42 71 58; /* #2a473a */
  --c-mint-950: 27 45 37; /* #1b2d25 */
  --c-amber-50: 254 245 222; /* #fef5de */
  --c-amber-100: 254 237 194; /* #feedc2 */
  --c-amber-200: 253 224 150; /* #fde096 */
  --c-amber-300: 252 209 97; /* #fcd161 */
  --c-amber-400: 251 191 36; /* #fbbf24 */
  --c-amber-500: 222 169 33; /* #dea921 */
  --c-amber-600: 190 145 29; /* #be911d */
  --c-amber-700: 153 117 24; /* #997518 */
  --c-amber-800: 116 89 20; /* #745914 */
  --c-amber-900: 80 62 16; /* #503e10 */
  --c-amber-950: 50 39 12; /* #32270c */
  --c-rose-50: 254 234 237; /* #feeaed */
  --c-rose-100: 254 215 221; /* #fed7dd */
  --c-rose-200: 253 187 196; /* #fdbbc4 */
  --c-rose-300: 252 153 167; /* #fc99a7 */
  --c-rose-400: 251 113 133; /* #fb7185 */
  --c-rose-500: 222 100 118; /* #de6476 */
  --c-rose-600: 190 86 102; /* #be5666 */
  --c-rose-700: 153 70 83; /* #994653 */
  --c-rose-800: 116 54 64; /* #743640 */
  --c-rose-900: 80 38 45; /* #50262d */
  --c-rose-950: 50 25 30; /* #32191e */
  --c-emerald-50: 225 248 240; /* #e1f8f0 */
  --c-emerald-100: 198 243 226; /* #c6f3e2 */
  --c-emerald-200: 158 234 206; /* #9eeace */
  --c-emerald-300: 109 223 182; /* #6ddfb6 */
  --c-emerald-400: 52 211 153; /* #34d399 */
  --c-emerald-500: 46 186 135; /* #2eba87 */
  --c-emerald-600: 41 160 117; /* #29a075 */
  --c-emerald-700: 34 129 95; /* #22815f */
  --c-emerald-800: 27 98 73; /* #1b6249 */
  --c-emerald-900: 20 68 51; /* #144433 */
  --c-emerald-950: 14 43 33; /* #0e2b21 */
  --c-sky-50: 225 245 254; /* #e1f5fe */
  --c-sky-100: 199 237 253; /* #c7edfd */
  --c-sky-200: 159 223 252; /* #9fdffc */
  --c-sky-300: 112 207 250; /* #70cffa */
  --c-sky-400: 56 189 248; /* #38bdf8 */
  --c-sky-500: 50 167 219; /* #32a7db */
  --c-sky-600: 44 143 188; /* #2c8fbc */
  --c-sky-700: 36 116 152; /* #247498 */
  --c-sky-800: 28 88 115; /* #1c5873 */
  --c-sky-900: 21 61 79; /* #153d4f */
  --c-sky-950: 15 39 50; /* #0f2732 */
  --c-orange-50: 254 239 226; /* #feefe2 */
  --c-orange-100: 254 224 200; /* #fee0c8 */
  --c-orange-200: 253 203 161; /* #fdcba1 */
  --c-orange-300: 252 177 115; /* #fcb173 */
  --c-orange-400: 251 146 60; /* #fb923c */
  --c-orange-500: 222 129 54; /* #de8136 */
  --c-orange-600: 190 111 47; /* #be6f2f */
  --c-orange-700: 153 90 39; /* #995a27 */
  --c-orange-800: 116 69 31; /* #74451f */
  --c-orange-900: 80 48 23; /* #503017 */
  --c-orange-950: 50 31 17; /* #321f11 */
  --shadow-k: 1;
  color-scheme: dark;
}

[data-theme='light'] {
  --c-white: 17 17 19; /* #111113 */
  --c-black: 255 255 255; /* #ffffff */
  --c-paper: 255 255 255; /* #ffffff */
  --c-shadow: 85 85 87; /* #555557 */
  --c-ink-500: 199 199 201; /* #c7c7c9 */
  --c-ink-600: 214 215 217; /* #d6d7d9 */
  --c-ink-700: 225 226 228; /* #e1e2e4 */
  --c-ink-800: 232 232 234; /* #e8e8ea */
  --c-ink-850: 236 237 239; /* #ecedef */
  --c-ink-900: 240 241 243; /* #f0f1f3 */
  --c-ink-950: 244 245 247; /* #f4f5f7 */
  --c-surface: 255 255 255; /* #ffffff */
  --c-zinc-50: 24 24 26; /* #18181a */
  --c-zinc-100: 35 35 37; /* #232325 */
  --c-zinc-200: 53 53 55; /* #353537 */
  --c-zinc-300: 81 81 83; /* #515153 */
  --c-zinc-400: 108 108 110; /* #6c6c6e */
  --c-zinc-500: 142 142 144; /* #8e8e90 */
  --c-zinc-600: 169 170 172; /* #a9aaac */
  --c-zinc-700: 194 195 197; /* #c2c3c5 */
  --c-zinc-800: 212 213 215; /* #d4d5d7 */
  --c-zinc-900: 226 227 229; /* #e2e3e5 */
  --c-zinc-950: 235 236 238; /* #ebecee */
  --c-mint-50: 17 38 33; /* #112621 */
  --c-mint-100: 16 57 44; /* #10392c */
  --c-mint-200: 16 85 63; /* #10553f */
  --c-mint-300: 16 119 85; /* #107755 */
  --c-mint-400: 15 159 110; /* #0f9f6e */
  --c-mint-500: 42 169 126; /* #2aa97e */
  --c-mint-600: 72 181 144; /* #48b590 */
  --c-mint-700: 107 193 165; /* #6bc1a5 */
  --c-mint-800: 141 206 185; /* #8dceb9 */
  --c-mint-900: 175 219 206; /* #afdbce */
  --c-mint-950: 203 230 222; /* #cbe6de */
  --c-amber-50: 39 33 21; /* #272115 */
  --c-amber-100: 58 47 22; /* #3a2f16 */
  --c-amber-200: 87 69 24; /* #574518 */
  --c-amber-300: 121 95 27; /* #795f1b */
  --c-amber-400: 162 125 30; /* #a27d1e */
  --c-amber-500: 172 139 56; /* #ac8b38 */
  --c-amber-600: 183 155 84; /* #b79b54 */
  --c-amber-700: 195 173 117; /* #c3ad75 */
  --c-amber-800: 207 191 149; /* #cfbf95 */
  --c-amber-900: 219 209 182; /* #dbd1b6 */
  --c-amber-950: 229 223 208; /* #e5dfd0 */
  --c-rose-50: 39 26 30; /* #271a1e */
  --c-rose-100: 58 34 39; /* #3a2227 */
  --c-rose-200: 87 46 53; /* #572e35 */
  --c-rose-300: 121 60 70; /* #793c46 */
  --c-rose-400: 162 77 90; /* #a24d5a */
  --c-rose-500: 172 97 109; /* #ac616d */
  --c-rose-600: 183 119 129; /* #b77781 */
  --c-rose-700: 195 144 153; /* #c39099 */
  --c-rose-800: 207 169 176; /* #cfa9b0 */
  --c-rose-900: 219 195 200; /* #dbc3c8 */
  --c-rose-950: 229 215 219; /* #e5d7db */
  --c-emerald-50: 20 35 31; /* #14231f */
  --c-emerald-100: 23 51 42; /* #17332a */
  --c-emerald-200: 28 75 59; /* #1c4b3b */
  --c-emerald-300: 33 103 79; /* #21674f */
  --c-emerald-400: 39 137 102; /* #278966 */
  --c-emerald-500: 64 150 119; /* #409677 */
  --c-emerald-600: 90 164 138; /* #5aa48a */
  --c-emerald-700: 121 180 160; /* #79b4a0 */
  --c-emerald-800: 152 196 182; /* #98c4b6 */
  --c-emerald-900: 183 213 204; /* #b7d5cc */
  --c-emerald-950: 207 226 221; /* #cfe2dd */
  --c-sky-50: 21 33 40; /* #152128 */
  --c-sky-100: 24 47 59; /* #182f3b */
  --c-sky-200: 29 68 87; /* #1d4457 */
  --c-sky-300: 34 94 121; /* #225e79 */
  --c-sky-400: 41 124 161; /* #297ca1 */
  --c-sky-500: 65 139 171; /* #418bab */
  --c-sky-600: 92 154 183; /* #5c9ab7 */
  --c-sky-700: 122 172 195; /* #7aacc3 */
  --c-sky-800: 153 191 208; /* #99bfd0 */
  --c-sky-900: 183 209 221; /* #b7d1dd */
  --c-sky-950: 207 223 232; /* #cfdfe8 */
  --c-orange-50: 39 29 23; /* #271d17 */
  --c-orange-100: 58 39 26; /* #3a271a */
  --c-orange-200: 87 55 31; /* #57371f */
  --c-orange-300: 121 75 37; /* #794b25 */
  --c-orange-400: 162 97 44; /* #a2612c */
  --c-orange-500: 172 115 68; /* #ac7344 */
  --c-orange-600: 183 134 95; /* #b7865f */
  --c-orange-700: 195 156 125; /* #c39c7d */
  --c-orange-800: 207 178 156; /* #cfb29c */
  --c-orange-900: 219 201 186; /* #dbc9ba */
  --c-orange-950: 229 218 210; /* #e5dad2 */
  --shadow-k: 0.18;
  color-scheme: light;
}
```

## 부록 C. Tailwind 설정 `tailwind.config.js`

`frontend/tailwind.config.js`

```js
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
```

## 부록 D. 카드 스타일 `card-styles.css` 전문

`frontend/src/styles/card-styles.css`

```css
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
  --sidebar-bg: rgb(var(--c-ink-950) / 0.35);
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

## 부록 E. 컴포넌트 클래스 `index.css` 전문

`frontend/src/index.css`

```css
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

  /* 왼쪽 사이드바 (components/shell/Sidebar.tsx) */
  .app-sidebar {
    background: var(--sidebar-bg, rgb(var(--c-ink-900) / 0.88));
    border-right: 1px solid rgb(var(--c-white) / 0.07);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }
  .nav-group-label {
    @apply mb-1.5 mt-5 px-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600;
  }
  .nav-item {
    @apply relative flex h-9 w-full items-center gap-2.5 px-2.5 text-left text-sm text-zinc-400 transition-colors;
    border-radius: var(--input-radius);
    border: 1px solid transparent;
  }
  .nav-item:hover {
    @apply text-zinc-100;
    background: rgb(var(--c-white) / 0.04);
  }
  .nav-item:focus-visible {
    outline: 2px solid rgb(var(--c-mint-400) / 0.6);
    outline-offset: 1px;
  }
  .nav-item-active,
  .nav-item-active:hover {
    @apply text-white;
    background: rgb(var(--c-mint-400) / 0.1);
    border-color: rgb(var(--c-mint-400) / 0.28);
  }
  .nav-item-active .nav-item-icon {
    @apply text-mint-400;
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
