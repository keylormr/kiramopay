import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotificationsWs } from '../useNotificationsWs';

// Mock stores
const mockAddNotification = vi.fn();
let mockIsAuthenticated = true;

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => boolean) =>
    selector({ isAuthenticated: mockIsAuthenticated }),
}));

vi.mock('@/stores/notification.store', () => ({
  useNotificationStore: (selector: (s: { addNotification: typeof mockAddNotification }) => typeof mockAddNotification) =>
    selector({ addNotification: mockAddNotification }),
}));

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.onclose?.();
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe('useNotificationsWs', () => {
  const originalEnv = import.meta.env.VITE_API_URL;

  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    MockWebSocket.instances = [];
    mockAddNotification.mockClear();
    mockIsAuthenticated = true;
    // Set API URL for tests
    import.meta.env.VITE_API_URL = 'http://localhost:8080';
    localStorage.setItem('kiramopay-token', 'test-jwt-token');
  });

  afterEach(() => {
    import.meta.env.VITE_API_URL = originalEnv;
    localStorage.removeItem('kiramopay-token');
    vi.restoreAllMocks();
  });

  it('connects to /ws/notifications when authenticated', () => {
    renderHook(() => useNotificationsWs());

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost:8080/ws/notifications');
  });

  it('sends auth message with token on open', () => {
    renderHook(() => useNotificationsWs());

    const ws = MockWebSocket.instances[0];
    act(() => ws.simulateOpen());

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'auth', token: 'test-jwt-token' })
    );
  });

  it('adds notification to store when received', () => {
    renderHook(() => useNotificationsWs());

    const ws = MockWebSocket.instances[0];
    act(() => ws.simulateOpen());
    act(() =>
      ws.simulateMessage({
        type: 'notification',
        notification: {
          id: 'n1',
          title: 'Transfer received',
          message: 'You received 5000 CRC',
          type: 'transaction',
          date: '2026-02-16',
          read: false,
        },
      })
    );

    expect(mockAddNotification).toHaveBeenCalledWith({
      id: 'n1',
      title: 'Transfer received',
      message: 'You received 5000 CRC',
      type: 'transaction',
      date: '2026-02-16',
      read: false,
    });
  });

  it('does not connect when not authenticated', () => {
    mockIsAuthenticated = false;
    renderHook(() => useNotificationsWs());

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('does not connect when disabled', () => {
    renderHook(() => useNotificationsWs({ enabled: false }));

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('does not connect when VITE_API_URL is empty', () => {
    import.meta.env.VITE_API_URL = '';
    renderHook(() => useNotificationsWs());

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('ignores malformed messages', () => {
    renderHook(() => useNotificationsWs());

    const ws = MockWebSocket.instances[0];
    act(() => ws.simulateOpen());

    // Send a non-notification message - should not crash
    act(() =>
      ws.simulateMessage({ type: 'auth_ok', message: 'Authenticated' })
    );

    expect(mockAddNotification).not.toHaveBeenCalled();
  });

  it('cleans up WebSocket on unmount', () => {
    const { unmount } = renderHook(() => useNotificationsWs());

    const ws = MockWebSocket.instances[0];
    unmount();

    expect(ws.close).toHaveBeenCalled();
  });
});
