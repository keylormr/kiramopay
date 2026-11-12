import type { ApiResponse } from '../../types';
import type {
  CanalApp,
  IAppVersionRepository,
  PlataformaApp,
  VersionApp,
} from '../../repositories/appversion.repository';
import { HttpClient } from './client';

export class HttpAppVersionRepository implements IAppVersionRepository {
  constructor(private client: HttpClient) {}

  async getLatest(plataforma?: PlataformaApp, canal?: CanalApp): Promise<ApiResponse<VersionApp>> {
    // Sin plataforma se omite el parametro y el backend asume android: es lo
    // que hacen los APK ya instalados, que no conocen este contrato. Con el
    // canal igual: solo se manda el de Play, y el del APK queda como siempre.
    const partes: string[] = [];
    if (plataforma) partes.push(`platform=${plataforma}`);
    if (canal === 'play') partes.push('channel=play');
    const query = partes.length > 0 ? `?${partes.join('&')}` : '';
    // Publico: la app lo consulta antes de saber si hay sesion.
    return this.client.get<VersionApp>(`/api/v1/app/version${query}`, false);
  }
}
