import { useSettingsStore } from '../settings.store';

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      darkMode: false,
      offlineMode: false,
      isLocked: false,
      biometricEnabled: true,
      notificationsEnabled: true,
      language: 'es',
    });
  });

  it('should have correct initial state', () => {
    const state = useSettingsStore.getState();
    expect(state.darkMode).toBe(false);
    expect(state.offlineMode).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(state.biometricEnabled).toBe(true);
    expect(state.notificationsEnabled).toBe(true);
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

  it('should toggle notifications off', () => {
    expect(useSettingsStore.getState().notificationsEnabled).toBe(true);
    useSettingsStore.getState().toggleNotifications();
    expect(useSettingsStore.getState().notificationsEnabled).toBe(false);
  });

  it('should toggle notifications back on', () => {
    useSettingsStore.getState().toggleNotifications();
    useSettingsStore.getState().toggleNotifications();
    expect(useSettingsStore.getState().notificationsEnabled).toBe(true);
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
    expect(state.notificationsEnabled).toBe(true);
    expect(state.language).toBe('es');
    expect(state.isLocked).toBe(false);
  });
});
