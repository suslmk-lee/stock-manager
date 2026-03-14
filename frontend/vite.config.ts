import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isWebBuild = !!process.env.VITE_API_URL;

  return {
    plugins: [react()],
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
        ? { '../../wailsjs/go/main/App': path.resolve(__dirname, 'src/api/wails-stub.ts') }
        : {},
    },
  };
});
