// Dirección de la API, resuelta en un solo lugar.
//
// Mientras Vercel reescribía /api hacia el servicio de Render, la variable
// VITE_API_URL valía "/" y todo era del mismo origen. Ese rewrite ya no existe:
// una base relativa hoy cae en el catch-all del SPA y devuelve index.html en vez
// de JSON, así que el valor viejo dejó de significar lo que decía.
//
// Traducirlo aquí al host real evita que el despliegue dependa del orden en que
// se toquen el repositorio y el panel de Vercel: si la variable todavía no se
// actualizó, la aplicación sigue funcionando igual.

/** Valor que usaba la configuración cuando la API se servía por el rewrite. */
const VALOR_PROXY_ANTIGUO = '/';

/** Host propio de la API. */
export const API_URL = 'https://api.kiramopay.com';

/**
 * Base de la API para las llamadas HTTP. Cadena vacía cuando no hay backend
 * configurado, que es lo que activa el modo simulado en desarrollo.
 */
export function resolveApiBaseUrl(): string {
  const configurado = (import.meta.env.VITE_API_URL || '').trim();
  if (!configurado) return '';
  if (configurado === VALOR_PROXY_ANTIGUO) return API_URL;
  return configurado.replace(/\/+$/, '');
}

/** Base para WebSocket, derivada de la misma dirección. */
export function resolveWsBaseUrl(): string {
  const base = resolveApiBaseUrl();
  return base ? base.replace(/^http/, 'ws') : '';
}
