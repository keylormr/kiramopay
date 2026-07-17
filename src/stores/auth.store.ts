import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { getApiLayer } from '@/api';
import {
  registerTokenProvider,
  registerRefreshHandler,
  registerAuthFailureHandler,
} from '@/api/adapters/http/client';
import { syncAllData } from '@/services/dataSync';
import { clearLockPin } from '@/services/lockKdf';
import { secureTokenStore } from '@/services/secureTokenStore';

// With a real backend the session is restored on cold start from the HttpOnly
// refresh cookie (see bootstrap), so isAuthenticated must NOT be persisted. In
// mock mode there is no cookie, so it stays persisted as before.
const hasBackend = !!import.meta.env.VITE_API_URL;

interface RegisterParams {
  cedula: string;
  phone: string;
  firstName: string;
  lastName: string;
  password: string;
  email?: string;
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

  login: (cedula: string, password: string) => Promise<{ success: boolean; code?: string }>;
  register: (params: RegisterParams) => Promise<{ success: boolean; error?: string }>;
  loginWithUser: (user: User) => void;
  logout: () => void;
  /** Silently rotate the token pair using the in-memory refresh token. */
  refresh: () => Promise<boolean>;
  /**
   * Cold-start session restore: exchange the HttpOnly refresh cookie for a fresh
   * access token. Called once on app boot. If there is no valid cookie the
   * refresh fails and the user stays logged out (clean login screen) — this is
   * what replaces the persisted "phantom" authenticated flag.
   */
  bootstrap: () => Promise<void>;
  /** Clear the session locally without a backend call (refresh already failed). */
  forceLogout: () => void;
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

      login: async (cedula, password) => {
        const api = getApiLayer();
        const result = await api.auth.login({ cedula, password });
        if (result.success && result.data) {
          set({
            isAuthenticated: true,
            isOnboarded: true,
            sessionHint: true,
            user: result.data.user,
            accessToken: result.data.tokens?.access_token ?? null,
            refreshToken: result.data.tokens?.refresh_token ?? null,
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

      register: async ({ cedula, phone, firstName, lastName, password, email }) => {
        const api = getApiLayer();
        const result = await api.auth.register({ cedula, phone, firstName, lastName, password, email });
        if (result.success && result.data) {
          set({
            isAuthenticated: true,
            isOnboarded: true,
            sessionHint: true,
            user: result.data.user,
            accessToken: result.data.tokens?.access_token ?? null,
            refreshToken: result.data.tokens?.refresh_token ?? null,
          });
          secureTokenStore.setRefreshToken(result.data.tokens?.refresh_token ?? null);
          syncAllData().catch(() => {});
          return { success: true };
        }
        return { success: false, error: result.error?.message || 'Error al registrar' };
      },

      loginWithUser: (user) => {
        set({
          isAuthenticated: true,
          isOnboarded: true,
          user,
        });
      },

      logout: () => {
        // Best-effort backend revocation; never block UX on it.
        const api = getApiLayer();
        api.auth.logout?.().catch(() => {});
        clearLockPin();
        secureTokenStore.clear();
        set({
          isAuthenticated: false,
          sessionHint: false,
          user: null,
          accessToken: null,
          refreshToken: null,
        });
      },

      refresh: async () => {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        const api = getApiLayer();
        const result = await api.auth.refresh(refreshToken);
        if (result.success && result.data?.access_token) {
          set({
            accessToken: result.data.access_token,
            refreshToken: result.data.refresh_token ?? refreshToken,
          });
          return true;
        }
        return false;
      },

      forceLogout: () => {
        clearLockPin();
        secureTokenStore.clear();
        set({
          isAuthenticated: false,
          sessionHint: false,
          user: null,
          accessToken: null,
          refreshToken: null,
        });
      },

      bootstrap: async () => {
        const api = getApiLayer();
        // Web: the refresh token rides in the HttpOnly cookie (sent automatically
        // on same-origin requests) and the empty argument is ignored. Native: no
        // cookie applies, so we pass the token read from OS secure storage. No
        // valid token either way => failure => logged out.
        const stored = await secureTokenStore.getRefreshToken();
        const result = await api.auth.refresh(stored ?? '');
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
          set({
            isAuthenticated: true,
            isOnboarded: true,
            sessionHint: true,
            ...(profile.success && profile.data ? { user: profile.data } : {}),
          });
          syncAllData().catch(() => {});
        } else {
          // Stale/absent cookie: clear the restore hint so the next cold start
          // goes straight to login instead of retrying a dead session.
          set({ isAuthenticated: false, sessionHint: false, accessToken: null, refreshToken: null });
        }
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

// On a 401 the HttpClient asks the store to rotate the token pair; if that
// fails (no/invalid refresh token, e.g. after a page reload) it forces a
// logout so the UI stops showing a phantom authenticated session.
registerRefreshHandler(() => useAuthStore.getState().refresh());
registerAuthFailureHandler(() => useAuthStore.getState().forceLogout());
