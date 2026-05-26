import type { ISettingsRepository, AppSettings } from '../../repositories/settings.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess } from '../../types';

const STORAGE_KEY = 'kiramopay_app_state';

const defaultSettings: AppSettings = {
  darkMode: false,
  offlineMode: false,
  biometricEnabled: true,
  notificationsEnabled: true,
  language: 'es',
};

function getSettings(): AppSettings {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const state = data ? JSON.parse(data) : null;
    return state?.settings ? { ...defaultSettings, ...state.settings } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: AppSettings) {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const state = data ? JSON.parse(data) : {};
    state.settings = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // noop
  }
}

export class MockSettingsRepository implements ISettingsRepository {
  async getSettings(): Promise<ApiResponse<AppSettings>> {
    return apiSuccess(getSettings());
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<ApiResponse<AppSettings>> {
    const settings = { ...getSettings(), ...updates };
    saveSettings(settings);
    return apiSuccess(settings);
  }

  async toggleDarkMode(): Promise<ApiResponse<AppSettings>> {
    const settings = getSettings();
    settings.darkMode = !settings.darkMode;
    saveSettings(settings);
    return apiSuccess(settings);
  }

  async toggleBiometric(): Promise<ApiResponse<AppSettings>> {
    const settings = getSettings();
    settings.biometricEnabled = !settings.biometricEnabled;
    saveSettings(settings);
    return apiSuccess(settings);
  }
}
