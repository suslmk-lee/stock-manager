// 빌드 때 vite.config.ts 가 `git describe --tags --always --dirty` 결과와 빌드 시각을 넣는다.
// 예: "v1.0.0-156-g10e52f4" → 태그 v1.0.0, 그 뒤 커밋 156개, 커밋 10e52f4

export interface AppVersion {
  raw: string;
  tag: string | null;
  ahead: number;
  commit: string | null;
  dirty: boolean;
}

export function parseAppVersion(raw: string): AppVersion {
  let s = raw.trim();
  const dirty = s.endsWith('-dirty');
  if (dirty) s = s.slice(0, -'-dirty'.length);

  const described = s.match(/^(.+)-(\d+)-g([0-9a-f]{4,40})$/);
  if (described) return { raw, tag: described[1], ahead: Number(described[2]), commit: described[3], dirty };
  if (/^[0-9a-f]{7,40}$/.test(s)) return { raw, tag: null, ahead: 0, commit: s, dirty }; // 태그가 하나도 없을 때
  return { raw, tag: s || null, ahead: 0, commit: null, dirty }; // 태그 위에 정확히 있거나 git 없이 빌드
}

export const APP_VERSION = parseAppVersion(__APP_VERSION__);
export const BUILD_TIME = __BUILD_TIME__ ? new Date(__BUILD_TIME__) : null;

/** 사이드바에 펼쳐서 보이는 버전 (예: v1.0.0+156) */
export function versionLabel(v: AppVersion = APP_VERSION): string {
  return `${v.tag ?? 'dev'}${v.ahead > 0 ? `+${v.ahead}` : ''}`;
}

/** 접힌 사이드바용 짧은 버전 (예: v1.0) */
export function versionShortLabel(v: AppVersion = APP_VERSION): string {
  return v.tag ? v.tag.replace(/^(v?\d+\.\d+).*$/, '$1') : 'dev';
}

export function versionTooltip(v: AppVersion = APP_VERSION, built: Date | null = BUILD_TIME): string {
  const lines = [`버전 ${v.raw}`];
  if (v.ahead > 0 && v.tag) lines.push(`${v.tag} 이후 커밋 ${v.ahead}개`);
  if (built && !Number.isNaN(built.getTime())) {
    lines.push(`빌드 ${built.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
  }
  if (v.dirty) lines.push('커밋되지 않은 변경이 포함된 빌드');
  return lines.join('\n');
}
