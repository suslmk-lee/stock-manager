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
        <div className="label-mono">총 자산</div>
        <div className="mt-1 text-3xl font-semibold tracking-tight text-white">₩152,257,659</div>
        <div className="num label-mono mt-2">USD/KRW 1,325.4</div>
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
          <div className="label-mono">총 자산 평가액</div>
          <div className="mt-1 text-2xl font-light tracking-tight text-white">₩101,485,514</div>
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
          <div className="label-mono">총 자산 평가액</div>
          <div className="mt-1 text-2xl font-light tracking-tight text-white">₩101,485,514</div>
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
