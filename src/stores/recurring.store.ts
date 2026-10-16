import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RecurringPayment } from '@/types';


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
      // Vacio aun sin servidor: la pantalla pide los pagos al repositorio al
      // abrirse, y el de la demo los da en el idioma de la app. Una copia aqui
      // se armaba al importar, en espanol, antes de que cargara el idioma.
      payments: [],

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
