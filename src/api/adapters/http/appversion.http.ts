import type { ApiResponse } from '../../types';
import type { IAppVersionRepository, VersionApp } from '../../repositories/appversion.repository';
import { HttpClient } from './client';

export class HttpAppVersionRepository implements IAppVersionRepository {
  constructor(private client: HttpClient) {}

  async getLatest(): Promise<ApiResponse<VersionApp>> {
    // Publico: la app lo consulta antes de saber si hay sesion.
    return this.client.get<VersionApp>('/api/v1/app/version', false);
  }
}
