import type {
  IRecurringRepository,
  CreateRecurringRequest,
} from '../../repositories/recurring.repository';
import type { ApiResponse } from '../../types';
import type { RecurringPayment } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { esFechaValida, hoyLocal, siguienteFecha } from '@/utils/pagosFijos';

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

// Los mismos rechazos que el servidor (backend/internal/recurring), para que
// el modo sin backend no acepte lo que produccion rechaza.
const noEncontrado = () => apiError<never>('RECURRING_NOT_FOUND', 'recurring payment not found');

function validarNombre(label: string): ApiResponse<never> | null {
  const limpio = label.trim();
  if (!limpio) return apiError('RECURRING_LABEL_REQUIRED', 'the payment needs a label');
  if ([...limpio].length > 200) return apiError('RECURRING_LABEL_TOO_LONG', 'the label can have up to 200 characters');
  return null;
}

export class MockRecurringRepository implements IRecurringRepository {
  async getPayments(): Promise<ApiResponse<RecurringPayment[]>> {
    return apiSuccess(load());
  }

  async create(request: CreateRecurringRequest): Promise<ApiResponse<RecurringPayment>> {
    const rechazo = validarNombre(request.label);
    if (rechazo) return rechazo;
    if (!(Math.round(request.amount * 100) > 0)) {
      return apiError('RECURRING_INVALID_AMOUNT', 'amount must be greater than zero');
    }
    if (!esFechaValida(request.next_date)) {
      return apiError('RECURRING_INVALID_DATE', 'next_date must be a YYYY-MM-DD date');
    }
    const payments = load();
    const payment: RecurringPayment = {
      id: `rec-${Date.now()}`,
      label: request.label.trim(),
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
    if (idx < 0) return noEncontrado();
    payments[idx] = { ...payments[idx], ...request };
    save(payments);
    return apiSuccess(undefined as unknown as void);
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    const payments = load();
    if (!payments.some((p) => p.id === id)) return noEncontrado();
    save(payments.filter((p) => p.id !== id));
    return apiSuccess(undefined as unknown as void);
  }

  async toggle(id: string): Promise<ApiResponse<{ enabled: boolean }>> {
    const payments = load();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx < 0) return noEncontrado();
    payments[idx].enabled = !payments[idx].enabled;
    save(payments);
    return apiSuccess({ enabled: payments[idx].enabled });
  }

  // Igual que el servidor: anota hoy y corre la fecha. No mueve dinero.
  async markPaid(id: string): Promise<ApiResponse<RecurringPayment>> {
    const payments = load();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx < 0) return noEncontrado();
    const p = payments[idx];
    p.lastPaidDate = hoyLocal();
    p.nextDate = siguienteFecha(p.nextDate, p.frequency);
    save(payments);
    return apiSuccess(p);
  }
}
