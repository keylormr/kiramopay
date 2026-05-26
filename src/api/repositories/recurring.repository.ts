import type { ApiResponse } from '../types';
import type { RecurringPayment } from '@/types';

export interface CreateRecurringRequest {
  label: string;
  type: 'service' | 'sinpe' | 'recharge';
  amount: number;
  currency?: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  next_date: string;
  recipient_phone?: string;
  recipient_name?: string;
  service_provider_id?: string;
  client_id?: string;
}

export interface IRecurringRepository {
  getPayments(): Promise<ApiResponse<RecurringPayment[]>>;
  create(request: CreateRecurringRequest): Promise<ApiResponse<RecurringPayment>>;
  update(id: string, request: Partial<RecurringPayment>): Promise<ApiResponse<void>>;
  delete(id: string): Promise<ApiResponse<void>>;
  toggle(id: string): Promise<ApiResponse<{ enabled: boolean }>>;
  markPaid(id: string): Promise<ApiResponse<RecurringPayment>>;
}
