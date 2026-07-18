import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Transaction } from '@/types';
import { initialTransactions } from '@/api/adapters/mock/mock-data';

const hasBackend = !!import.meta.env.VITE_API_URL;

interface TransactionState {
  transactions: Transaction[];

  setTransactions: (transactions: Transaction[]) => void;
  addTransaction: (transaction: Transaction) => void;
}

export const useTransactionStore = create<TransactionState>()(
  persist(
    (set) => ({
      transactions: hasBackend ? [] : initialTransactions,

      setTransactions: (transactions) => set({ transactions }),

      addTransaction: (transaction) =>
        set((s) => ({
          transactions: [
            // Stamp a machine timestamp for date filtering if the caller didn't
            // provide one (locally-created optimistic transactions).
            { ...transaction, dateISO: transaction.dateISO ?? new Date().toISOString() },
            ...s.transactions,
          ],
        })),
    }),
    {
      name: 'kiramopay-transactions',
    },
  ),
);
