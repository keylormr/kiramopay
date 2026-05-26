import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SinpeContact, SinpeTransaction } from '@/types';
import { initialSinpeContacts, initialSinpeHistory } from '@/api/adapters/mock/mock-data';

const hasBackend = !!import.meta.env.VITE_API_URL;

interface SinpeState {
  sinpeContacts: SinpeContact[];
  sinpeHistory: SinpeTransaction[];

  setContacts: (contacts: SinpeContact[]) => void;
  setHistory: (history: SinpeTransaction[]) => void;
  addContact: (contact: SinpeContact) => void;
  addTransaction: (tx: SinpeTransaction) => void;
}

export const useSinpeStore = create<SinpeState>()(
  persist(
    (set) => ({
      sinpeContacts: hasBackend ? [] : initialSinpeContacts,
      sinpeHistory: hasBackend ? [] : initialSinpeHistory,

      setContacts: (contacts) => set({ sinpeContacts: contacts }),

      setHistory: (history) => set({ sinpeHistory: history }),

      addContact: (contact) =>
        set((s) => ({ sinpeContacts: [...s.sinpeContacts, contact] })),

      addTransaction: (tx) =>
        set((s) => ({ sinpeHistory: [tx, ...s.sinpeHistory] })),
    }),
    {
      name: 'kiramopay-sinpe',
    },
  ),
);
