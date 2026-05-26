import type { ISinpeRepository, SendSinpeRequest } from '../../repositories/sinpe.repository';
import type { ApiResponse } from '../../types';
import type { SinpeContact, SinpeTransaction } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpSinpeRepository implements ISinpeRepository {
  constructor(private client: HttpClient) {}

  async getContacts(): Promise<ApiResponse<SinpeContact[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        phone: string;
        name: string;
        bank: string;
        is_favorite: boolean;
      }>
    >('/api/v1/sinpe/contacts');

    if (!res.success) {
      return apiError('FETCH_FAILED', 'Failed to fetch contacts');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    const contacts: SinpeContact[] = res.data.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      bank: c.bank || 'KiramoPay',
      isFavorite: c.is_favorite,
    }));

    return apiSuccess(contacts);
  }

  async addContact(contact: SinpeContact): Promise<ApiResponse<SinpeContact>> {
    const res = await this.client.post<{
      id: string;
      phone: string;
      name: string;
      bank: string;
    }>('/api/v1/sinpe/contacts', {
      phone: contact.phone,
      name: contact.name,
      bank: contact.bank || '',
    });

    if (!res.success || !res.data) {
      return apiError('ADD_FAILED', res.error?.message || 'Failed to add contact');
    }

    return apiSuccess({
      ...contact,
      id: res.data.id,
    });
  }

  async getHistory(): Promise<ApiResponse<SinpeTransaction[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        phone: string;
        contact_name: string;
        amount: number;
        fee: number;
        type: string;
        status: string;
        description: string;
        created_at: string;
      }>
    >('/api/v1/sinpe/history');

    if (!res.success) {
      return apiError('FETCH_FAILED', 'Failed to fetch history');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    const history: SinpeTransaction[] = res.data.map((h) => ({
      id: h.id,
      phone: h.phone,
      name: h.contact_name,
      amount: h.amount / 100, // centimos → colones
      date: new Date(h.created_at).toLocaleDateString('es-CR'),
      type: h.type as 'sent' | 'received',
      status: h.status as 'completed' | 'pending' | 'failed',
      reference: h.description,
    }));

    return apiSuccess(history);
  }

  async send(request: SendSinpeRequest): Promise<ApiResponse<SinpeTransaction>> {
    const res = await this.client.post<{
      transaction_id: string;
      status: string;
      amount: number;
      fee: number;
      recipient: string;
    }>('/api/v1/sinpe/send', {
      phone: request.phone,
      amount: Math.round(request.amount * 100), // colones → centimos
      description: request.description || '',
    });

    if (!res.success || !res.data) {
      return apiError('SINPE_FAILED', res.error?.message || 'SINPE transfer failed');
    }

    const tx: SinpeTransaction = {
      id: res.data.transaction_id,
      phone: request.phone,
      name: res.data.recipient,
      amount: request.amount,
      date: new Date().toLocaleDateString('es-CR'),
      type: 'sent',
      status: res.data.status as 'completed' | 'pending' | 'failed',
      reference: request.description || '',
    };

    return apiSuccess(tx);
  }
}
