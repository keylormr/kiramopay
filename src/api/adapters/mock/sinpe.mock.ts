import type { ISinpeRepository, SendSinpeRequest } from '../../repositories/sinpe.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess } from '../../types';
import type { SinpeContact, SinpeTransaction } from '@/types';
import { initialSinpeContacts, initialSinpeHistory } from './mock-data';

const STORAGE_KEY = 'kiramopay_app_state';

function getState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveField(field: string, value: unknown) {
  const state = getState() || {};
  state[field] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export class MockSinpeRepository implements ISinpeRepository {
  async getContacts(): Promise<ApiResponse<SinpeContact[]>> {
    const state = getState();
    return apiSuccess(state?.sinpeContacts ?? initialSinpeContacts);
  }

  async addContact(contact: SinpeContact): Promise<ApiResponse<SinpeContact>> {
    const state = getState();
    const contacts: SinpeContact[] = state?.sinpeContacts ?? [...initialSinpeContacts];
    contacts.push(contact);
    saveField('sinpeContacts', contacts);
    return apiSuccess(contact);
  }

  async getHistory(): Promise<ApiResponse<SinpeTransaction[]>> {
    const state = getState();
    return apiSuccess(state?.sinpeHistory ?? initialSinpeHistory);
  }

  async send(request: SendSinpeRequest): Promise<ApiResponse<SinpeTransaction>> {
    const state = getState();
    const contacts: SinpeContact[] = state?.sinpeContacts ?? initialSinpeContacts;
    const contact = contacts.find((c) => c.phone === request.phone);

    const tx: SinpeTransaction = {
      id: `sinpe-${Date.now()}`,
      type: 'sent',
      amount: request.amount,
      phone: request.phone,
      name: contact?.name ?? request.phone,
      date: 'Ahora',
      status: 'completed',
      reference: request.description,
    };

    const history: SinpeTransaction[] = state?.sinpeHistory ?? [...initialSinpeHistory];
    history.unshift(tx);
    saveField('sinpeHistory', history);

    return apiSuccess(tx);
  }
}
