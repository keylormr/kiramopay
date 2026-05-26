import type { ISettingsRepository, AppSettings } from '../../repositories/settings.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess } from '../../types';

// Settings remain client-side (Zustand persists to localStorage)
export class HttpSettingsRepository implements ISettingsRepository {
  private readonly KEY = 'kiramopay_settings';

  private load(): AppSettings {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw
        ? JSON.parse(raw)
        : {
            darkMode: false,
            offlineMode: false,
            biometricEnabled: false,
            notificationsEnabled: true,
            language: 'es' as const,
          };
    } catch {
      return {
        darkMode: false,
        offlineMode: false,
        biometricEnabled: false,
        notificationsEnabled: true,
        language: 'es' as const,
      };
    }
  }

  private save(settings: AppSettings): void {
    localStorage.setItem(this.KEY, JSON.stringify(settings));
  }

  async getSettings(): Promise<ApiResponse<AppSettings>> {
    return apiSuccess(this.load());
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<ApiResponse<AppSettings>> {
    const settings = { ...this.load(), ...updates };
    this.save(settings);
    return apiSuccess(settings);
  }

  async toggleDarkMode(): Promise<ApiResponse<AppSettings>> {
    const settings = this.load();
    settings.darkMode = !settings.darkMode;
    this.save(settings);
    return apiSuccess(settings);
  }

  async toggleBiometric(): Promise<ApiResponse<AppSettings>> {
    const settings = this.load();
    settings.biometricEnabled = !settings.biometricEnabled;
    this.save(settings);
    return apiSuccess(settings);
  }
}
