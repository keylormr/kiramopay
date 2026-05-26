import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  darkMode: boolean;
  offlineMode: boolean;
  isLocked: boolean;
  biometricEnabled: boolean;
  notificationsEnabled: boolean;
  language: 'es' | 'en';
  themeSchedule: 'off' | 'sunrise-sunset' | 'custom';
  themeScheduleStart: string;
  themeScheduleEnd: string;

  toggleDarkMode: () => void;
  toggleOfflineMode: () => void;
  setLocked: (locked: boolean) => void;
  toggleBiometric: () => void;
  toggleNotifications: () => void;
  setLanguage: (language: 'es' | 'en') => void;
  setThemeSchedule: (schedule: 'off' | 'sunrise-sunset' | 'custom') => void;
  setThemeScheduleStart: (time: string) => void;
  setThemeScheduleEnd: (time: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      darkMode: false,
      offlineMode: false,
      isLocked: false,
      biometricEnabled: true,
      notificationsEnabled: true,
      language: 'es',
      themeSchedule: 'off',
      themeScheduleStart: '18:00',
      themeScheduleEnd: '06:00',

      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      toggleOfflineMode: () => set((s) => ({ offlineMode: !s.offlineMode })),
      setLocked: (locked) => set({ isLocked: locked }),
      toggleBiometric: () => set((s) => ({ biometricEnabled: !s.biometricEnabled })),
      toggleNotifications: () => set((s) => ({ notificationsEnabled: !s.notificationsEnabled })),
      setLanguage: (language) => set({ language }),
      setThemeSchedule: (schedule) => set({ themeSchedule: schedule }),
      setThemeScheduleStart: (time) => set({ themeScheduleStart: time }),
      setThemeScheduleEnd: (time) => set({ themeScheduleEnd: time }),
    }),
    {
      name: 'kiramopay-settings',
    },
  ),
);
