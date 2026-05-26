import type { INotificationRepository } from '../../repositories/notification.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import type { Notification } from '@/types';
import { initialNotifications } from './mock-data';

const STORAGE_KEY = 'kiramopay_app_state';

function getNotifications(): Notification[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const state = data ? JSON.parse(data) : null;
    return state?.notifications ?? initialNotifications;
  } catch {
    return initialNotifications;
  }
}

function saveNotifications(notifications: Notification[]) {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const state = data ? JSON.parse(data) : {};
    state.notifications = notifications;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // noop
  }
}

export class MockNotificationRepository implements INotificationRepository {
  async getAll(): Promise<ApiResponse<Notification[]>> {
    return apiSuccess(getNotifications());
  }

  async markRead(id: string): Promise<ApiResponse<void>> {
    const notifications = getNotifications();
    const notif = notifications.find((n) => n.id === id);
    if (!notif) return apiError('NOT_FOUND', 'Notification not found');
    notif.read = true;
    saveNotifications(notifications);
    return apiSuccess(undefined as unknown as void);
  }

  async markAllRead(): Promise<ApiResponse<void>> {
    const notifications = getNotifications().map((n) => ({ ...n, read: true }));
    saveNotifications(notifications);
    return apiSuccess(undefined as unknown as void);
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    const notifications = getNotifications().filter((n) => n.id !== id);
    saveNotifications(notifications);
    return apiSuccess(undefined as unknown as void);
  }
}
