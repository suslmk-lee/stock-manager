/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// vite.config.ts 의 define 으로 빌드 때 채워진다
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;