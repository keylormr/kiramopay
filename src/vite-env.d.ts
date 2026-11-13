/// <reference types="vite/client" />

// Inyectadas en tiempo de build por el `define` de vite.config.ts (y replicadas
// en vitest.config.ts, que no extiende esa configuración).
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;

interface ImportMetaEnv {
  /** Llave de API de Breez (gratis). Sin ella, bitcoin en la billetera propia queda sin configurar. */
  readonly VITE_BREEZ_API_KEY?: string;
  /** Dominio propio para las direcciones de cobro (por ejemplo pay.kiramopay.com), ya dado de alta con Breez. */
  readonly VITE_BREEZ_LNURL_DOMAIN?: string;
  /** Nodos propios para la billetera propia; sin ellos se usan los publicos de viem. */
  readonly VITE_RPC_ETHEREUM?: string;
  readonly VITE_RPC_POLYGON?: string;
  readonly VITE_RPC_AVALANCHE?: string;
}
