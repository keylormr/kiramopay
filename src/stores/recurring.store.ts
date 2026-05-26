import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RecurringPayment } from '@/types';

const hasBackend = !!import.meta.env.VITE_API_URL;

const initialPayments: RecurringPayment[] = [
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

interface RecurringState {
  payments: RecurringPayment[];

  setPayments: (payments: RecurringPayment[]) => void;
  addPayment: (payment: RecurringPayment) => void;
  removePayment: (id: string) => void;
  togglePayment: (id: string) => void;
  updatePayment: (id: string, updates: Partial<RecurringPayment>) => void;
  markPaid: (id: string) => void;
}

export const useRecurringStore = create<RecurringState>()(
  persist(
    (set) => ({
      payments: hasBackend ? [] : initialPayments,

      setPayments: (payments) => set({ payments }),

      addPayment: (payment) =>
        set((s) => ({ payments: [...s.payments, payment] })),

      removePayment: (id) =>
        set((s) => ({ payments: s.payments.filter((p) => p.id !== id) })),

      togglePayment: (id) =>
        set((s) => ({
          payments: s.payments.map((p) =>
            p.id === id ? { ...p, enabled: !p.enabled } : p,
          ),
        })),

      updatePayment: (id, updates) =>
        set((s) => ({
          payments: s.payments.map((p) =>
            p.id === id ? { ...p, ...updates } : p,
          ),
        })),

      markPaid: (id) =>
        set((s) => ({
          payments: s.payments.map((p) => {
            if (p.id !== id) return p;
            const now = new Date();
            const next = new Date(p.nextDate);
            if (p.frequency === 'weekly') next.setDate(next.getDate() + 7);
            else if (p.frequency === 'biweekly')
              next.setDate(next.getDate() + 14);
            else next.setMonth(next.getMonth() + 1);
            return {
              ...p,
              lastPaidDate: now.toISOString().split('T')[0],
              nextDate: next.toISOString().split('T')[0],
            };
          }),
        })),
    }),
    {
      name: 'kiramopay-recurring',
    },
  ),
);
