import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BusinessState {
  // Id of the merchant the app is currently acting as, or null for the personal
  // profile. Persisted so an owner who works in business mode stays there
  // between sessions instead of landing on the personal wallet every launch.
  activeMerchantId: string | null;
  setActiveMerchant: (id: string | null) => void;
}

export const useBusinessStore = create<BusinessState>()(
  persist(
    (set) => ({
      activeMerchantId: null,
      setActiveMerchant: (id) => set({ activeMerchantId: id }),
    }),
    { name: 'kiramopay-business' },
  ),
);
