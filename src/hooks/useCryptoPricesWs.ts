import { useState, useEffect, useRef, useCallback } from 'react';

interface PriceData {
  symbol: string;
  price: number;
  change_24h: number;
  volume_24h: number;
  market_cap: number;
}

interface PriceUpdate {
  type: string;
  timestamp: string;
  prices: Record<string, PriceData>;
}

interface UseCryptoPricesWsOptions {
  enabled?: boolean;
  reconnectInterval?: number;
}

export function useCryptoPricesWs(options: UseCryptoPricesWsOptions = {}) {
  const { enabled = true, reconnectInterval = 3000 } = options;
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl || !enabled) return;

    const wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws/prices';

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data: PriceUpdate = JSON.parse(event.data);
          if (data.type === 'price_update' && data.prices) {
            setPrices(data.prices);
            setLastUpdate(data.timestamp);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Reconnect after delay — uses connectRef to avoid stale closure
        if (enabled) {
          reconnectTimerRef.current = window.setTimeout(() => connectRef.current(), reconnectInterval);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket creation failed
    }
  }, [enabled, reconnectInterval]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return { prices, connected, lastUpdate };
}
