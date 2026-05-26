import type {
  IRecurringRepository,
  CreateRecurringRequest,
} from '../../repositories/recurring.repository';
import type { ApiResponse } from '../../types';
import type { RecurringPayment } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

interface RecurringPaymentDTO {
  id: string;
  label: string;
  type: string;
  amount: number;
  currency: string;
  frequency: string;
  next_date: string;
  last_paid_date: string | null;
  recipient_phone: string;
  recipient_name: string;
  service_provider_id: string;
  client_id: string;
  enabled: boolean;
}

function mapToFrontend(dto: RecurringPaymentDTO): RecurringPayment {
  return {
    id: dto.id,
    label: dto.label,
    type: dto.type as RecurringPayment['type'],
    amount: dto.amount / 100,
    ccy: dto.currency || 'CRC',
    frequency: dto.frequency as RecurringPayment['frequency'],
    nextDate: dto.next_date,
    lastPaidDate: dto.last_paid_date || undefined,
    recipientPhone: dto.recipient_phone || undefined,
    recipientName: dto.recipient_name || undefined,
    serviceProviderId: dto.service_provider_id || undefined,
    clientId: dto.client_id || undefined,
    enabled: dto.enabled,
  };
}

export class HttpRecurringRepository implements IRecurringRepository {
  constructor(private client: HttpClient) {}

  async getPayments(): Promise<ApiResponse<RecurringPayment[]>> {
    const res = await this.client.get<RecurringPaymentDTO[]>('/api/v1/recurring');

    if (!res.success) {
      return apiError('FETCH_FAILED', 'Failed to fetch recurring payments');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    return apiSuccess(res.data.map(mapToFrontend));
  }

  async create(request: CreateRecurringRequest): Promise<ApiResponse<RecurringPayment>> {
    const res = await this.client.post<RecurringPaymentDTO>('/api/v1/recurring', {
      label: request.label,
      type: request.type,
      amount: Math.round(request.amount * 100),
      currency: request.currency || 'CRC',
      frequency: request.frequency,
      next_date: request.next_date,
      recipient_phone: request.recipient_phone || '',
      recipient_name: request.recipient_name || '',
      service_provider_id: request.service_provider_id || '',
      client_id: request.client_id || '',
    });

    if (!res.success || !res.data) {
      return apiError('CREATE_FAILED', res.error?.message || 'Failed to create recurring payment');
    }

    return apiSuccess(mapToFrontend(res.data));
  }

  async update(id: string, request: Partial<RecurringPayment>): Promise<ApiResponse<void>> {
    const body: Record<string, unknown> = {};
    if (request.label !== undefined) body.label = request.label;
    if (request.amount !== undefined) body.amount = Math.round(request.amount * 100);
    if (request.frequency !== undefined) body.frequency = request.frequency;
    if (request.nextDate !== undefined) body.next_date = request.nextDate;

    const res = await this.client.patch<void>(`/api/v1/recurring/${id}`, body);
    if (!res.success) {
      return apiError('UPDATE_FAILED', res.error?.message || 'Failed to update');
    }
    return apiSuccess(undefined as unknown as void);
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    const res = await this.client.del<void>(`/api/v1/recurring/${id}`);
    if (!res.success) {
      return apiError('DELETE_FAILED', res.error?.message || 'Failed to delete');
    }
    return apiSuccess(undefined as unknown as void);
  }

  async toggle(id: string): Promise<ApiResponse<{ enabled: boolean }>> {
    const res = await this.client.post<{ enabled: boolean }>(
      `/api/v1/recurring/${id}/toggle`,
    );
    if (!res.success || !res.data) {
      return apiError('TOGGLE_FAILED', res.error?.message || 'Failed to toggle');
    }
    return apiSuccess(res.data);
  }

  async markPaid(id: string): Promise<ApiResponse<RecurringPayment>> {
    const res = await this.client.post<RecurringPaymentDTO>(
      `/api/v1/recurring/${id}/mark-paid`,
    );
    if (!res.success || !res.data) {
      return apiError('MARK_PAID_FAILED', res.error?.message || 'Failed to mark paid');
    }
    return apiSuccess(mapToFrontend(res.data));
  }
}
