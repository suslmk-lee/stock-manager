// 데스크톱 브리지 — 디자인 코드는 네이티브 기능을 이 파일로만 부른다.
// 웹(아무것도 안 함) · Wails(window.go) · Tauri v2(window.__TAURI__ / __TAURI_INTERNALS__) 를 실행 중에 감지한다.

type Shell = 'web' | 'wails' | 'tauri';

/** 앱 업데이트 확인 결과 (Go updater.CheckResult) */
export interface UpdateInfo {
  supported: boolean; // 버전을 알 수 있는 빌드인지 (개발 빌드는 false)
  current: string;
  latest?: string;
  available: boolean;
  can_install: boolean; // 앱 안에서 바로 설치할 수 있는지
  notes?: string;
  url?: string;
  published_at?: string;
  asset_name?: string;
  asset_size?: number;
  reason?: string;
  checked_at: string;
}

/** 설치 진행 상황 (phase: download | extract | verify | restart) */
export interface UpdateProgress {
  phase: 'download' | 'extract' | 'verify' | 'restart';
  percent: number;
}

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
interface WailsApp {
  SetTitleBarColors?: (background: string, text: string, dark: boolean) => Promise<void>;
  CheckForUpdate?: () => Promise<UpdateInfo>;
  InstallUpdate?: () => Promise<void>;
  OpenReleasePage?: (url: string) => Promise<void>;
}
interface DesktopGlobals {
  go?: { main?: { App?: WailsApp } };
  runtime?: { EventsOn?: (name: string, cb: (...data: unknown[]) => void) => (() => void) | void };
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

const wailsApp = () => g().go?.main?.App;

export const desktop = {
  /** 제목 표시줄 배경·글자색(#rrggbb)과 어두운 모드 여부. 지원하지 않는 환경이면 조용히 무시한다. */
  async setTitleBarColors(background: string, text: string, dark: boolean): Promise<void> {
    try {
      const shell = detectShell();
      if (shell === 'tauri') {
        await tauriInvoke()?.('set_title_bar_colors', { background, text, dark });
      } else if (shell === 'wails') {
        await wailsApp()?.SetTitleBarColors?.(background, text, dark);
      }
    } catch {
      // 지원하지 않는 OS·버전이면 기본 제목 표시줄 그대로 둔다
    }
  },

  /** 앱 업데이트를 쓸 수 있는 환경인지 (데스크톱 앱이고 업데이트 기능이 있는 빌드) */
  updatesSupported(): boolean {
    return detectShell() === 'wails' && typeof wailsApp()?.CheckForUpdate === 'function';
  },

  async checkForUpdate(): Promise<UpdateInfo> {
    const fn = wailsApp()?.CheckForUpdate;
    if (!fn) throw new Error('이 환경에서는 업데이트를 확인할 수 없습니다');
    return fn();
  },

  /** 새 버전을 내려받아 설치하고 앱을 다시 시작한다 (성공하면 곧 앱이 종료된다) */
  async installUpdate(): Promise<void> {
    const fn = wailsApp()?.InstallUpdate;
    if (!fn) throw new Error('이 환경에서는 자동 설치를 할 수 없습니다');
    await fn();
  },

  async openReleasePage(url: string): Promise<void> {
    const fn = wailsApp()?.OpenReleasePage;
    if (fn) await fn(url);
    else window.open(url, '_blank', 'noopener');
  },

  /** 설치 진행 상황을 받는다. 반환값으로 구독을 끊는다. */
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void {
    const off = g().runtime?.EventsOn?.('update:progress', (p: unknown) => cb(p as UpdateProgress));
    return typeof off === 'function' ? off : () => {};
  },
};
