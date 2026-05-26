import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { getApiLayer } from '@/api';
import { registerTokenProvider } from '@/api/adapters/http/client';
import { syncAllData } from '@/services/dataSync';
import { clearLockPin } from '@/services/lockKdf';

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
        isAuthenticated: state.isAuthenticated,
        isOnboarded: state.isOnboarded,
        user: state.user,
      }),
    },
  ),
);

// ────────────────────────────────────────────────────────────────────────
// Wire the HttpClient to this store. Must happen at module level (not
// inside `create`) so that importing this file ALWAYS registers the
// provider before the first authenticated request fires. The closure
// reads `useAuthStore.getState()` lazily on each invocation.
//
// Diagnostic log left intentionally (debug-only): if you see this in the
// console you know the wiring fired. Remove once stable.
// ────────────────────────────────────────────────────────────────────────
registerTokenProvider(() => {
  const s = useAuthStore.getState();
  return { accessToken: s.accessToken, refreshToken: s.refreshToken };
});
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.debug('[auth.store] token provider registered');
}
