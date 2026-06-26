import { Capacitor } from '@capacitor/core';

// On native (Capacitor) the WebView calls the API cross-origin, so the HttpOnly
// session cookie used on the web does not apply (RFC 8252 — native apps use the
// OS secure store). There the refresh token is kept in the Android Keystore /
// iOS Keychain (AES-GCM) via @aparajita/capacitor-secure-storage. On the web
// every method is a no-op: the cookie is the transport and JS must never hold
// the refresh token.
const REFRESH_KEY = 'kp_refresh';

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// The plugin is imported dynamically and only on native, so the web bundle never
// loads it and a missing/!synced native module can't break the web build.
async function plugin() {
  const mod = await import('@aparajita/capacitor-secure-storage');
  return mod.SecureStorage;
}

export const secureTokenStore = {
  /** Returns the stored refresh token on native, or null on web / when absent. */
  async getRefreshToken(): Promise<string | null> {
    if (!isNative()) return null;
    try {
      return await (await plugin()).getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },

  /** Persists (or, with null, removes) the refresh token on native; no-op on web. */
  async setRefreshToken(token: string | null): Promise<void> {
    if (!isNative()) return;
    try {
      const store = await plugin();
      if (token) {
        await store.setItem(REFRESH_KEY, token);
      } else {
        await store.removeItem(REFRESH_KEY);
      }
    } catch {
      // Best-effort: a secure-storage failure must never break the auth flow.
    }
  },

  /** Clears the stored refresh token on native; no-op on web. */
  async clear(): Promise<void> {
    await this.setRefreshToken(null);
  },
};
