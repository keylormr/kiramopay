import { secureTokenStore } from '../secureTokenStore';

// On the web (jsdom is not a native Capacitor platform) the secure store must be
// a complete no-op: the refresh token lives in the HttpOnly cookie, never in JS.
describe('secureTokenStore on web', () => {
  it('get returns null and set/clear never touch the native plugin', async () => {
    expect(await secureTokenStore.getRefreshToken()).toBeNull();
    await expect(secureTokenStore.setRefreshToken('a-token')).resolves.toBeUndefined();
    await expect(secureTokenStore.clear()).resolves.toBeUndefined();
    // Still nothing stored — set was a no-op on web.
    expect(await secureTokenStore.getRefreshToken()).toBeNull();
  });
});
