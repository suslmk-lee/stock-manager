import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// 사이드바에 표시할 앱 버전. git 태그 기준(예: v1.0.0-156-g10e52f4),
// git 을 쓸 수 없는 환경이면 wails.json 의 productVersion 을 쓴다.
function appVersion(): string {
  // 릴리스 빌드(scripts/build-dmg.sh, GitHub Actions)는 APP_VERSION 으로 정확한 버전을 넘긴다
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return execSync('git describe --tags --always --dirty', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    try {
      const wails = JSON.parse(readFileSync(path.resolve(__dirname, '../wails.json'), 'utf8'));
      return wails?.info?.productVersion ? `v${wails.info.productVersion}` : 'dev';
    } catch {
      return 'dev';
    }
  }
}

export default defineConfig(({ mode }) => {
  const isWebBuild = !!process.env.VITE_API_URL;

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion()),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    server: {
      port: 3000,
    },
    build: {
      outDir: 'dist',
      copyPublicDir: true,
    },
    publicDir: 'images',
    resolve: {
      alias: isWebBuild
        ? {
            '../../wailsjs/go/main/App': path.resolve(__dirname, 'src/api/wails-stub.ts'),
            '../../wailsjs/runtime/runtime': path.resolve(__dirname, 'src/api/wails-runtime-stub.ts'),
          }
        : {},
    },
  };
});
