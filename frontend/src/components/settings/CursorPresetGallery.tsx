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
      <div className="flex h-20 w-full items-center justify-center rounded-lg bg-ink-900 ring-1 ring-white/5">{children}</div>
      <span className="truncate px-1 text-xs text-white">{name}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label-mono mb-2 uppercase tracking-widest">{label}</div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
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
