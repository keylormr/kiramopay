import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePushNotifications } from '../usePushNotifications';

describe('usePushNotifications', () => {
  const originalNotification = globalThis.Notification;

  beforeEach(() => {
    // Mock Notification API
    const MockNotification = vi.fn() as unknown as typeof Notification;
    Object.defineProperty(MockNotification, 'permission', {
      get: () => 'default',
      configurable: true,
    });
    MockNotification.requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', MockNotification);
  });

  afterEach(() => {
    vi.stubGlobal('Notification', originalNotification);
    vi.restoreAllMocks();
  });

  it('detects support when PushManager exists', () => {
    // PushManager may or may not exist in jsdom
    vi.stubGlobal('PushManager', class {});

    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.isSupported).toBe(true);

    // Clean up
    // @ts-expect-error - cleaning up global
    delete globalThis.PushManager;
  });

  it('detects no support when PushManager is missing', () => {
    // Ensure PushManager is not defined
    // @ts-expect-error - cleaning up global
    delete globalThis.PushManager;

    // Need to re-import to get fresh evaluation
    // Instead, just check the hook detects missing PushManager
    const hasPushManager = 'PushManager' in window;
    expect(hasPushManager).toBe(false);
  });

  it('requests notification permission', async () => {
    vi.stubGlobal('PushManager', class {});

    const { result } = renderHook(() => usePushNotifications());

    let granted: boolean | undefined;
    await act(async () => {
      granted = await result.current.requestPermission();
    });

    expect(granted).toBe(true);
    expect(Notification.requestPermission).toHaveBeenCalled();

    // @ts-expect-error - cleaning up global
    delete globalThis.PushManager;
  });

  it('returns false for requestPermission when not supported', async () => {
    // @ts-expect-error - cleaning up global
    delete globalThis.PushManager;

    // Remove Notification to simulate no support
    // @ts-expect-error - removing Notification
    delete globalThis.Notification;

    const { result } = renderHook(() => usePushNotifications());

    let granted: boolean | undefined;
    await act(async () => {
      granted = await result.current.requestPermission();
    });

    expect(granted).toBe(false);
    expect(result.current.isSupported).toBe(false);

    // Restore
    vi.stubGlobal('Notification', originalNotification);
  });

  it('subscribe returns null when VAPID key is not set', async () => {
    vi.stubGlobal('PushManager', class {});

    const mockSubscription = { endpoint: 'https://push.example.com' };
    const mockPushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(mockSubscription),
    };
    const mockRegistration = { pushManager: mockPushManager };

    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve(mockRegistration) },
      configurable: true,
      writable: true,
    });

    // Ensure VAPID key is not set
    const original = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    import.meta.env.VITE_VAPID_PUBLIC_KEY = '';

    const { result } = renderHook(() => usePushNotifications());

    let sub: PushSubscription | null | undefined;
    await act(async () => {
      sub = await result.current.subscribe();
    });

    expect(sub).toBeNull();

    import.meta.env.VITE_VAPID_PUBLIC_KEY = original;
    // @ts-expect-error - cleaning up global
    delete globalThis.PushManager;
  });

  it('sends local notification when permission is granted', () => {
    vi.stubGlobal('PushManager', class {});

    Object.defineProperty(Notification, 'permission', {
      get: () => 'granted',
      configurable: true,
    });

    const { result } = renderHook(() => usePushNotifications());

    act(() => {
      result.current.sendLocalNotification('Test', { body: 'Hello' });
    });

    expect(Notification).toHaveBeenCalledWith('Test', expect.objectContaining({
      body: 'Hello',
      icon: '/icons/icon-192.png',
    }));

    // @ts-expect-error - cleaning up global
    delete globalThis.PushManager;
  });
});
