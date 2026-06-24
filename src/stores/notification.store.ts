import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Notification } from '@/types';
import { initialNotifications } from '@/api/adapters/mock/mock-data';

const hasBackend = !!import.meta.env.VITE_API_URL;

interface NotificationState {
  notifications: Notification[];

  setNotifications: (notifications: Notification[]) => void;
  addNotification: (notification: Notification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  deleteNotification: (id: string) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      notifications: hasBackend ? [] : initialNotifications,

      setNotifications: (notifications) => set({ notifications }),

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
        })),
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
