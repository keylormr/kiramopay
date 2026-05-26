import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOfflineQueue } from '../useOfflineQueue';

// Mock the API layer
vi.mock('@/api', () => ({
  getApiLayer: () => ({
    sinpe: {
      send: vi.fn().mockResolvedValue({ success: true }),
    },
    services: {
      payBill: vi.fn().mockResolvedValue({ success: true }),
    },
  }),
}));

// Mock crypto.randomUUID
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => `uuid-${++uuidCounter}`,
});

describe('useOfflineQueue', () => {
  const QUEUE_KEY = 'kiramopay_offline_queue';

  beforeEach(() => {
    localStorage.clear();
    uuidCounter = 0;
    // Default to online
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('starts with empty queue when localStorage is empty', () => {
      const { result } = renderHook(() => useOfflineQueue());
      expect(result.current.queue).toEqual([]);
      expect(result.current.queueLength).toBe(0);
      expect(result.current.isSyncing).toBe(false);
    });

    it('loads existing queue from localStorage', () => {
      const existingQueue = [
        { id: 'existing-1', type: 'sinpe_send', payload: { phone: '8888' }, timestamp: 1000 },
      ];
      localStorage.setItem(QUEUE_KEY, JSON.stringify(existingQueue));

      const { result } = renderHook(() => useOfflineQueue());
      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0].id).toBe('existing-1');
    });

    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem(QUEUE_KEY, 'not-json{{');

      const { result } = renderHook(() => useOfflineQueue());
      expect(result.current.queue).toEqual([]);
    });
  });

  describe('enqueue', () => {
    it('adds an action to the queue and returns its id', () => {
      const { result } = renderHook(() => useOfflineQueue());

      let actionId: string;
      act(() => {
        actionId = result.current.enqueue('sinpe_send', { phone: '+506 8888-0000', amount: 5000 });
      });

      expect(actionId!).toBe('uuid-1');
      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0]).toMatchObject({
        id: 'uuid-1',
        type: 'sinpe_send',
        payload: { phone: '+506 8888-0000', amount: 5000 },
      });
      expect(result.current.queue[0].timestamp).toBeGreaterThan(0);
    });

    it('appends multiple actions in order', () => {
      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('sinpe_send', { phone: '1111' });
      });
      act(() => {
        result.current.enqueue('bill_payment', { providerId: 'ice', clientId: '123', amount: 1000 });
      });

      expect(result.current.queue).toHaveLength(2);
      expect(result.current.queue[0].type).toBe('sinpe_send');
      expect(result.current.queue[1].type).toBe('bill_payment');
      expect(result.current.queueLength).toBe(2);
    });

    it('persists queue to localStorage', async () => {
      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('sinpe_send', { phone: '8888', amount: 1000 });
      });

      // Wait for the useEffect that persists queue
      await vi.waitFor(() => {
        const stored = localStorage.getItem(QUEUE_KEY);
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed).toHaveLength(1);
      });
    });
  });

  describe('dequeue', () => {
    it('removes specific action by id', () => {
      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('sinpe_send', { phone: '1111' });
        result.current.enqueue('bill_payment', { providerId: 'ice' });
      });

      expect(result.current.queue).toHaveLength(2);

      act(() => {
        result.current.dequeue('uuid-1');
      });

      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0].type).toBe('bill_payment');
    });

    it('does nothing when id not found', () => {
      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('sinpe_send', { phone: '1111' });
      });

      act(() => {
        result.current.dequeue('nonexistent-id');
      });

      expect(result.current.queue).toHaveLength(1);
    });
  });

  describe('processQueue', () => {
    it('processes all actions with a custom processor', async () => {
      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('sinpe_send', { phone: '1111' });
        result.current.enqueue('sinpe_send', { phone: '2222' });
      });

      const processor = vi.fn().mockResolvedValue(true);

      await act(async () => {
        await result.current.processQueue(processor);
      });

      expect(processor).toHaveBeenCalledTimes(2);
      expect(result.current.queue).toHaveLength(0);
    });

    it('stops processing on first failure to maintain order', async () => {
      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('action_1', {});
        result.current.enqueue('action_2', {});
        result.current.enqueue('action_3', {});
      });

      const processor = vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false) // second fails
        .mockResolvedValueOnce(true);

      await act(async () => {
        await result.current.processQueue(processor);
      });

      // Only the first one should be processed successfully
      expect(processor).toHaveBeenCalledTimes(2);
      expect(result.current.queue).toHaveLength(2); // action_2 and action_3 remain
      expect(result.current.queue[0].type).toBe('action_2');
    });

    it('stops processing on thrown error', async () => {
      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('action_1', {});
        result.current.enqueue('action_2', {});
      });

      const processor = vi.fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Network error'));

      await act(async () => {
        await result.current.processQueue(processor);
      });

      expect(result.current.queue).toHaveLength(1); // action_2 remains
    });

    it('does nothing when queue is empty', async () => {
      const { result } = renderHook(() => useOfflineQueue());
      const processor = vi.fn().mockResolvedValue(true);

      await act(async () => {
        await result.current.processQueue(processor);
      });

      expect(processor).not.toHaveBeenCalled();
    });

    it('does nothing when offline', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('sinpe_send', { phone: '1111' });
      });

      const processor = vi.fn().mockResolvedValue(true);

      await act(async () => {
        await result.current.processQueue(processor);
      });

      expect(processor).not.toHaveBeenCalled();
      expect(result.current.queue).toHaveLength(1);
    });

    it('resets isSyncing to false after processing completes', async () => {
      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('sinpe_send', { phone: '1111' });
      });

      const processor = vi.fn().mockResolvedValue(true);

      await act(async () => {
        await result.current.processQueue(processor);
      });

      // isSyncing should be false after processing completes
      expect(result.current.isSyncing).toBe(false);
      expect(processor).toHaveBeenCalledTimes(1);
    });

    it('prevents concurrent processing (guard against double-run)', async () => {
      const { result } = renderHook(() => useOfflineQueue());

      act(() => {
        result.current.enqueue('action_1', {});
      });

      let resolveFirst: () => void;
      const slowProcessor = vi.fn(
        () => new Promise<boolean>((resolve) => { resolveFirst = () => resolve(true); })
      );

      // Start first process (will be pending)
      act(() => {
        result.current.processQueue(slowProcessor);
      });

      // Try to start second process while first is running
      const fastProcessor = vi.fn().mockResolvedValue(true);
      await act(async () => {
        await result.current.processQueue(fastProcessor);
      });

      // fastProcessor should not have been called because isSyncingRef is true
      expect(fastProcessor).not.toHaveBeenCalled();

      // Resolve the first one
      await act(async () => {
        resolveFirst!();
        await new Promise(r => setTimeout(r, 10));
      });
    });
  });

  describe('online event listener', () => {
    it('registers online event listener', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      renderHook(() => useOfflineQueue());

      const onlineCalls = addSpy.mock.calls.filter(c => c[0] === 'online');
      expect(onlineCalls.length).toBeGreaterThan(0);
    });

    it('removes online event listener on unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = renderHook(() => useOfflineQueue());

      unmount();

      const onlineCalls = removeSpy.mock.calls.filter(c => c[0] === 'online');
      expect(onlineCalls.length).toBeGreaterThan(0);
    });
  });

  describe('return value shape', () => {
    it('returns expected properties', () => {
      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current).toHaveProperty('queue');
      expect(result.current).toHaveProperty('queueLength');
      expect(result.current).toHaveProperty('isSyncing');
      expect(result.current).toHaveProperty('enqueue');
      expect(result.current).toHaveProperty('dequeue');
      expect(result.current).toHaveProperty('processQueue');
      expect(typeof result.current.enqueue).toBe('function');
      expect(typeof result.current.dequeue).toBe('function');
      expect(typeof result.current.processQueue).toBe('function');
    });
  });
});
