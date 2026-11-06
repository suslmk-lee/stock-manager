// 릴리스 본문(마크다운 일부)을 업데이트 창에 맞게 보여 준다.
// 본문은 scripts/release-notes.sh 가 "## vX.Y.Z · 날짜" 단락으로 만들며, 지금 버전보다 새 단락만 보여 준다.

type Block =
  | { kind: 'version'; version: string; rest: string }
  | { kind: 'heading'; text: string }
  | { kind: 'item'; text: string }
  | { kind: 'text'; text: string };

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)/;

function versionKey(v: string | undefined | null): number[] | null {
  const m = VERSION_RE.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function newer(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// 굵게·코드·링크 표시를 걷어 낸 글자만
function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

/** 본문을 블록으로 나누고, 지금 버전(current)보다 새 버전 단락만 남긴다 */
export function parseReleaseNotes(md: string, current?: string): Block[] {
  const cur = versionKey(current);
  const blocks: Block[] = [];
  let keep = true;
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\*\*Full Changelog\*\*/i.test(line)) continue; // GitHub 자동 노트의 비교 링크
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2 && !line.startsWith('###')) {
      const title = inline(h2[1]);
      const v = versionKey(title);
      keep = !(v && cur) || newer(v, cur);
      if (keep) {
        const m = VERSION_RE.exec(title);
        blocks.push(m ? { kind: 'version', version: m[0].startsWith('v') ? m[0] : `v${m[0]}`, rest: title.slice(m[0].length).replace(/^[\s·-]+/, '') } : { kind: 'heading', text: title });
      }
      continue;
    }
    if (!keep) continue;
    const h3 = /^#{3,6}\s+(.*)$/.exec(line);
    if (h3) blocks.push({ kind: 'heading', text: inline(h3[1]) });
    else if (/^[-*+]\s+/.test(line)) blocks.push({ kind: 'item', text: inline(line.replace(/^[-*+]\s+/, '')) });
    else blocks.push({ kind: 'text', text: inline(line) });
  }
  return blocks;
}

export default function ReleaseNotes({ notes, current }: { notes?: string; current?: string }) {
  const blocks = parseReleaseNotes(notes ?? '', current);
  if (blocks.length === 0) return <p className="text-sm text-zinc-400">릴리스 노트가 없습니다.</p>;

  // 연속된 항목은 한 목록으로 묶는다
  const out: JSX.Element[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="list-disc space-y-1 pl-4 marker:text-zinc-600">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  blocks.forEach((b, i) => {
    if (b.kind === 'item') {
      items.push(b.text);
      return;
    }
    flush();
    if (b.kind === 'version') {
      out.push(
        <div key={i} className={`flex items-baseline gap-2 ${out.length > 0 ? 'mt-4 border-t border-white/[0.07] pt-3' : ''}`}>
          <span className="num text-sm font-semibold text-white">{b.version}</span>
          {b.rest && <span className="label-mono">{b.rest}</span>}
        </div>,
      );
    } else if (b.kind === 'heading') {
      out.push(
        <p key={i} className="label-mono mt-2.5 !text-mint-300">
          {b.text}
        </p>,
      );
    } else {
      out.push(<p key={i}>{b.text}</p>);
    }
  });
  flush();

  return <div className="space-y-1.5 text-sm leading-relaxed text-zinc-300">{out}</div>;
}
