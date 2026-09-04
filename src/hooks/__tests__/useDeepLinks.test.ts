import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDeepLink } from '../useDeepLinks';

const { addListener, getLaunchUrl, removeHandle, isNativePlatform } = vi.hoisted(() => ({
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
  removeHandle: vi.fn(),
  isNativePlatform: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({ App: { addListener, getLaunchUrl } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform } }));

// The hook keeps module-level state (the launch URL is consumed once per
// process, and the bus parks one target). Each test gets a fresh module graph;
// testing-library is re-imported alongside it so both share one React copy.
async function load() {
  vi.resetModules();
  const [mod, rtl] = await Promise.all([
    import('../useDeepLinks'),
    import('@testing-library/react'),
  ]);
  return { ...mod, ...rtl };
}

/** Last handler passed to App.addListener('appUrlOpen', ...). */
let onUrlOpen: (event: { url: string }) => void;

describe('parseDeepLink', () => {
  it('parses kiramopay://pay?amount=5000', () => {
    const result = parseDeepLink('kiramopay://pay?amount=5000');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('sinpe');
    expect(result!.params.amount).toBe('5000');
  });

  it('parses kiramopay://transfer/123', () => {
    const result = parseDeepLink('kiramopay://transfer/123');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('sinpe');
    expect(result!.params.id).toBe('123');
  });

  it('returns null for invalid URL', () => {
    const result = parseDeepLink('not a url at all %%%');
    expect(result).toBeNull();
  });

  it('parses https://app.kiramopay.com/crypto', () => {
    const result = parseDeepLink('https://app.kiramopay.com/crypto');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('crypto');
  });

  it('returns null for unknown path', () => {
    const result = parseDeepLink('kiramopay://unknown-route');
    expect(result).toBeNull();
  });

  it('parses home path', () => {
    const result = parseDeepLink('kiramopay://home');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('home');
  });

  it('handles empty path as home', () => {
    const result = parseDeepLink('https://app.kiramopay.com/');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('home');
  });
});

describe('useDeepLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    isNativePlatform.mockReturnValue(true);
    getLaunchUrl.mockResolvedValue(undefined);
    addListener.mockImplementation((_event: string, cb: (e: { url: string }) => void) => {
      onUrlOpen = cb;
      return Promise.resolve({ remove: removeHandle });
    });
  });

  it('subscribes through the Capacitor App plugin, not a window event', async () => {
    const { useDeepLinks, renderHook, act } = await load();
    const navigateTo = vi.fn();

    renderHook(() => useDeepLinks({ navigateTo, isAuthenticated: true }));

    expect(addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));

    // Capacitor does not dispatch plugin events on window. Anything listening
    // there would never fire — this guards against that regression.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('appUrlOpen', { detail: { url: 'kiramopay://crypto' } }),
      );
    });
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('navigates when a url arrives and the user is authenticated', async () => {
    const { useDeepLinks, renderHook, act } = await load();
    const navigateTo = vi.fn();

    renderHook(() => useDeepLinks({ navigateTo, isAuthenticated: true }));
    await act(async () => { onUrlOpen({ url: 'kiramopay://pay?amount=5000' }); });

    expect(navigateTo).toHaveBeenCalledWith('sinpe', { amount: '5000' });
  });

  it('parks the link instead of navigating when logged out', async () => {
    const { useDeepLinks, renderHook, act } = await load();
    const navigateTo = vi.fn();

    renderHook(() => useDeepLinks({ navigateTo, isAuthenticated: false }));
    await act(async () => { onUrlOpen({ url: 'kiramopay://crypto' }); });

    expect(navigateTo).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('pending_deep_link')!).tab).toBe('crypto');
  });

  it('replays a parked link once the session exists', async () => {
    const { useDeepLinks, renderHook, act } = await load();
    const navigateTo = vi.fn();

    const { rerender } = renderHook(
      ({ auth }) => useDeepLinks({ navigateTo, isAuthenticated: auth }),
      { initialProps: { auth: false } },
    );
    await act(async () => { onUrlOpen({ url: 'kiramopay://services' }); });
    expect(navigateTo).not.toHaveBeenCalled();

    await act(async () => { rerender({ auth: true }); });

    expect(navigateTo).toHaveBeenCalledWith('services', {});
    expect(sessionStorage.getItem('pending_deep_link')).toBeNull();
  });

  it('routes the cold-start launch url exactly once across re-runs', async () => {
    getLaunchUrl.mockResolvedValue({ url: 'kiramopay://profile' });
    const { useDeepLinks, renderHook, act } = await load();
    const navigateTo = vi.fn();

    const { rerender } = renderHook(
      ({ auth }) => useDeepLinks({ navigateTo, isAuthenticated: auth }),
      { initialProps: { auth: true } },
    );
    await act(async () => {});
    expect(navigateTo).toHaveBeenCalledWith('profile', {});

    // Flipping the session must not drag the user back to the launch screen.
    await act(async () => { rerender({ auth: false }); });
    await act(async () => { rerender({ auth: true }); });
    expect(getLaunchUrl).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledTimes(1);
  });

  it('removes the async listener handle on unmount', async () => {
    const { useDeepLinks, renderHook, act } = await load();

    const { unmount } = renderHook(() =>
      useDeepLinks({ navigateTo: vi.fn(), isAuthenticated: true }),
    );
    await act(async () => { unmount(); });

    expect(removeHandle).toHaveBeenCalled();
  });

  it('does not touch the native plugin on web', async () => {
    isNativePlatform.mockReturnValue(false);
    const { useDeepLinks, renderHook } = await load();

    renderHook(() => useDeepLinks({ navigateTo: vi.fn(), isAuthenticated: true }));

    expect(addListener).not.toHaveBeenCalled();
    expect(getLaunchUrl).not.toHaveBeenCalled();
  });
});

describe('deep link bus', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('replays a target published before anyone subscribed', async () => {
    const { publishDeepLink, subscribeDeepLink } = await load();
    const seen = vi.fn();

    publishDeepLink({ tab: 'sinpe', params: { amount: '10' } });
    subscribeDeepLink(seen);

    expect(seen).toHaveBeenCalledWith({ tab: 'sinpe', params: { amount: '10' } });
  });

  it('delivers to a live subscriber and stops after unsubscribe', async () => {
    const { publishDeepLink, subscribeDeepLink } = await load();
    const seen = vi.fn();

    const unsubscribe = subscribeDeepLink(seen);
    publishDeepLink({ tab: 'crypto', params: {} });
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    publishDeepLink({ tab: 'home', params: {} });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
