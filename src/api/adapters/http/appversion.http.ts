import type { ApiResponse } from '../../types';
import type {
  IAppVersionRepository,
  PlataformaApp,
  VersionApp,
} from '../../repositories/appversion.repository';
import { HttpClient } from './client';

export class HttpAppVersionRepository implements IAppVersionRepository {
  constructor(private client: HttpClient) {}

  async getLatest(plataforma?: PlataformaApp): Promise<ApiResponse<VersionApp>> {
    // Sin plataforma se omite el parametro y el backend asume android: es lo
    // que hacen los APK ya instalados, que no conocen este contrato.
    const query = plataforma ? `?platform=${plataforma}` : '';
    // Publico: la app lo consulta antes de saber si hay sesion.
    return this.client.get<VersionApp>(`/api/v1/app/version${query}`, false);
  }
}
