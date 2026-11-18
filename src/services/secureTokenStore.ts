import { Capacitor } from '@capacitor/core';
import { conAlmacen } from './almacenSeguro';

// On native (Capacitor) the WebView calls the API cross-origin, so the HttpOnly
// session cookie used on the web does not apply (RFC 8252 — native apps use the
// OS secure store). There the refresh token is kept in the Android Keystore /
// iOS Keychain (AES-GCM) via @aparajita/capacitor-secure-storage. On the web
// every method is a no-op: the cookie is the transport and JS must never hold
// the refresh token.
//
// The plugin is only ever used inside conAlmacen() and never returned: it is a
// Capacitor Proxy that answers to "then", so awaiting it hangs (see
// almacenSeguro.ts).
const REFRESH_KEY = 'kp_refresh';

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export const secureTokenStore = {
  /** Returns the stored refresh token on native, or null on web / when absent. */
  async getRefreshToken(): Promise<string | null> {
    if (!isNative()) return null;
    try {
      return await conAlmacen(almacen => almacen.getItem(REFRESH_KEY));
    } catch {
      return null;
    }
  },

  /** Persists (or, with null, removes) the refresh token on native; no-op on web. */
  async setRefreshToken(token: string | null): Promise<void> {
    if (!isNative()) return;
    try {
      await conAlmacen(async almacen => {
        if (token) {
          await almacen.setItem(REFRESH_KEY, token);
        } else {
          await almacen.removeItem(REFRESH_KEY);
        }
      });
    } catch {
      // Best-effort: a secure-storage failure must never break the auth flow.
    }
  },

  /** Clears the stored refresh token on native; no-op on web. */
  async clear(): Promise<void> {
    await this.setRefreshToken(null);
  },
};
