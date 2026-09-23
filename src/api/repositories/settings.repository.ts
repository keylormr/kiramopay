import type { ApiResponse } from '../types';

export interface AppSettings {
  darkMode: boolean;
  offlineMode: boolean;
  biometricEnabled: boolean;
  language: 'es' | 'en';
}

export interface ISettingsRepository {
  getSettings(): Promise<ApiResponse<AppSettings>>;
  updateSettings(updates: Partial<AppSettings>): Promise<ApiResponse<AppSettings>>;
  toggleDarkMode(): Promise<ApiResponse<AppSettings>>;
  toggleBiometric(): Promise<ApiResponse<AppSettings>>;
}
