/// <reference types="vite/client" />

// Inyectadas en tiempo de build por el `define` de vite.config.ts (y replicadas
// en vitest.config.ts, que no extiende esa configuración).
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;
