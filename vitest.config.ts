import fs from 'fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
) as { version: string };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Este archivo no extiende vite.config.ts, así que hay que repetir aquí los
  // globales de build: sin esto, cualquier test que llegue a config/version.ts
  // falla con "__APP_VERSION__ is not defined". El commit y la fecha van fijos
  // para que los tests sean deterministas.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify('test'),
    __BUILD_DATE__: JSON.stringify('1970-01-01T00:00:00.000Z'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
