import type { ApiResponse } from '../types';
import type { Notification } from '@/types';

/** Una suscripcion de web push en forma plana, como la guarda el servidor. */
export interface SuscripcionPush {
  endpoint: string;
  auth: string;
  p256dh: string;
}

export interface INotificationRepository {
  getAll(): Promise<ApiResponse<Notification[]>>;
  markRead(id: string): Promise<ApiResponse<void>>;
  markAllRead(): Promise<ApiResponse<void>>;
  delete(id: string): Promise<ApiResponse<void>>;

  // ── Avisos del sistema (web push) ──
  /**
   * La clave VAPID publica. habilitado = false cuando el servidor no tiene las
   * claves configuradas: entonces la opcion no se ofrece.
   */
  pushPublicKey(): Promise<ApiResponse<{ publicKey: string; habilitado: boolean }>>;
  /** Guarda la suscripcion de este dispositivo para la cuenta en sesion. */
  subscribePush(sub: SuscripcionPush): Promise<ApiResponse<void>>;
  /** Olvida la suscripcion de este dispositivo. */
  unsubscribePush(endpoint: string): Promise<ApiResponse<void>>;

  // ── Avisos de la app instalada (FCM) ──
  /** Si el servidor puede entregar avisos a la app instalada. */
  pushNativo(): Promise<ApiResponse<{ habilitado: boolean }>>;
  /** Guarda el token de FCM de este telefono para la cuenta en sesion. */
  registrarDispositivo(d: { token: string; plataforma: 'android' }): Promise<ApiResponse<void>>;
  /** Da de baja este telefono. */
  olvidarDispositivo(token: string): Promise<ApiResponse<void>>;
}
