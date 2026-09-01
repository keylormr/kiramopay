import type { ApiResponse } from '../types';

// Ultima version del APK publicada (la sirve el backend desde el release).
export interface VersionApp {
  version: string;
  url: string;
}

export interface IAppVersionRepository {
  getLatest(): Promise<ApiResponse<VersionApp>>;
}
