import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Account, Budget } from '@/types';
import { initialAccounts, initialBudgets } from '@/api/adapters/mock/mock-data';

const hasBackend = !!import.meta.env.VITE_API_URL;

interface CardState {
  frozen: boolean;
  last4: string;
  limits: { online: number; atm: number };
}

interface AccountState {
  baseCurrency: string;
  accounts: Account[];
  budgets: Budget[];
  cards: CardState;

  setBaseCurrency: (ccy: string) => void;
  setAccounts: (accounts: Account[]) => void;
  setBudgets: (budgets: Budget[]) => void;
  addAccount: (account: Account) => void;
  updateAccountBalance: (ccy: string, delta: number) => void;
  toggleFreeze: () => void;
  updateLimits: (limits: { online: number; atm: number }) => void;
  updateBudgetSpent: (id: string, spent: number) => void;
  addBudget: (budget: Budget) => void;
  removeBudget: (id: string) => void;
  updateBudget: (id: string, updates: Partial<Budget>) => void;
  resetBudgets: () => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set) => ({
      baseCurrency: 'CRC',
      accounts: hasBackend ? [] : initialAccounts,
      budgets: hasBackend ? [] : initialBudgets,
      cards: {
        frozen: false,
        last4: '8842',
        limits: { online: 500000, atm: 200000 },
      },

      setBaseCurrency: (ccy) => set({ baseCurrency: ccy }),

      setAccounts: (accounts) => set({ accounts }),

      setBudgets: (budgets) => set({ budgets }),

      addAccount: (account) =>
        set((s) => {
          if (s.accounts.find((a) => a.ccy === account.ccy)) return s;
          return { accounts: [...s.accounts, account] };
        }),

      updateAccountBalance: (ccy, delta) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.ccy === ccy ? { ...a, balance: a.balance + delta } : a,
          ),
        })),

      toggleFreeze: () =>
        set((s) => ({ cards: { ...s.cards, frozen: !s.cards.frozen } })),

      updateLimits: (limits) =>
        set((s) => ({ cards: { ...s.cards, limits } })),

      updateBudgetSpent: (id, spent) =>
        set((s) => ({
          budgets: s.budgets.map((b) => (b.id === id ? { ...b, spent } : b)),
        })),

      addBudget: (budget) =>
        set((s) => ({ budgets: [...s.budgets, budget] })),

      removeBudget: (id) =>
        set((s) => ({ budgets: s.budgets.filter((b) => b.id !== id) })),

      updateBudget: (id, updates) =>
        set((s) => ({
          budgets: s.budgets.map((b) => (b.id === id ? { ...b, ...updates } : b)),
        })),

      resetBudgets: () =>
        set((s) => ({
          budgets: s.budgets.map((b) => ({ ...b, spent: 0 })),
        })),
    }),
    {
      name: 'kiramopay-accounts',
    },
  ),
);
