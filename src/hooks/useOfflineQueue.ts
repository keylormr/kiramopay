import { useState, useCallback, useEffect, useRef } from 'react';
import { getApiLayer } from '@/api';

interface QueuedAction {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

const QUEUE_KEY = 'kiramopay_offline_queue';

/**
 * Manages a queue of actions that should be synced when back online.
 * Actions are persisted to localStorage and processed in order.
 * Listens for SYNC_OFFLINE_QUEUE messages from the Service Worker.
 */
export function useOfflineQueue() {
  const [queue, setQueue] = useState<QueuedAction[]>(() => {
    try {
      const stored = localStorage.getItem(QUEUE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);

  // Persist queue changes
  useEffect(() => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }, [queue]);

  const enqueue = useCallback((type: string, payload: unknown) => {
    const action: QueuedAction = {
      id: crypto.randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
    };
    setQueue((prev) => [...prev, action]);
    return action.id;
  }, []);

  const dequeue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const processQueue = useCallback(
    async (processor: (action: QueuedAction) => Promise<boolean>) => {
      if (isSyncingRef.current || queue.length === 0 || !navigator.onLine) return;

      isSyncingRef.current = true;
      setIsSyncing(true);
      const processed: string[] = [];

      for (const action of queue) {
        try {
          const success = await processor(action);
          if (success) {
            processed.push(action.id);
          } else {
            break; // Stop on first failure to maintain order
          }
        } catch {
          break;
        }
      }

      if (processed.length > 0) {
        setQueue((prev) => prev.filter((a) => !processed.includes(a.id)));
      }
      isSyncingRef.current = false;
      setIsSyncing(false);
    },
    [queue]
  );

  // Default processor that replays API requests
  const defaultProcessor = useCallback(async (action: QueuedAction): Promise<boolean> => {
    const api = getApiLayer();
    try {
      switch (action.type) {
        case 'sinpe_send': {
          const p = action.payload as { phone: string; amount: number; description?: string };
          const res = await api.sinpe.send({ phone: p.phone, amount: p.amount, description: p.description });
          return res.success;
        }
        case 'bill_payment': {
          const p = action.payload as { providerId: string; clientId: string; amount: number };
          const res = await api.services.payBill({ providerId: p.providerId, providerName: '', clientId: p.clientId, amount: p.amount, period: '' });
          return res.success;
        }
        default:
          // Unknown action type — skip it
          return true;
      }
    } catch {
      return false;
    }
  }, []);

  // Auto-process when coming back online
  useEffect(() => {
    const handleOnline = () => {
      if (queue.length > 0 && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register('sync-transactions').catch(() => {
            // Background Sync not supported — process manually
            processQueue(defaultProcessor);
          });
        });
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [queue.length, processQueue, defaultProcessor]);

  // Listen for SW SYNC_OFFLINE_QUEUE messages
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_OFFLINE_QUEUE') {
        processQueue(defaultProcessor);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [processQueue, defaultProcessor]);

  return {
    queue,
    queueLength: queue.length,
    isSyncing,
    enqueue,
    dequeue,
    processQueue,
  };
}
