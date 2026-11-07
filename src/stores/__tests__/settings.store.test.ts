import { useSettingsStore } from '../settings.store';

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      darkMode: false,
      offlineMode: false,
      isLocked: false,
      biometricEnabled: true,
      language: 'es',
    });
  });

  it('should have correct initial state', () => {
    const state = useSettingsStore.getState();
    expect(state.darkMode).toBe(false);
    expect(state.offlineMode).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(state.biometricEnabled).toBe(true);
    expect(state.language).toBe('es');
  });

  it('should toggle dark mode on', () => {
    useSettingsStore.getState().toggleDarkMode();
    expect(useSettingsStore.getState().darkMode).toBe(true);
  });

  it('should toggle dark mode off', () => {
    useSettingsStore.getState().toggleDarkMode();
    useSettingsStore.getState().toggleDarkMode();
    expect(useSettingsStore.getState().darkMode).toBe(false);
  });

  it('should toggle offline mode on', () => {
    useSettingsStore.getState().toggleOfflineMode();
    expect(useSettingsStore.getState().offlineMode).toBe(true);
  });

  it('should toggle offline mode off', () => {
    useSettingsStore.getState().toggleOfflineMode();
    useSettingsStore.getState().toggleOfflineMode();
    expect(useSettingsStore.getState().offlineMode).toBe(false);
  });

  it('should set locked to true', () => {
    useSettingsStore.getState().setLocked(true);
    expect(useSettingsStore.getState().isLocked).toBe(true);
  });

  it('should set locked to false', () => {
    useSettingsStore.getState().setLocked(true);
    useSettingsStore.getState().setLocked(false);
    expect(useSettingsStore.getState().isLocked).toBe(false);
  });

  it('should toggle biometric off', () => {
    expect(useSettingsStore.getState().biometricEnabled).toBe(true);
    useSettingsStore.getState().toggleBiometric();
    expect(useSettingsStore.getState().biometricEnabled).toBe(false);
  });

  it('should toggle biometric back on', () => {
    useSettingsStore.getState().toggleBiometric();
    useSettingsStore.getState().toggleBiometric();
    expect(useSettingsStore.getState().biometricEnabled).toBe(true);
  });

  it('should set language to English', () => {
    useSettingsStore.getState().setLanguage('en');
    expect(useSettingsStore.getState().language).toBe('en');
  });

  it('should set language back to Spanish', () => {
    useSettingsStore.getState().setLanguage('en');
    useSettingsStore.getState().setLanguage('es');
    expect(useSettingsStore.getState().language).toBe('es');
  });

  it('should not affect other settings when toggling one', () => {
    useSettingsStore.getState().toggleDarkMode();
    const state = useSettingsStore.getState();
    expect(state.darkMode).toBe(true);
    expect(state.offlineMode).toBe(false);
    expect(state.biometricEnabled).toBe(true);
    expect(state.language).toBe('es');
    expect(state.isLocked).toBe(false);
  });
});

// El rediseno de 2026-11 es oscuro: la app arranca en oscuro y quien tenia
// guardado el `false` de antes (el valor por defecto, nadie lo eligio) pasa a
// oscuro una sola vez. Quien vuelva al claro despues lo conserva.
describe('useSettingsStore: tema oscuro por defecto (version 2)', () => {
  const migrar = (estado: Record<string, unknown>, version: number) =>
    useSettingsStore.persist.getOptions().migrate!(estado, version) as Record<string, unknown>;

  it('la version guardada es la 2', () => {
    expect(useSettingsStore.persist.getOptions().version).toBe(2);
  });

  it('desde la version 1, el claro guardado pasa a oscuro y lo demas queda igual', () => {
    const migrado = migrar({ darkMode: false, biometricEnabled: true, language: 'en' }, 1);
    expect(migrado.darkMode).toBe(true);
    expect(migrado.biometricEnabled).toBe(true);
    expect(migrado.language).toBe('en');
  });

  it('desde la version 0, aplica las dos migraciones', () => {
    const migrado = migrar({ darkMode: false, biometricEnabled: true }, 0);
    expect(migrado.darkMode).toBe(true);
    expect(migrado.biometricEnabled).toBe(false);
  });

  it('ya en la version 2, una eleccion del claro se respeta', () => {
    const migrado = migrar({ darkMode: false }, 2);
    expect(migrado.darkMode).toBe(false);
  });
});

describe('menu lateral plegado (preferencia del dispositivo)', () => {
  it('arranca desplegado, se alterna y se guarda con los ajustes', () => {
    localStorage.clear();
    useSettingsStore.setState({ menuLateralPlegado: false });
    useSettingsStore.getState().alternarMenuLateral();
    expect(useSettingsStore.getState().menuLateralPlegado).toBe(true);
    const guardado = JSON.parse(localStorage.getItem('kiramopay-settings') ?? '{}');
    expect(guardado.state.menuLateralPlegado).toBe(true);
    useSettingsStore.getState().alternarMenuLateral();
    expect(useSettingsStore.getState().menuLateralPlegado).toBe(false);
  });
});
