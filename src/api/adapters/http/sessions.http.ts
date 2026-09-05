import type { ISessionsRepository, DeviceSession } from '../../repositories/sessions.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

// Tipos escritos a mano a proposito: openapi.d.ts lo regenera otro frente y la
// pantalla no puede quedar rota mientras tanto.
interface SessionDTO {
  id?: string;
  device_name?: string;
  ip_masked?: string;
  created_at?: string;
  expires_at?: string;
  current?: boolean;
}

interface RevokedDTO {
  revoked?: number | boolean;
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function mapSession(d: SessionDTO): DeviceSession {
  return {
    id: String(d.id ?? ''),
    deviceName: String(d.device_name ?? ''),
    ipMasked: String(d.ip_masked ?? ''),
    createdAt: String(d.created_at ?? ''),
    expiresAt: String(d.expires_at ?? ''),
    current: d.current === true,
  };
}

// El codigo del error viaja intacto: la pantalla traduce por codigo y nunca
// muestra el texto crudo del servidor.
function fail<T>(res: ApiResponse<unknown>): ApiResponse<T> {
  return apiError(res.error?.code || 'SESSIONS_FAILED', res.error?.message || 'Session action failed');
}

export class HttpSessionsRepository implements ISessionsRepository {
  constructor(private client: HttpClient) {}

  async listar(): Promise<ApiResponse<DeviceSession[]>> {
    const res = await this.client.get<unknown>('/api/v1/auth/sessions');
    if (!res.success) return fail(res);
    // El stub de E2E responde `data: []` a toda ruta: lo que no sea un objeto
    // no se mapea, en vez de producir filas vacias.
    const filas = Array.isArray(res.data) ? res.data.filter(esObjeto) : [];
    return apiSuccess(filas.map((d) => mapSession(d as SessionDTO)));
  }

  async cerrar(id: string): Promise<ApiResponse<void>> {
    const res = await this.client.post<unknown>(
      `/api/v1/auth/sessions/${encodeURIComponent(id)}/revoke`,
      {},
    );
    if (!res.success) return fail(res);
    return apiSuccess<void>(undefined);
  }

  async cerrarLasDemas(): Promise<ApiResponse<number>> {
    const res = await this.client.post<unknown>('/api/v1/auth/sessions/revoke-others', {});
    if (!res.success) return fail(res);
    const n = esObjeto(res.data) ? Number((res.data as RevokedDTO).revoked) : NaN;
    return apiSuccess(Number.isFinite(n) ? n : 0);
  }
}
