import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useNotificationStore } from '@/stores/notification.store';
import type { Notification } from '@/types';

interface NotificationWsMessage {
  type: 'notification' | 'auth_ok' | 'auth_error';
  notification?: Notification;
  message?: string;
}

interface UseNotificationsWsOptions {
  enabled?: boolean;
  reconnectInterval?: number;
}

export function useNotificationsWs(options: UseNotificationsWsOptions = {}) {
  const { enabled = true, reconnectInterval = 5000 } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const connect = useCallback(() => {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl || !enabled || !isAuthenticated) return;

    const wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws/notifications';

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Authenticate with the in-memory access token (tokens are no longer
        // kept in localStorage). Without a token the server keeps the socket
        // unauthenticated and sends nothing user-specific.
        const token = useAuthStore.getState().accessToken;
        if (token) {
          ws.send(JSON.stringify({ type: 'auth', token }));
        }

        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data: NotificationWsMessage = JSON.parse(event.data);

          if (data.type === 'notification' && data.notification) {
            addNotification(data.notification);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (enabled && isAuthenticated) {
          reconnectTimerRef.current = window.setTimeout(() => connectRef.current(), reconnectInterval);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket creation failed
    }
  }, [enabled, isAuthenticated, reconnectInterval, addNotification]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (isAuthenticated && enabled) {
      connect();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect, isAuthenticated, enabled]);
}
