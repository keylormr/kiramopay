import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { getApiLayer } from '@/api';
import { soltarAvisosAlSalir } from '@/utils/avisosPush';
import {
  registerTokenProvider,
  registerRefreshHandler,
  registerAuthFailureHandler,
  registerAccountBlockedHandler,
  type ResultadoRefresco,
} from '@/api/adapters/http/client';
import { syncAllData } from '@/services/dataSync';
import { clasificarIdentificador } from '@/utils/identificador';
import { limpiarDatosDeUsuario } from '@/stores/limpiarDatosDeUsuario';
import { olvidarUltimoAcceso } from '@/stores/olvidarUltimoAcceso';
import { clearLockPin } from '@/services/lockKdf';
import { secureTokenStore } from '@/services/secureTokenStore';

// With a real backend the session is restored on cold start from the HttpOnly
// refresh cookie (see bootstrap), so isAuthenticated must NOT be persisted. In
// mock mode there is no cookie, so it stays persisted as before.
const hasBackend = !!import.meta.env.VITE_API_URL;

// Respuestas de POST /auth/refresh que SI dicen que la sesion no sirve
// (backend/internal/auth/handler.go, RefreshToken): 401 REFRESH_FAILED (token
// vencido, revocado o reusado), 403 ACCOUNT_BLOCKED y 400 INVALID_BODY (no hay
// cookie ni token que presentar). Todo lo demas —sin red, un 429 que el
// navegador entrega como fallo de red, un 5xx mientras el servidor despierta—
// es pasajero: la sesion puede seguir viva, y cerrarla por eso mandaba al login
// sin explicacion a quien solo recargo la pagina.
const RECHAZOS_DEFINITIVOS_DE_SESION = new Set(['REFRESH_FAILED', 'ACCOUNT_BLOCKED', 'INVALID_BODY']);

function esRechazoDefinitivo(codigo: string | undefined): boolean {
  return RECHAZOS_DEFINITIVOS_DE_SESION.has(codigo ?? 'REFRESH_FAILED');
}

/**
 * Esperas entre reintentos de la restauracion ante un fallo pasajero. Acotadas:
 * suman 10,5 s, por debajo del tope de 25 s de la pantalla de arranque
 * (App.tsx) cuando los fallos son rapidos (sin red, 429).
 */
export const ESPERAS_REINTENTO_RESTAURACION_MS = [1500, 3000, 6000] as const;

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

// Una sola restauracion a la vez. Dos refresh simultaneos presentan la misma
// cookie: el segundo llega con un token ya rotado, el backend lo toma por reuso
// y revoca la familia entera de la sesion.
let restauracionEnCurso: Promise<void> | null = null;

// Cambia con cada entrada o salida explicita. Una restauracion que termina
// despues de un login no debe pisar la sesion nueva con su resultado.
let generacionDeSesion = 0;

interface RegisterParams {
  cedula: string;
  /** Nombre de usuario elegido. Opcional: sin el, la cuenta no tiene uno. */
  username?: string;
  phone: string;
  firstName: string;
  lastName: string;
  password: string;
  email?: string;
  verificationToken?: string;
  /** Codigo de invitacion de otro usuario; solo viaja si el invitado lo tiene. */
  referralCode?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isOnboarded: boolean;
  // Non-PII flag: a session existed on this device, so attempt a cookie-based
  // restore on cold start. Lets us use this — instead of the persisted PII
  // profile — as the "there is a session to restore" signal.
  sessionHint: boolean;
  user: User | null;
  // Tokens are kept in memory only — never persisted. localStorage is too
  // easily exfiltrated via XSS for tokens of an actively-authenticated
  // session. Persistence here is only profile + the onboarded flag.
  accessToken: string | null;
  refreshToken: string | null;
  // Por que se cerro la ultima sesion sin que el usuario lo pidiera. Vive solo
  // en memoria (fuera de partialize): el aviso se muestra una vez, en la
  // pantalla de login que sigue a la expulsion, y no debe resucitar en una
  // recarga ni heredarse al siguiente usuario del dispositivo.
  logoutReason: 'blocked' | null;
  /**
   * Como va la restauracion de la sesion al arrancar. Vive solo en memoria.
   * - 'normal': nada que avisar.
   * - 'reintentando': el refresh fallo por algo pasajero y se esta reintentando.
   * - 'sin_conexion': se agotaron los reintentos sin una respuesta definitiva.
   *   La sesion NO se cerro (sessionHint sigue en pie) y el login lo explica.
   */
  restauracion: 'normal' | 'reintentando' | 'sin_conexion';

  login:(identificador: string, password: string) => Promise<{ success: boolean; code?: string }>;
  register: (params: RegisterParams) => Promise<{ success: boolean; error?: string; code?: string }>;
  loginWithUser: (user: User) => void;
  logout: () => void;
  /**
   * Silently rotate the token pair using the in-memory refresh token. Dice si
   * la sesion se renovo, si el servidor la rechazo o si el fallo fue pasajero
   * (ver ResultadoRefresco en el cliente HTTP).
   */
  refresh: () => Promise<ResultadoRefresco>;
  /**
   * Cold-start session restore: exchange the HttpOnly refresh cookie for a fresh
   * access token. Called once on app boot. If there is no valid cookie the
   * refresh fails and the user stays logged out (clean login screen) — this is
   * what replaces the persisted "phantom" authenticated flag.
   *
   * Solo una respuesta definitiva del servidor cierra la sesion. Ante un fallo
   * pasajero reintenta con esperas acotadas y, si no se recupera, deja
   * `restauracion: 'sin_conexion'` sin tocar la sesion. Llamarla de nuevo
   * mientras corre devuelve la misma promesa.
   */
  bootstrap: () => Promise<void>;
  /** Descarta el aviso de sesion sin confirmar (el usuario lo cerro). */
  descartarAvisoRestauracion: () => void;
  /**
   * Clear the session locally without a backend call (refresh already failed).
   * `reason` marca por que: 'blocked' cuando un administrador bloqueo la cuenta.
   */
  forceLogout: (reason?: 'blocked') => void;
  /** Descarta el aviso de expulsion (el usuario lo cerro). */
  clearLogoutReason: () => void;
  completeOnboarding: () => void;
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      isOnboarded: false,
      sessionHint: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      logoutReason: null,
      restauracion: 'normal',

      login: async (identificador, password) => {
        // Un solo campo: cedula, correo o telefono. Se clasifica y canonicaliza
        // aca para que TODO login (manual, quick-login, biometrico) pase por
        // las mismas reglas que el backend.
        const clasificado = clasificarIdentificador(identificador);
        if (!clasificado) {
          return { success: false, code: 'INVALID_IDENTIFIER' };
        }
        const api = getApiLayer();
        const result = await api.auth.login({
          identifier: clasificado.canonico,
          // Alias legado solo cuando ES cedula: cubre la ventana en la que el
          // frontend nuevo habla con un backend que aun no conoce identifier.
          ...(clasificado.tipo === 'cedula' ? { cedula: clasificado.canonico } : {}),
          password,
        });
        if (result.success && result.data) {
          // Antes de hidratar la sesion nueva, vaciar lo que hubiera quedado
          // de un usuario anterior en este dispositivo: sin esto, sus datos
          // persistidos se mostraban hasta que el sync los pisara.
          limpiarDatosDeUsuario();
          generacionDeSesion++;
          set({
            isAuthenticated: true,
            isOnboarded: true,
            sessionHint: true,
            user: result.data.user,
            accessToken: result.data.tokens?.access_token ?? null,
            refreshToken: result.data.tokens?.refresh_token ?? null,
            // Entro alguien: el aviso de la expulsion anterior ya no aplica,
            // ni el de la sesion que no se pudo confirmar.
            logoutReason: null,
            restauracion: 'normal',
          });
          // On native, stash the refresh token in OS secure storage (no-op on
          // web, where the HttpOnly cookie is the transport).
          secureTokenStore.setRefreshToken(result.data.tokens?.refresh_token ?? null);
          syncAllData().catch(() => {});
          return { success: true };
        }
        // Surface the failure code so the UI can tell "wrong password" apart
        // from "rate limited" (429) and similar.
        return { success: false, code: result.error?.code };
      },

      register: async ({ cedula, username, phone, firstName, lastName, password, email, verificationToken, referralCode }) => {
        const api = getApiLayer();
        const result = await api.auth.register({ cedula, username, phone, firstName, lastName, password, email, verificationToken, referralCode });
        if (result.success && result.data) {
          // Cuenta recien creada en un dispositivo posiblemente compartido:
          // arrancar sin residuos del usuario anterior.
          limpiarDatosDeUsuario();
          generacionDeSesion++;
          set({
            isAuthenticated: true,
            isOnboarded: true,
            sessionHint: true,
            user: result.data.user,
            accessToken: result.data.tokens?.access_token ?? null,
            refreshToken: result.data.tokens?.refresh_token ?? null,
            restauracion: 'normal',
          });
          secureTokenStore.setRefreshToken(result.data.tokens?.refresh_token ?? null);
          syncAllData().catch(() => {});
          return { success: true };
        }
        // El codigo viaja igual que en login: la UI distingue un codigo de
        // invitacion inexistente del error generico.
        return { success: false, error: result.error?.message || 'Error al registrar', code: result.error?.code };
      },

      loginWithUser: (user) => {
        set({
          isAuthenticated: true,
          isOnboarded: true,
          user,
        });
      },

      logout: () => {
        // Antes que el cierre en el servidor: la baja de los avisos de este
        // dispositivo sale con el token todavia vivo.
        soltarAvisosAlSalir();
        // Best-effort backend revocation; never block UX on it.
        const api = getApiLayer();
        api.auth.logout?.().catch(() => {});
        clearLockPin();
        secureTokenStore.clear();
        // La sesion termina: los datos del usuario no le pertenecen al
        // dispositivo. Vaciar los stores persistidos (cuentas, SINPE,
        // historial, cripto, notificaciones) para que el proximo usuario de
        // este navegador no herede nada.
        limpiarDatosDeUsuario();
        generacionDeSesion++;
        set({
          isAuthenticated: false,
          sessionHint: false,
          user: null,
          accessToken: null,
          refreshToken: null,
          restauracion: 'normal',
        });
      },

      refresh: async () => {
        const { refreshToken } = get();
        if (!refreshToken) return 'rechazada';
        const generacion = generacionDeSesion;
        const api = getApiLayer();
        const result = await api.auth.refresh(refreshToken);
        // Alguien salio o entro mientras tanto: estos tokens no son de la
        // sesion que esta abierta ahora.
        if (generacion !== generacionDeSesion) return 'descartada';
        if (result.success && result.data?.access_token) {
          const rotado = result.data.refresh_token ?? refreshToken;
          set({
            accessToken: result.data.access_token,
            refreshToken: rotado,
          });
          // En el telefono el token rotado tambien va al almacen seguro: el
          // servidor ya consumio el anterior, y el proximo arranque que lo
          // presentara seria tomado por reuso y cerraria la sesion.
          secureTokenStore.setRefreshToken(rotado);
          return 'renovada';
        }
        // Solo un rechazo definitivo cierra la sesion; sin red, un 429 o un 5xx
        // la dejan abierta (el cliente reintenta y avisa).
        if (result.error?.code === 'ACCOUNT_BLOCKED') return 'bloqueada';
        return esRechazoDefinitivo(result.error?.code) ? 'rechazada' : 'pasajero';
      },

      forceLogout: (reason) => {
        clearLockPin();
        secureTokenStore.clear();
        // Igual que en logout: sesion invalidada (401 sin refresh posible)
        // implica soltar los datos del usuario, no solo los tokens.
        limpiarDatosDeUsuario();
        // SOLO cuando la cuenta perdio el acceso de verdad. forceLogout es
        // tambien el manejador generico de 401 cuyo refresco falla, y el
        // servidor corta por inactividad a los 30 minutos: sin esta condicion,
        // dejar la aplicacion en segundo plano media hora borraba la tarjeta de
        // acceso rapido y la credencial de la huella, y habia que teclear la
        // contrasena completa y volver a configurarla. Una sesion que vence no
        // es una cuenta revocada: la credencial guardada sigue sirviendo.
        if (reason === 'blocked') {
          olvidarUltimoAcceso();
          // El servidor ya borro las suscripciones al bloquear; esto corta la
          // del navegador. Una sesion que solo vencio conserva sus avisos: es
          // justamente cuando la app esta cerrada que sirven.
          soltarAvisosAlSalir(false);
        }
        // Sin tocar generacionDeSesion: forceLogout tambien atiende cualquier
        // 401 suelto, y uno que llegue durante el arranque no debe anular una
        // restauracion que si funciono.
        set({
          isAuthenticated: false,
          sessionHint: false,
          user: null,
          accessToken: null,
          refreshToken: null,
          logoutReason: reason ?? null,
          restauracion: 'normal',
        });
      },

      clearLogoutReason: () => {
        set({ logoutReason: null });
      },

      bootstrap: () => {
        if (restauracionEnCurso) return restauracionEnCurso;

        const restaurar = async () => {
          const generacion = generacionDeSesion;
          const sigueVigente = () => generacion === generacionDeSesion;
          // Un reintento pedido desde el aviso del login se ve de inmediato.
          if (get().restauracion === 'sin_conexion') set({ restauracion: 'reintentando' });

          const api = getApiLayer();
          // Web: the refresh token rides in the HttpOnly cookie (sent automatically
          // on same-origin requests) and the empty argument is ignored. Native: no
          // cookie applies, so we pass the token read from OS secure storage. No
          // valid token either way => failure => logged out.
          const stored = await secureTokenStore.getRefreshToken();
          let result = await api.auth.refresh(stored ?? '');

          // Reintentos solo ante un fallo pasajero. Si un intento vencio por
          // tiempo despues de que el servidor roto el token, el reintento
          // presenta el viejo y el servidor responde REFRESH_FAILED: el mismo
          // final que tendria el proximo arranque, no uno peor.
          for (const espera of ESPERAS_REINTENTO_RESTAURACION_MS) {
            if (result.success || esRechazoDefinitivo(result.error?.code)) break;
            set({ restauracion: 'reintentando' });
            await esperar(espera);
            if (!sigueVigente()) return;
            result = await api.auth.refresh(stored ?? '');
          }
          // Alguien entro o salio mientras tanto: esa sesion manda.
          if (!sigueVigente()) return;

          if (result.success && result.data?.access_token) {
            // Set tokens first so the profile fetch below is authenticated.
            set({
              accessToken: result.data.access_token,
              refreshToken: result.data.refresh_token ?? null,
            });
            // Persist the rotated refresh token on native (no-op on web).
            secureTokenStore.setRefreshToken(result.data.refresh_token ?? null);
            // The profile (PII) is not persisted with a backend — re-fetch it now
            // that we have a valid session, then flip authenticated with the user
            // already in place (no null-user window for the UI).
            const profile = await api.auth.getProfile();
            if (!sigueVigente()) return;
            set({
              isAuthenticated: true,
              isOnboarded: true,
              sessionHint: true,
              restauracion: 'normal',
              ...(profile.success && profile.data ? { user: profile.data } : {}),
            });
            syncAllData().catch(() => {});
            return;
          }

          if (!result.success && !esRechazoDefinitivo(result.error?.code)) {
            // Sin respuesta definitiva: la sesion puede seguir viva. Se
            // conserva sessionHint para que el proximo arranque lo vuelva a
            // intentar, y el login explica lo que paso con un boton para
            // reintentar.
            set({ isAuthenticated: false, accessToken: null, refreshToken: null, restauracion: 'sin_conexion' });
            return;
          }

          // Stale/absent cookie: clear the restore hint so the next cold start
          // goes straight to login instead of retrying a dead session. Una
          // cuenta bloqueada lo dice en el login, igual que a mitad de sesion.
          set({
            isAuthenticated: false,
            sessionHint: false,
            accessToken: null,
            refreshToken: null,
            restauracion: 'normal',
            ...(result.error?.code === 'ACCOUNT_BLOCKED' ? { logoutReason: 'blocked' as const } : {}),
          });
        };

        restauracionEnCurso = restaurar().finally(() => {
          restauracionEnCurso = null;
        });
        return restauracionEnCurso;
      },

      descartarAvisoRestauracion: () => {
        if (get().restauracion === 'sin_conexion') set({ restauracion: 'normal' });
      },

      completeOnboarding: () => {
        set({ isOnboarded: true });
      },

      changePassword: async (oldPassword, newPassword) => {
        const { user } = get();
        if (!user?.cedula) return false;
        const api = getApiLayer();
        const result = await api.auth.changePassword({
          cedula: user.cedula,
          oldPassword,
          newPassword,
        });
        return Boolean(result.success && result.data?.changed);
      },
    }),
    {
      name: 'kiramopay-auth',
      partialize: (state) => ({
        // Note: tokens are intentionally NOT persisted. PIN/biometric path
        // is the local re-auth; password is the cold-start re-auth.
        isOnboarded: state.isOnboarded,
        // Non-PII signal that gates the boot-time cookie restore (replaces the
        // persisted profile that used to double as this flag).
        sessionHint: state.sessionHint,
        // The profile (cedula/phone/email = PII) is NOT persisted with a backend:
        // bootstrap() re-fetches it from GET /users/me after the cookie refresh.
        // isAuthenticated is likewise derived from that refresh, never persisted
        // (persisting it was the phantom session that flashed "logged in"). In
        // mock mode (no cookie/backend to re-fetch from) keep both so a reload
        // stays logged in.
        ...(hasBackend ? {} : { user: state.user, isAuthenticated: state.isAuthenticated }),
      }),
      // Sanitize what rehydrates: a localStorage written by an OLDER build still
      // has isAuthenticated:true. With a backend that stale flag must be ignored
      // — otherwise on boot the app fires authenticated data calls with no token
      // (401 storm) and a refresh (helping trip the auth rate limit → 429) before
      // bootstrap() runs. The session is proven only by bootstrap's cookie refresh.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthState>;
        return {
          ...current,
          ...p,
          isAuthenticated: hasBackend ? false : (p.isAuthenticated ?? false),
        };
      },
    },
  ),
);

// ────────────────────────────────────────────────────────────────────────
// Wire the HttpClient to this store. Must happen at module level (not
// inside `create`) so that importing this file ALWAYS registers the
// provider before the first authenticated request fires. The closure
// reads `useAuthStore.getState()` lazily on each invocation.
// ────────────────────────────────────────────────────────────────────────
registerTokenProvider(() => {
  const s = useAuthStore.getState();
  return { accessToken: s.accessToken, refreshToken: s.refreshToken };
});

// On a 401 the HttpClient asks the store to rotate the token pair; if the
// server rejects it for good (no/invalid refresh token) it forces a logout so
// the UI stops showing a phantom authenticated session. Un fallo pasajero no
// cierra nada: el cliente reintenta y devuelve un error que se puede leer.
registerRefreshHandler(() => useAuthStore.getState().refresh());
registerAuthFailureHandler(() => useAuthStore.getState().forceLogout());
// 403 ACCOUNT_BLOCKED en una peticion autenticada: la sesion ya no existe en
// el backend; se cierra localmente y el login explica el motivo.
registerAccountBlockedHandler(() => useAuthStore.getState().forceLogout('blocked'));
