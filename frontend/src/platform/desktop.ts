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
