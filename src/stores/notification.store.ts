import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Notification } from '@/types';
import { initialNotifications } from '@/api/adapters/mock/mock-data';

const hasBackend = !!import.meta.env.VITE_API_URL;

interface NotificationState {
  notifications: Notification[];
  /**
   * Las que la persona oculto en esta sesion. Una carga de la lista pedida
   * antes de ocultar puede llegar despues, todavia con la notificacion: la
   * lista que se guarda las deja afuera. El servidor tambien las filtra, asi
   * que esto solo cubre esas cargas viejas.
   */
  ocultas: string[];

  setNotifications: (notifications: Notification[]) => void;
  addNotification: (notification: Notification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  deleteNotification: (id: string) => void;
  /**
   * Devuelve a su lugar una notificacion que se saco de la lista y el servidor
   * no oculto. Si una carga ya la trajo, no la duplica.
   */
  restoreNotification: (notification: Notification, index: number) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      notifications: hasBackend ? [] : initialNotifications,
      ocultas: [],

      setNotifications: (notifications) =>
        set((s) => ({
          notifications: notifications.filter((n) => !s.ocultas.includes(n.id)),
        })),

      addNotification: (notification) =>
        set((s) => ({ notifications: [notification, ...s.notifications] })),

      markRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        })),

      markAllRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, read: true })),
        })),

      deleteNotification: (id) =>
        set((s) => ({
          notifications: s.notifications.filter((n) => n.id !== id),
          ocultas: s.ocultas.includes(id) ? s.ocultas : [...s.ocultas, id],
        })),

      restoreNotification: (notification, index) =>
        set((s) => {
          const ocultas = s.ocultas.filter((id) => id !== notification.id);
          if (s.notifications.some((n) => n.id === notification.id)) return { ocultas };
          const notifications = [...s.notifications];
          notifications.splice(Math.min(index, notifications.length), 0, notification);
          return { notifications, ocultas };
        }),
    }),
    {
      name: 'kiramopay-notifications',
      // With a backend, notifications are server-truth — don't cache them in
      // localStorage. A stale cache made read state "flash back" to unread on
      // start before the sync overwrote it. Mock mode still persists for an
      // offline demo experience.
      partialize: (s) => (hasBackend ? {} : { notifications: s.notifications }),
    },
  ),
);
