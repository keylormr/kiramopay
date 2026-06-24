import type { INotificationRepository } from '../../repositories/notification.repository';
import type { ApiResponse } from '../../types';
import type { Notification } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';
import type { ApiData } from '../../generated/helpers';

// Anchored to the spec — re-run `npm run gen:api` after backend changes.
type NotificationDTO = NonNullable<
  ApiData<'/api/v1/notifications', 'get'>
>[number];

export class HttpNotificationRepository implements INotificationRepository {
  constructor(private client: HttpClient) {}

  async getAll(): Promise<ApiResponse<Notification[]>> {
    // Backend (notification_history) returns: title, body, type, read_at, created_at.
    // We also tolerate the historical {message, read} shape.
    // Legacy {message, read} fields kept for back-compat with older backends.
    const res = await this.client.get<
      Array<NotificationDTO & { message?: string; read?: boolean }> | null
    >('/api/v1/notifications');

    if (!res.success) {
      return apiError('FETCH_FAILED', 'Failed to fetch notifications');
    }
    // A null/undefined data payload is a valid "no records" response. Don't
    // treat that as failure — just hand back an empty list.
    const raw = Array.isArray(res.data) ? res.data : [];

    const notifications: Notification[] = raw.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.body ?? n.message ?? '',
      type: n.type as Notification['type'],
      read: n.read ?? n.read_at != null,
      date: new Date(n.created_at).toLocaleDateString('es-CR'),
    }));

    return apiSuccess(notifications);
  }

  async markRead(id: string): Promise<ApiResponse<void>> {
    const res = await this.client.patch<void>(`/api/v1/notifications/${id}/read`);
    if (!res.success) {
      return apiError('UPDATE_FAILED', res.error?.message || 'Failed to mark read');
    }
    return apiSuccess(undefined as unknown as void);
  }

  async markAllRead(): Promise<ApiResponse<void>> {
    const res = await this.client.post<void>('/api/v1/notifications/read-all');
    if (!res.success) {
      return apiError('UPDATE_FAILED', res.error?.message || 'Failed to mark all read');
    }
    return apiSuccess(undefined as unknown as void);
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    const res = await this.client.del<void>(`/api/v1/notifications/${id}`);
    if (!res.success) {
      return apiError('DELETE_FAILED', res.error?.message || 'Failed to delete');
    }
    return apiSuccess(undefined as unknown as void);
  }
}
