import type { ApiResponse } from '../types';
import type { Notification } from '@/types';

export interface INotificationRepository {
  getAll(): Promise<ApiResponse<Notification[]>>;
  markRead(id: string): Promise<ApiResponse<void>>;
  markAllRead(): Promise<ApiResponse<void>>;
  delete(id: string): Promise<ApiResponse<void>>;
}
