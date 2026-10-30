import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAppearance } from '../../appearance/AppearanceContext';
import { THEMES, mix, type AppTheme } from '../../appearance/themes';
import Portal from '../ui/Portal';
import {
  CARD_STYLES,
  SANS_FONTS,
  MONO_FONTS,
  FONT_SIZES,
  type FontOption,
} from '../../appearance/options';

type Section = 'theme' | 'card' | 'font';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'theme', label: '앱 테마' },
  { id: 'card', label: '카드 스타일' },
  { id: 'font', label: '글꼴' },
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
    <div className="mb-5">
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
    <>
      <ThemeGroup title="다크" themes={THEMES.filter((t) => t.mode === 'dark')} />
      <ThemeGroup title="라이트" themes={THEMES.filter((t) => t.mode === 'light')} />
    </>
  );
}

function CardSection() {
  const { settings, update } = useAppearance();
  return (
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
  return (
    <div className="space-y-6">
      <div className="surface-inset p-4">
        <div className="label-mono">총 자산</div>
        <div className="mt-1 text-3xl font-semibold tracking-tight text-white">₩152,257,659</div>
        <div className="num label-mono mt-2">USD/KRW 1,325.4</div>
      </div>
      <div>
        <div className="section-title mb-2">본문 글꼴</div>
        <FontList fonts={SANS_FONTS} value={settings.sansFont} onSelect={(id) => update({ sansFont: id })} />
      </div>
      <div>
        <div className="section-title mb-2">숫자 · 라벨 글꼴 (고정폭)</div>
        <FontList fonts={MONO_FONTS} value={settings.monoFont} onSelect={(id) => update({ monoFont: id })} />
      </div>
      <div>
        <div className="section-title mb-2">글자 크기</div>
        <div className="glass-pill inline-flex p-1 gap-1">
          {FONT_SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => update({ fontSize: s.id })}
              className={`pill-item ${settings.fontSize === s.id ? 'pill-item-active' : ''}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
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
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-white/[0.08]">
            <span className="text-xs text-zinc-500">변경 사항은 이 기기에 자동 저장됩니다</span>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost" onClick={reset}>
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
