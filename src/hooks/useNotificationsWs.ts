import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useNotificationStore } from '@/stores/notification.store';
import type { Notification } from '@/types';
import { resolveWsBaseUrl } from '@/api/baseUrl';

interface NotificationWsMessage {
  type: 'notification' | 'auth_ok' | 'auth_error';
  notification?: Notification;
  message?: string;
}

interface UseNotificationsWsOptions {
  enabled?: boolean;
  reconnectInterval?: number;
  /** Espera tras un auth_error, mas larga que la normal. Ver authFailedRef. */
  authErrorInterval?: number;
}

export function useNotificationsWs(options: UseNotificationsWsOptions = {}) {
  const { enabled = true, reconnectInterval = 5000, authErrorInterval = 30000 } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  // El servidor rechazo el token de este socket. Pasa cuando la sesion se
  // revoco en otro lado: al bloquear la cuenta, el servidor cierra la conexion
  // abierta y el token en memoria ya no vale. Sin esta marca, el hook
  // reintentaba cada 5 s con el mismo token muerto y dejaba el socket abierto
  // sin identidad, porque auth_error no cerraba nada.
  const authFailedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const connect = useCallback(() => {
    const wsBase = resolveWsBaseUrl();
    if (!wsBase || !enabled || !isAuthenticated) return;

    const wsUrl = wsBase + '/ws/notifications';

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        authFailedRef.current = false;
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
          } else if (data.type === 'auth_error') {
            // Un socket rechazado no sirve para nada y el servidor no lo cierra:
            // se cierra aqui y el siguiente intento espera mas. Sigue
            // reintentando porque el caso benigno (el token de acceso vencio y
            // se renovara) tiene que curarse solo.
            authFailedRef.current = true;
            ws.close();
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        const espera = authFailedRef.current ? authErrorInterval : reconnectInterval;
        authFailedRef.current = false;
        if (enabled && isAuthenticated) {
          reconnectTimerRef.current = window.setTimeout(() => connectRef.current(), espera);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket creation failed
    }
  }, [enabled, isAuthenticated, reconnectInterval, authErrorInterval, addNotification]);

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
