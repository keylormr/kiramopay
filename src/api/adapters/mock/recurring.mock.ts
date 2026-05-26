import type {
  IRecurringRepository,
  CreateRecurringRequest,
} from '../../repositories/recurring.repository';
import type { ApiResponse } from '../../types';
import type { RecurringPayment } from '@/types';
import { apiSuccess } from '../../types';

const STORAGE_KEY = 'kiramopay_recurring_payments';

const defaultPayments: RecurringPayment[] = [
  {
    id: 'rec-1',
    label: 'Pago ICE',
    type: 'service',
    amount: 32450,
    ccy: 'CRC',
    frequency: 'monthly',
    nextDate: '2026-03-15',
    lastPaidDate: '2026-02-15',
    serviceProviderId: 'ice',
    clientId: '1234567',
    enabled: true,
  },
  {
    id: 'rec-2',
    label: 'SINPE a Diego',
    type: 'sinpe',
    amount: 15000,
    ccy: 'CRC',
    frequency: 'biweekly',
    nextDate: '2026-03-01',
    recipientPhone: '8888-1234',
    recipientName: 'Diego Mora',
    enabled: true,
  },
  {
    id: 'rec-3',
    label: 'Recarga Kolbi',
    type: 'recharge',
    amount: 5000,
    ccy: 'CRC',
    frequency: 'monthly',
    nextDate: '2026-03-20',
    lastPaidDate: '2026-02-20',
    recipientPhone: '8888-0000',
    enabled: false,
  },
];

function load(): RecurringPayment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [...defaultPayments];
  } catch {
    return [...defaultPayments];
  }
}

function save(payments: RecurringPayment[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payments));
}

export class MockRecurringRepository implements IRecurringRepository {
  async getPayments(): Promise<ApiResponse<RecurringPayment[]>> {
    return apiSuccess(load());
  }

  async create(request: CreateRecurringRequest): Promise<ApiResponse<RecurringPayment>> {
    const payments = load();
    const payment: RecurringPayment = {
      id: `rec-${Date.now()}`,
      label: request.label,
      type: request.type,
      amount: request.amount,
      ccy: request.currency || 'CRC',
      frequency: request.frequency,
      nextDate: request.next_date,
      recipientPhone: request.recipient_phone,
      recipientName: request.recipient_name,
      serviceProviderId: request.service_provider_id,
      clientId: request.client_id,
      enabled: true,
    };
    payments.push(payment);
    save(payments);
    return apiSuccess(payment);
  }

  async update(id: string, request: Partial<RecurringPayment>): Promise<ApiResponse<void>> {
    const payments = load();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx >= 0) {
      payments[idx] = { ...payments[idx], ...request };
      save(payments);
    }
    return apiSuccess(undefined as unknown as void);
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    save(load().filter((p) => p.id !== id));
    return apiSuccess(undefined as unknown as void);
  }

  async toggle(id: string): Promise<ApiResponse<{ enabled: boolean }>> {
    const payments = load();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx >= 0) {
      payments[idx].enabled = !payments[idx].enabled;
      save(payments);
      return apiSuccess({ enabled: payments[idx].enabled });
    }
    return apiSuccess({ enabled: false });
  }

  async markPaid(id: string): Promise<ApiResponse<RecurringPayment>> {
    const payments = load();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx >= 0) {
      const p = payments[idx];
      const now = new Date();
      const next = new Date(p.nextDate);
      if (p.frequency === 'weekly') next.setDate(next.getDate() + 7);
      else if (p.frequency === 'biweekly') next.setDate(next.getDate() + 14);
      else next.setMonth(next.getMonth() + 1);
      p.lastPaidDate = now.toISOString().split('T')[0];
      p.nextDate = next.toISOString().split('T')[0];
      save(payments);
      return apiSuccess(p);
    }
    return apiSuccess(payments[0]);
  }
}
