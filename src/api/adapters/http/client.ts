import { ApiResponse, apiError, apiErrorConDetalle } from '../../types';
import type { ArchivoDescargado } from '../../types';
// Ningun texto visible nace aqui: el cliente pone el CODIGO y el mensaje sale
// del diccionario del idioma activo (ver i18n/mensajesDeError.ts).
import { mensajeDelCliente, mensajeDelServidor, traducirFueraDeReact } from '@/i18n/mensajesDeError';

// In-memory token holders. The auth store registers a provider after login
// so the HttpClient can read the current access token without going through
// localStorage. Persisting JWTs in localStorage was the Phase 20 footgun —
// XSS could exfiltrate the whole session. Keeping them here means a refresh
// of the page logs the user out (acceptable for a fintech UX) but a script
// injection cannot read them out-of-band.
type TokenProvider = () => { accessToken: string | null; refreshToken: string | null };

let tokenProvider: TokenProvider = () => ({ accessToken: null, refreshToken: null });

/**
 * Wire the HttpClient to read tokens from a live source (e.g. zustand store).
 * Called once from the auth store during app boot.
 */
export function registerTokenProvider(p: TokenProvider): void {
  tokenProvider = p;
}

// Refresh-on-401 wiring. The auth store registers a handler that exchanges the
// in-memory refresh token for a fresh pair, and a failure handler that forces a
// logout when refresh is impossible. Both are optional (mock mode leaves them
// unset, so behaviour is unchanged).

/**
 * Lo que paso al intentar renovar la sesion a mitad de uso.
 * - 'renovada': hay tokens nuevos; la peticion se repite.
 * - 'rechazada': el servidor dijo que la sesion no sirve (REFRESH_FAILED, sin
 *   token). Solo esto cierra la sesion.
 * - 'bloqueada': un administrador bloqueo la cuenta; se cierra y el login dice
 *   por que.
 * - 'pasajero': no hubo respuesta definitiva (sin red, 429, 5xx). La sesion
 *   puede seguir viva: se reintenta y, si no se recupera, la persona sigue
 *   dentro con un aviso.
 * - 'descartada': alguien entro o salio mientras tanto; ese resultado ya no
 *   aplica a la sesion actual.
 */
export type ResultadoRefresco = 'renovada' | 'rechazada' | 'bloqueada' | 'pasajero' | 'descartada';

type RefreshHandler = () => Promise<ResultadoRefresco>;
type AuthFailureHandler = () => void;

let refreshHandler: RefreshHandler | null = null;
let authFailureHandler: AuthFailureHandler | null = null;
// A single in-flight refresh shared by all concurrent 401s, so a burst of
// expired requests triggers exactly ONE refresh call (no rotation storm). Los
// reintentos por un fallo pasajero viven DENTRO de esa promesa: diez 401 a la
// vez esperan la misma serie, no diez series.
let refreshInFlight: Promise<ResultadoRefresco> | null = null;

/**
 * Esperas entre reintentos de la renovacion ante un fallo pasajero. Acotadas
 * para que quien toco un boton no quede colgado: un 429 del limite de refresh
 * se despeja en su ventana de un minuto, asi que esperar mas no lo arreglaria.
 */
export const ESPERAS_REINTENTO_REFRESCO_MS = [1000, 3000] as const;

/**
 * Tope de tiempo para empezar otro reintento. Cada intento puede tardar hasta
 * los 20 s del corte de fetch: si el primero ya se fue por tiempo, reintentar
 * dos veces mas dejaria la pantalla un minuto esperando.
 */
export const PRESUPUESTO_REINTENTO_REFRESCO_MS = 10_000;

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export function registerRefreshHandler(h: RefreshHandler): void {
  refreshHandler = h;
}

export function registerAuthFailureHandler(h: AuthFailureHandler): void {
  authFailureHandler = h;
}

// Remote block: an admin blocked the account while a session was open. The
// backend answers 403 ACCOUNT_BLOCKED (distinct from 401 SESSION_REVOKED) so
// the UI can say WHY it kicked the user out instead of a generic "expired".
type AccountBlockedHandler = () => void;

let accountBlockedHandler: AccountBlockedHandler | null = null;

export function registerAccountBlockedHandler(h: AccountBlockedHandler): void {
  accountBlockedHandler = h;
}

// Solo un objeto de verdad cuenta como detalle: el stub de E2E y un proxy que
// responda HTML no deben colar un arreglo o un texto donde la vista espera
// {plan, limite, actuales}.
function detallesDe(json: unknown): Record<string, unknown> | undefined {
  const d = (json as { error?: { details?: unknown } } | null)?.error?.details;
  return typeof d === 'object' && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : undefined;
}

// filename="reporte-2026-09-07-a-2026-09-13.csv" -> reporte-2026-09-07-a-2026-09-13.csv
function nombreDeDisposicion(valor: string | null): string {
  const m = valor ? /filename="?([^";]+)"?/i.exec(valor) : null;
  return m ? m[1].trim() : '';
}

function dedupedRefresh(): Promise<ResultadoRefresco> {
  const handler = refreshHandler;
  if (!handler) return Promise.resolve('rechazada');
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const inicio = Date.now();
      let resultado = await handler();
      for (const espera of ESPERAS_REINTENTO_REFRESCO_MS) {
        if (resultado !== 'pasajero') break;
        if (Date.now() - inicio + espera > PRESUPUESTO_REINTENTO_REFRESCO_MS) break;
        await esperar(espera);
        resultado = await handler();
      }
      return resultado;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * La respuesta de una peticion cuyo 401 no se pudo resolver renovando.
 *
 * Antes cualquier fallo de la renovacion cerraba la sesion: un parpadeo de la
 * red o un 429 a mitad de uso mandaba a la persona al login sin explicacion.
 * Ahora solo un rechazo definitivo la cierra; ante uno pasajero la persona
 * sigue dentro y la pantalla recibe un error que dice que reintente.
 */
function sinSesionRenovada<T>(resultado: Exclude<ResultadoRefresco, 'renovada'>): ApiResponse<T> {
  switch (resultado) {
    case 'pasajero':
      return apiError<T>('SESSION_UNCONFIRMED', mensajeDelCliente('SESSION_UNCONFIRMED'));
    case 'bloqueada':
      // El mismo camino que un 403 ACCOUNT_BLOCKED: cierre con el motivo.
      if (accountBlockedHandler) accountBlockedHandler();
      else if (authFailureHandler) authFailureHandler();
      return apiError<T>('ACCOUNT_BLOCKED', traducirFueraDeReact('login_account_blocked'));
    case 'rechazada':
      if (authFailureHandler) authFailureHandler();
      return apiError<T>('SESSION_EXPIRED', mensajeDelCliente('SESSION_EXPIRED'));
    case 'descartada':
      // La sesion que hizo esta peticion ya no es la actual: ni se repite con
      // los tokens de otra ni se cierra la que esta abierta.
      return apiError<T>('SESSION_EXPIRED', mensajeDelCliente('SESSION_EXPIRED'));
  }
}

export class HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getToken(): string | null {
    return tokenProvider().accessToken;
  }

  /** No-op kept for back-compat with callers that still invoke this. */
  setTokens(_accessToken: string, _refreshToken: string): void {
    // Intentionally empty — tokens are owned by the auth store, in memory.
  }

  /** No-op kept for back-compat. */
  clearTokens(): void {
    // Intentionally empty.
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
    isRetry = false,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    if (auth) {
      const token = this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    // Cota de espera: fetch no tiene timeout propio y una peticion contra un
    // backend dormido (Render Free tarda 30-90s en despertar) o una red movil
    // estancada colgaba a quien esperara la respuesta — el peor caso era el
    // arranque en frio del APK: esqueleto gris eterno. 20s cubre el despertar
    // tipico sin dejar la UI rehen; el abort cae al catch como NETWORK_ERROR.
    const abortador = new AbortController();
    const temporizador = setTimeout(() => abortador.abort(), 20000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        // Send the HttpOnly refresh cookie so the BFF session-restore works
        // regardless of same-origin vs cross-origin deployment (backend CORS
        // sets Access-Control-Allow-Credentials: true).
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
        signal: abortador.signal,
      });

      // Access token expired/revoked: try ONE silent refresh, then replay the
      // request. Solo un rechazo definitivo de la renovacion cierra la sesion
      // (ver sinSesionRenovada).
      if (res.status === 401 && auth && !isRetry && refreshHandler) {
        const resultado = await dedupedRefresh();
        if (resultado === 'renovada') {
          return this.request<T>(method, path, body, auth, true, extraHeaders);
        }
        return sinSesionRenovada<T>(resultado);
      }

      if (res.status === 204) {
        return { success: true } as ApiResponse<T>;
      }

      // Rate limited: surface a distinct code so the UI doesn't mistake it for
      // bad credentials, and don't try to parse a possibly non-JSON body.
      if (res.status === 429) {
        return apiError<T>('RATE_LIMITED', mensajeDelCliente('RATE_LIMITED'));
      }

      const json = await res.json();

      if (!res.ok) {
        const code = json.error?.code || 'HTTP_ERROR';
        // Blocked mid-session: the backend already revoked every session, so a
        // refresh would only fail with the same answer. Only for authenticated
        // calls — the login's own 403 is handled by the login view.
        if (auth && res.status === 403 && code === 'ACCOUNT_BLOCKED' && accountBlockedHandler) {
          accountBlockedHandler();
        }
        return apiError<T>(
          code,
          mensajeDelServidor(res.status, code, json.error?.message),
          // `data` viaja como HERMANO de `error` en el envelope (ver
          // ErrorWithData en backend/pkg/response/response.go), nunca anidado
          // dentro de error — APIError no tiene campo Data.
          json.data,
          // `details` si viaja DENTRO de error (ErrorConDetalle).
          detallesDe(json),
        );
      }

      return {
        success: true,
        data: json.data,
      };
    } catch {
      return apiError<T>('NETWORK_ERROR', mensajeDelCliente('NETWORK_ERROR'));
    } finally {
      clearTimeout(temporizador);
    }
  }

  async get<T>(path: string, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, undefined, auth);
  }

  /**
   * GET de un archivo. Con 200 entrega el cuerpo tal cual (sin pasarlo por
   * JSON) y el nombre del Content-Disposition. Con cualquier otro estado el
   * servidor responde el sobre de error de siempre, y ese SI se lee como JSON:
   * sin eso un 403 PLAN_REQUIRED se descargaria como si fuera el reporte.
   */
  async getArchivo(path: string, isRetry = false): Promise<ApiResponse<ArchivoDescargado>> {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const abortador = new AbortController();
    const temporizador = setTimeout(() => abortador.abort(), 20000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: abortador.signal,
      });

      if (res.status === 401 && !isRetry && refreshHandler) {
        const resultado = await dedupedRefresh();
        if (resultado === 'renovada') return this.getArchivo(path, true);
        return sinSesionRenovada<ArchivoDescargado>(resultado);
      }
      if (res.status === 429) {
        return apiError('RATE_LIMITED', mensajeDelCliente('RATE_LIMITED'));
      }
      if (res.status !== 200) {
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          // Un cuerpo que no es JSON (una pagina de error de un proxy) no trae
          // codigo: queda el generico con el estado.
        }
        const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
        const code = err?.code || 'HTTP_ERROR';
        return apiErrorConDetalle(code, mensajeDelServidor(res.status, code, err?.message), detallesDe(json));
      }

      const blob = await res.blob();
      return { success: true, data: { blob, nombre: nombreDeDisposicion(res.headers.get('Content-Disposition')) } };
    } catch {
      return apiError('NETWORK_ERROR', mensajeDelCliente('NETWORK_ERROR'));
    } finally {
      clearTimeout(temporizador);
    }
  }

  async post<T>(
    path: string,
    body?: unknown,
    auth = true,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body, auth, false, extraHeaders);
  }

  async patch<T>(path: string, body?: unknown, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body, auth);
  }

  async put<T>(path: string, body?: unknown, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body, auth);
  }

  async del<T>(path: string, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, undefined, auth);
  }
}
