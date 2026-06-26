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
  user: User | null;
  // Tokens are kept in memory only — never persisted. localStorage is too
  // easily exfiltrated via XSS for tokens of an actively-authenticated
  // session. Persistence here is only profile + the onboarded flag.
  accessToken: string | null;
  refreshToken: string | null;

  login: (cedula: string, password: string) => Promise<boolean>;
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
            user: result.data.user,
            accessToken: result.data.tokens?.access_token ?? null,
            refreshToken: result.data.tokens?.refresh_token ?? null,
          });
          syncAllData().catch(() => {});
          return true;
        }
        return false;
      },

      register: async ({ cedula, phone, firstName, lastName, password, email }) => {
        const api = getApiLayer();
        const result = await api.auth.register({ cedula, phone, firstName, lastName, password, email });
        if (result.success && result.data) {
          set({
            isAuthenticated: true,
            isOnboarded: true,
            user: result.data.user,
            accessToken: result.data.tokens?.access_token ?? null,
            refreshToken: result.data.tokens?.refresh_token ?? null,
          });
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
        set({
          isAuthenticated: false,
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
        set({
          isAuthenticated: false,
          user: null,
          accessToken: null,
          refreshToken: null,
        });
      },

      bootstrap: async () => {
        const api = getApiLayer();
        // The refresh token rides in the HttpOnly cookie (sent automatically on
        // same-origin requests); the empty body argument is ignored when the
        // cookie is present. No cookie / invalid token => failure => logged out.
        const result = await api.auth.refresh('');
        if (result.success && result.data?.access_token) {
          set({
            isAuthenticated: true,
            isOnboarded: true,
            accessToken: result.data.access_token,
            refreshToken: result.data.refresh_token ?? null,
          });
          syncAllData().catch(() => {});
        } else {
          set({ isAuthenticated: false, accessToken: null, refreshToken: null });
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
        user: state.user,
        // With a backend, isAuthenticated is derived from the boot-time cookie
        // refresh (bootstrap), never persisted — persisting it was the phantom
        // session that flashed "logged in" then bounced to login. In mock mode
        // (no cookie) keep persisting it so a refresh stays logged in.
        ...(hasBackend ? {} : { isAuthenticated: state.isAuthenticated }),
      }),
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
