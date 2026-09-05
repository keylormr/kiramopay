import type {
  IAdminRepository,
  AdminUser,
  AdminUserStatus,
} from '../../repositories/admin.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

interface AdminUserDTO {
  id?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  cedula_masked?: string;
  phone_masked?: string;
  email_masked?: string;
  status?: string;
  role?: string;
  kyc_level?: number | string;
  created_at?: string;
  last_login_at?: string | null;
  blocked_at?: string | null;
  blocked_reason?: string | null;
  blocked_by_name?: string | null;
  expires_at?: string | null;
}

const STATUSES: readonly AdminUserStatus[] = ['active', 'blocked', 'suspended', 'closed'];

function mapStatus(raw: unknown): AdminUserStatus {
  return STATUSES.includes(raw as AdminUserStatus) ? (raw as AdminUserStatus) : 'active';
}

function mapAdminUser(d: AdminUserDTO): AdminUser {
  return {
    id: String(d.id ?? ''),
    firstName: String(d.first_name ?? ''),
    lastName: String(d.last_name ?? ''),
    username: String(d.username ?? ''),
    cedulaMasked: String(d.cedula_masked ?? ''),
    phoneMasked: String(d.phone_masked ?? ''),
    emailMasked: String(d.email_masked ?? ''),
    status: mapStatus(d.status),
    role: String(d.role ?? 'user'),
    kycLevel: Number(d.kyc_level) || 0,
    createdAt: String(d.created_at ?? ''),
    lastLoginAt: d.last_login_at ?? null,
    blockedAt: d.blocked_at ?? null,
    blockedReason: String(d.blocked_reason ?? ''),
    blockedByName: String(d.blocked_by_name ?? ''),
    expiresAt: d.expires_at ?? null,
  };
}

function isUserDTO(v: unknown): v is AdminUserDTO {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// The E2E stub answers `data: []` to every route, so a list may be missing and
// a single-object endpoint may hand back an array: only real objects map.
function mapList(data: unknown): AdminUser[] {
  return Array.isArray(data) ? data.filter(isUserDTO).map(mapAdminUser) : [];
}

function fail<T>(res: ApiResponse<unknown>): ApiResponse<T> {
  return apiError(res.error?.code || 'ADMIN_ACTION_FAILED', res.error?.message || 'Admin action failed');
}

export class HttpAdminRepository implements IAdminRepository {
  constructor(private client: HttpClient) {}

  async searchUsers(term: string): Promise<ApiResponse<AdminUser[]>> {
    // El termino va en el cuerpo, nunca en la URL: una cedula o un correo en la
    // query string quedarian en logs de proxies y del proveedor.
    const res = await this.client.post<unknown>('/api/v1/admin/users/search', { q: term.trim(), limit: 20 });
    if (!res.success) return fail(res);
    return apiSuccess(mapList(res.data));
  }

  async listBlockedUsers(): Promise<ApiResponse<AdminUser[]>> {
    const res = await this.client.get<unknown>('/api/v1/admin/users/blocked?limit=50');
    if (!res.success) return fail(res);
    return apiSuccess(mapList(res.data));
  }

  async getUser(id: string): Promise<ApiResponse<AdminUser>> {
    const res = await this.client.get<unknown>(`/api/v1/admin/users/${encodeURIComponent(id)}`);
    if (!res.success || !isUserDTO(res.data)) return fail(res);
    return apiSuccess(mapAdminUser(res.data));
  }

  async blockUser(id: string, reason: string): Promise<ApiResponse<AdminUser>> {
    const res = await this.client.post<unknown>(`/api/v1/admin/users/${encodeURIComponent(id)}/block`, { reason });
    if (!res.success || !isUserDTO(res.data)) return fail(res);
    return apiSuccess(mapAdminUser(res.data));
  }

  async unblockUser(id: string): Promise<ApiResponse<AdminUser>> {
    const res = await this.client.post<unknown>(`/api/v1/admin/users/${encodeURIComponent(id)}/unblock`, {});
    if (!res.success || !isUserDTO(res.data)) return fail(res);
    return apiSuccess(mapAdminUser(res.data));
  }

  async setUserExpiry(id: string, expiresAt: string | null): Promise<ApiResponse<AdminUser>> {
    // La clave viaja siempre, tambien cuando vale null: para el servidor un
    // cuerpo sin ella es un error, no una orden de quitar el vencimiento.
    const res = await this.client.post<unknown>(
      `/api/v1/admin/users/${encodeURIComponent(id)}/expiry`,
      { expires_at: expiresAt },
    );
    if (!res.success || !isUserDTO(res.data)) return fail(res);
    return apiSuccess(mapAdminUser(res.data));
  }
}
