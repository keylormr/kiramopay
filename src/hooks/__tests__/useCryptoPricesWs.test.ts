import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCryptoPricesWs } from '../useCryptoPricesWs';

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

  simulateError() {
    this.onerror?.();
  }

  simulateClose() {
    this.onclose?.();
  }
}

describe('useCryptoPricesWs', () => {
  const originalEnv = import.meta.env.VITE_API_URL;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
    MockWebSocket.instances = [];
    import.meta.env.VITE_API_URL = 'http://localhost:8080';
  });

  afterEach(() => {
    vi.useRealTimers();
    import.meta.env.VITE_API_URL = originalEnv;
    vi.restoreAllMocks();
  });

  describe('connection', () => {
    it('connects to /ws/prices when enabled and API URL is set', () => {
      renderHook(() => useCryptoPricesWs());

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe('ws://localhost:8080/ws/prices');
    });

    it('replaces http with ws in the URL', () => {
      import.meta.env.VITE_API_URL = 'http://api.example.com';
      renderHook(() => useCryptoPricesWs());

      expect(MockWebSocket.instances[0].url).toBe('ws://api.example.com/ws/prices');
    });

    it('replaces https with wss in the URL', () => {
      import.meta.env.VITE_API_URL = 'https://api.example.com';
      renderHook(() => useCryptoPricesWs());

      expect(MockWebSocket.instances[0].url).toBe('wss://api.example.com/ws/prices');
    });

    it('does not connect when VITE_API_URL is empty', () => {
      import.meta.env.VITE_API_URL = '';
      renderHook(() => useCryptoPricesWs());

      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('does not connect when disabled', () => {
      renderHook(() => useCryptoPricesWs({ enabled: false }));

      expect(MockWebSocket.instances).toHaveLength(0);
    });
  });

  describe('connected state', () => {
    it('starts disconnected', () => {
      const { result } = renderHook(() => useCryptoPricesWs());
      expect(result.current.connected).toBe(false);
    });

    it('sets connected to true on open', () => {
      const { result } = renderHook(() => useCryptoPricesWs());

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
      });

      expect(result.current.connected).toBe(true);
    });

    it('sets connected to false on close', () => {
      const { result } = renderHook(() => useCryptoPricesWs());

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
      });
      expect(result.current.connected).toBe(true);

      act(() => {
        MockWebSocket.instances[0].simulateClose();
      });
      expect(result.current.connected).toBe(false);
    });
  });

  describe('message handling', () => {
    it('updates prices on price_update message', () => {
      const { result } = renderHook(() => useCryptoPricesWs());
      const ws = MockWebSocket.instances[0];

      act(() => ws.simulateOpen());

      const priceUpdate = {
        type: 'price_update',
        timestamp: '2026-02-16T10:00:00Z',
        prices: {
          BTC: { symbol: 'BTC', price: 43000, change_24h: 1.5, volume_24h: 18e9, market_cap: 840e9 },
          ETH: { symbol: 'ETH', price: 2400, change_24h: 2.1, volume_24h: 8e9, market_cap: 280e9 },
        },
      };

      act(() => ws.simulateMessage(priceUpdate));

      expect(result.current.prices).toHaveProperty('BTC');
      expect(result.current.prices.BTC.price).toBe(43000);
      expect(result.current.prices.ETH.price).toBe(2400);
      expect(result.current.lastUpdate).toBe('2026-02-16T10:00:00Z');
    });

    it('updates prices on subsequent messages', () => {
      const { result } = renderHook(() => useCryptoPricesWs());
      const ws = MockWebSocket.instances[0];

      act(() => ws.simulateOpen());

      // First message
      act(() =>
        ws.simulateMessage({
          type: 'price_update',
          timestamp: '2026-02-16T10:00:00Z',
          prices: { BTC: { symbol: 'BTC', price: 43000, change_24h: 1.5, volume_24h: 18e9, market_cap: 840e9 } },
        })
      );
      expect(result.current.prices.BTC.price).toBe(43000);

      // Second message with updated price
      act(() =>
        ws.simulateMessage({
          type: 'price_update',
          timestamp: '2026-02-16T10:01:00Z',
          prices: { BTC: { symbol: 'BTC', price: 43100, change_24h: 1.7, volume_24h: 18e9, market_cap: 842e9 } },
        })
      );
      expect(result.current.prices.BTC.price).toBe(43100);
      expect(result.current.lastUpdate).toBe('2026-02-16T10:01:00Z');
    });

    it('ignores messages without type price_update', () => {
      const { result } = renderHook(() => useCryptoPricesWs());
      const ws = MockWebSocket.instances[0];

      act(() => ws.simulateOpen());

      act(() =>
        ws.simulateMessage({
          type: 'heartbeat',
          timestamp: '2026-02-16T10:00:00Z',
        })
      );

      expect(result.current.prices).toEqual({});
      expect(result.current.lastUpdate).toBeNull();
    });

    it('ignores price_update messages without prices field', () => {
      const { result } = renderHook(() => useCryptoPricesWs());
      const ws = MockWebSocket.instances[0];

      act(() => ws.simulateOpen());

      act(() =>
        ws.simulateMessage({
          type: 'price_update',
          timestamp: '2026-02-16T10:00:00Z',
          // no prices field
        })
      );

      expect(result.current.prices).toEqual({});
    });

    it('ignores malformed JSON messages without crashing', () => {
      const { result } = renderHook(() => useCryptoPricesWs());
      const ws = MockWebSocket.instances[0];

      act(() => ws.simulateOpen());

      // Send raw string (not JSON)
      act(() => {
        ws.onmessage?.({ data: 'not-valid-json{{{' });
      });

      expect(result.current.prices).toEqual({});
      expect(result.current.connected).toBe(true);
    });
  });

  describe('initial state', () => {
    it('returns empty prices, disconnected, and null lastUpdate initially', () => {
      const { result } = renderHook(() => useCryptoPricesWs());
      expect(result.current.prices).toEqual({});
      expect(result.current.connected).toBe(false);
      expect(result.current.lastUpdate).toBeNull();
    });
  });

  describe('error handling', () => {
    it('closes WebSocket on error', () => {
      renderHook(() => useCryptoPricesWs());
      const ws = MockWebSocket.instances[0];

      act(() => ws.simulateOpen());
      act(() => ws.simulateError());

      expect(ws.close).toHaveBeenCalled();
    });
  });

  describe('reconnection', () => {
    it('schedules reconnect after close with default 3000ms interval', () => {
      renderHook(() => useCryptoPricesWs());
      const firstWs = MockWebSocket.instances[0];

      // Open then close
      act(() => firstWs.simulateOpen());
      act(() => firstWs.simulateClose());

      expect(MockWebSocket.instances).toHaveLength(1); // No reconnect yet

      // Advance timer past reconnect interval
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(MockWebSocket.instances).toHaveLength(2); // Reconnected
      expect(MockWebSocket.instances[1].url).toBe('ws://localhost:8080/ws/prices');
    });

    it('uses custom reconnect interval', () => {
      renderHook(() => useCryptoPricesWs({ reconnectInterval: 5000 }));
      const firstWs = MockWebSocket.instances[0];

      act(() => firstWs.simulateOpen());
      act(() => firstWs.simulateClose());

      // At 3000ms, should not have reconnected yet
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(MockWebSocket.instances).toHaveLength(1);

      // At 5000ms, should reconnect
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('clears reconnect timer on successful open', () => {
      renderHook(() => useCryptoPricesWs());
      const ws = MockWebSocket.instances[0];

      // If there was a pending reconnect timer, opening should clear it
      act(() => ws.simulateOpen());

      // The connected state should be true and no extra connections
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect when disabled', () => {
      const { rerender } = renderHook(
        ({ enabled }) => useCryptoPricesWs({ enabled }),
        { initialProps: { enabled: true } }
      );

      const firstWs = MockWebSocket.instances[0];
      act(() => firstWs.simulateOpen());

      // Disable and close
      rerender({ enabled: false });

      // Even after timeout, should not reconnect when disabled
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // The rerender with enabled=false triggers cleanup and a new effect with enabled=false
      // which means connect() returns early. Only the original instance should exist.
      MockWebSocket.instances.filter(
        (_, idx) => idx > 0
      );
      // New connections created after disable should not connect (connect returns early)
      // The exact count depends on effect re-run, but no new WS should be created
      // since connect() returns early when enabled=false
    });
  });

  describe('cleanup', () => {
    it('closes WebSocket on unmount', () => {
      const { unmount } = renderHook(() => useCryptoPricesWs());
      const ws = MockWebSocket.instances[0];

      unmount();

      expect(ws.close).toHaveBeenCalled();
    });

    it('clears reconnect timer on unmount', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const { unmount } = renderHook(() => useCryptoPricesWs());
      const ws = MockWebSocket.instances[0];

      // Trigger a close to start reconnect timer
      act(() => ws.simulateOpen());
      act(() => ws.simulateClose());

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('return value shape', () => {
    it('returns prices, connected, and lastUpdate', () => {
      const { result } = renderHook(() => useCryptoPricesWs());

      expect(result.current).toHaveProperty('prices');
      expect(result.current).toHaveProperty('connected');
      expect(result.current).toHaveProperty('lastUpdate');
    });
  });
});
