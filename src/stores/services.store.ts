import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SavedService, Bill, Recharge } from '@/types';
import { initialSavedServices, initialRechargeHistory } from '@/api/adapters/mock/mock-data';

const hasBackend = !!import.meta.env.VITE_API_URL;

interface ServicesState {
  savedServices: SavedService[];
  billHistory: Bill[];
  rechargeHistory: Recharge[];
  connectedPartners: string[];

  setSavedServices: (services: SavedService[]) => void;
  setBillHistory: (bills: Bill[]) => void;
  setRechargeHistory: (recharges: Recharge[]) => void;
  addSavedService: (service: SavedService) => void;
  addBillPayment: (bill: Bill) => void;
  addRecharge: (recharge: Recharge) => void;
  connectPartner: (partnerId: string) => void;
  disconnectPartner: (partnerId: string) => void;
}

export const useServicesStore = create<ServicesState>()(
  persist(
    (set) => ({
      savedServices: hasBackend ? [] : initialSavedServices,
      billHistory: [],
      rechargeHistory: hasBackend ? [] : initialRechargeHistory,
      connectedPartners: ['uber', 'ubereats'],

      setSavedServices: (services) => set({ savedServices: services }),

      setBillHistory: (bills) => set({ billHistory: bills }),

      setRechargeHistory: (recharges) => set({ rechargeHistory: recharges }),

      addSavedService: (service) =>
        set((s) => ({ savedServices: [...s.savedServices, service] })),

      addBillPayment: (bill) =>
        set((s) => ({ billHistory: [bill, ...s.billHistory] })),

      addRecharge: (recharge) =>
        set((s) => ({ rechargeHistory: [recharge, ...s.rechargeHistory] })),

      connectPartner: (partnerId) =>
        set((s) => {
          if (s.connectedPartners.includes(partnerId)) return s;
          return { connectedPartners: [...s.connectedPartners, partnerId] };
        }),

      disconnectPartner: (partnerId) =>
        set((s) => ({
          connectedPartners: s.connectedPartners.filter((p) => p !== partnerId),
        })),
    }),
    {
      name: 'kiramopay-services',
    },
  ),
);
