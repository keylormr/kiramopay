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

/**
 * Lo que el servidor dice de un telefono: si tiene cuenta de KiramoPay y, si la
 * tiene, el nombre registrado RECORTADO (nombre e iniciales de los apellidos:
 * "Keilor M. R."). Nada mas: ni id, ni cedula, ni el apellido entero.
 */
export interface RecipientLookup {
  registered: boolean;
  displayName?: string;
}

export interface ISinpeRepository {
  getContacts(): Promise<ApiResponse<SinpeContact[]>>;
  addContact(contact: SinpeContact): Promise<ApiResponse<SinpeContact>>;
  getHistory(): Promise<ApiResponse<SinpeTransaction[]>>;
  send(request: SendSinpeRequest): Promise<ApiResponse<SinpeTransaction>>;
  /** El nombre registrado a un telefono, para reconocer a quien se le paga. */
  lookupRecipient(phone: string): Promise<ApiResponse<RecipientLookup>>;
}
