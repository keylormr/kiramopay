import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface FeatureFlags {
  budgetTracking: boolean;
  recurringPayments: boolean;
  csvExport: boolean;
  themeScheduling: boolean;
  cryptoStaking: boolean;
  splitPayments: boolean;
  virtualCards: boolean;
  marketplace: boolean;
}

interface FeatureFlagsState {
  flags: FeatureFlags;
  setFlag: (key: keyof FeatureFlags, enabled: boolean) => void;
  resetFlags: () => void;
}

const defaultFlags: FeatureFlags = {
  budgetTracking: true,
  recurringPayments: true,
  csvExport: true,
  themeScheduling: true,
  cryptoStaking: true,
  splitPayments: true,
  virtualCards: true,
  marketplace: true,
};

export const useFeatureFlagsStore = create<FeatureFlagsState>()(
  persist(
    (set) => ({
      flags: defaultFlags,

      setFlag: (key, enabled) =>
        set((s) => ({
          flags: { ...s.flags, [key]: enabled },
        })),

      resetFlags: () => set({ flags: defaultFlags }),
    }),
    {
      name: 'kiramopay-feature-flags',
    },
  ),
);

export function useFeatureFlag(key: keyof FeatureFlags): boolean {
  return useFeatureFlagsStore((s) => s.flags[key]);
}
