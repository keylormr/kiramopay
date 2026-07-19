import type { ApiResponse } from '../types';
import type { SinpeContact, SinpeTransaction } from '@/types';

export interface SendSinpeRequest {
  phone: string;
  amount: number;
  description?: string;
  // Stable per-attempt key so a double-submit or retry is de-duplicated by the
  // backend instead of creating a second transfer.
  idempotencyKey?: string;
}

export interface ISinpeRepository {
  getContacts(): Promise<ApiResponse<SinpeContact[]>>;
  addContact(contact: SinpeContact): Promise<ApiResponse<SinpeContact>>;
  getHistory(): Promise<ApiResponse<SinpeTransaction[]>>;
  send(request: SendSinpeRequest): Promise<ApiResponse<SinpeTransaction>>;
}
