import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  darkMode: boolean;
  offlineMode: boolean;
  isLocked: boolean;
  biometricEnabled: boolean;
  language: 'es' | 'en';
  themeSchedule: 'off' | 'sunrise-sunset' | 'custom';
  themeScheduleStart: string;
  themeScheduleEnd: string;
  /** Menu lateral plegado a riel en pantalla ancha. Preferencia del
   *  dispositivo, como el tema: no es de la cuenta, asi que no se borra al
   *  cerrar sesion (ver limpiarDatosDeUsuario.ts). */
  menuLateralPlegado: boolean;

  toggleDarkMode: () => void;
  alternarMenuLateral: () => void;
  toggleOfflineMode: () => void;
  setLocked: (locked: boolean) => void;
  toggleBiometric: () => void;
  setLanguage: (language: 'es' | 'en') => void;
  setThemeSchedule: (schedule: 'off' | 'sunrise-sunset' | 'custom') => void;
  setThemeScheduleStart: (time: string) => void;
  setThemeScheduleEnd: (time: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Oscuro por defecto: el rediseno de 2026-11 es oscuro y premium. El claro
      // sigue disponible en Perfil para quien lo elija.
      darkMode: true,
      offlineMode: false,
      isLocked: false,
      // Opt-in: la biometria la elige el usuario (la ofrece la app al primer
      // ingreso nativo). Con true por defecto, la oferta jamas se mostraba y
      // el candado intentaba biometria en dispositivos sin sensor enrolado.
      biometricEnabled: false,
      language: 'es',
      themeSchedule: 'off',
      themeScheduleStart: '18:00',
      themeScheduleEnd: '06:00',
      menuLateralPlegado: false,

      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      alternarMenuLateral: () => set((s) => ({ menuLateralPlegado: !s.menuLateralPlegado })),
      toggleOfflineMode: () => set((s) => ({ offlineMode: !s.offlineMode })),
      setLocked: (locked) => set({ isLocked: locked }),
      toggleBiometric: () => set((s) => ({ biometricEnabled: !s.biometricEnabled })),
      setLanguage: (language) => set({ language }),
      setThemeSchedule: (schedule) => set({ themeSchedule: schedule }),
      setThemeScheduleStart: (time) => set({ themeScheduleStart: time }),
      setThemeScheduleEnd: (time) => set({ themeScheduleEnd: time }),
    }),
    {
      name: 'kiramopay-settings',
      // v1: biometricEnabled paso de true-por-defecto a opt-in. Los estados
      // persistidos con el true que nadie eligio se resetean UNA vez; quien
      // lo active de aqui en adelante persiste su eleccion normalmente.
      // v2: el tema oscuro pasa a ser el de la app. El false guardado era el
      // valor por defecto de antes y no se distingue de una eleccion, asi que
      // pasa a oscuro UNA vez; quien vuelva al claro despues lo conserva.
      version: 2,
      migrate: (persisted, version) => {
        let s = persisted as Partial<SettingsState>;
        if (version < 1) {
          s = { ...s, biometricEnabled: false };
        }
        if (version < 2) {
          s = { ...s, darkMode: true };
        }
        return s;
      },
    },
  ),
);
