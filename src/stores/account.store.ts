import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Account, Budget } from '@/types';
import { initialAccounts, initialBudgets } from '@/api/adapters/mock/mock-data';
import { fusionConArrays } from './fusionPersistida';

const hasBackend = !!import.meta.env.VITE_API_URL;

interface AccountState {
  baseCurrency: string;
  accounts: Account[];
  budgets: Budget[];

  setBaseCurrency: (ccy: string) => void;
  setAccounts: (accounts: Account[]) => void;
  setBudgets: (budgets: Budget[]) => void;
  addAccount: (account: Account) => void;
  updateAccountBalance: (ccy: string, delta: number) => void;
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

      setBaseCurrency: (ccy) => set({ baseCurrency: ccy }),

      // La lista del servidor manda, y la moneda base tiene que ser una de
      // ella. Antes "Agregar cuenta" creaba una cuenta solo en el telefono y
      // la dejaba como base; al sincronizar la cuenta desaparecia pero la base
      // seguia apuntando a ella (el rotulo decia "GBP · Base" sobre un saldo en
      // colones), guardada en localStorage hasta que alguien tocara otra.
      setAccounts: (accounts) =>
        set((s) => {
          if (accounts.length === 0 || accounts.some((a) => a.ccy === s.baseCurrency)) {
            return { accounts };
          }
          const base = accounts.find((a) => a.ccy === 'CRC') ?? accounts[0];
          return { accounts, baseCurrency: base.ccy };
        }),

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
      // Un blob viejo o a medias puede traer estos campos con otra
      // forma; recorrerlos en el render tumba la aplicacion entera.
      merge: fusionConArrays<AccountState>(['accounts', 'budgets']),
    },
  ),
);
