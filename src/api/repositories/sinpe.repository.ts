import type { ApiResponse } from '../types';
import type { SinpeContact, SinpeTransaction } from '@/types';

export interface SendSinpeRequest {
  phone: string;
  amount: number;
  description?: string;
}

export interface ISinpeRepository {
  getContacts(): Promise<ApiResponse<SinpeContact[]>>;
  addContact(contact: SinpeContact): Promise<ApiResponse<SinpeContact>>;
  getHistory(): Promise<ApiResponse<SinpeTransaction[]>>;
  send(request: SendSinpeRequest): Promise<ApiResponse<SinpeTransaction>>;
}
