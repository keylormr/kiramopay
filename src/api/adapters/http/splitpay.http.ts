import type {
  ISplitPayRepository,
  SplitGroup,
  SplitDetail,
  CreateSplitRequest,
} from '../../repositories/splitpay.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';
import { traducirFueraDeReact } from '@/i18n/mensajesDeError';

export class HttpSplitPayRepository implements ISplitPayRepository {
  constructor(private client: HttpClient) {}

  async createSplit(request: CreateSplitRequest): Promise<ApiResponse<SplitDetail>> {
    const res = await this.client.post<{
      group: {
        id: string; creator_id: string; title: string; description: string;
        total_amount: number; currency: string; split_type: string; status: string;
        created_at: string;
      };
      shares: Array<{
        id: string; group_id: string; user_id: string; user_phone: string;
        user_name: string; amount: number; status: string;
      }>;
    }>('/api/v1/splits', {
      title: request.title,
      description: request.description,
      // Math.round: el backend recibe centimos en un entero de 64 bits. Un
      // decimal suelto (33.33 * 100 = 3332.9999...) no decodifica y tumba la
      // peticion entera con un error que no dice nada.
      total_amount: Math.round(request.totalAmount * 100),
      currency: request.currency,
      split_type: request.splitType,
      participants: request.participants.map((p) => ({
        user_id: p.userId,
        user_phone: p.userPhone,
        user_name: p.userName,
        amount: p.amount ? Math.round(p.amount * 100) : 0,
        percentage: p.percentage,
      })),
    });

    // El codigo real (SPLIT_SELF_INCLUDED, SPLIT_EXCEEDS_TOTAL, etc.) tiene que
    // sobrevivir hasta la vista: ahi es donde CLAVES_ERROR_CREAR lo traduce. Si
    // se pisa con un literal generico, la vista nunca matchea nada y muestra el
    // texto crudo del servidor tal cual (hallazgo QA n=52).
    if (!res.success) return apiError(res.error?.code || 'CREATE_FAILED', res.error?.message || 'Failed');
    if (!res.data) return apiError('CREATE_FAILED', 'Failed');

    return apiSuccess({
      group: mapGroup(res.data.group),
      shares: res.data.shares.map(mapShare),
    });
  }

  async listSplits(): Promise<ApiResponse<SplitGroup[]>> {
    const res = await this.client.get<Array<{
      id: string; creator_id: string; title: string; description: string;
      total_amount: number; currency: string; split_type: string; status: string;
      created_at: string;
    }> | null>('/api/v1/splits');

    if (!res.success) return apiError(res.error?.code || 'FETCH_FAILED', res.error?.message || traducirFueraDeReact('err_generic'));

    // Un payload null es "sin divisiones todavia", no una falla: el backend ya
    // normaliza la lista nil a [] (ver listaVaciaSiNil en el propio backend),
    // pero esta guarda queda igual que en cards.http.ts por si algun consumidor
    // futuro de este endpoint no pasa por esa normalizacion.
    return apiSuccess(Array.isArray(res.data) ? res.data.map(mapGroup) : []);
  }

  async getSplit(groupId: string): Promise<ApiResponse<SplitDetail>> {
    const res = await this.client.get<{
      group: {
        id: string; creator_id: string; title: string; description: string;
        total_amount: number; currency: string; split_type: string; status: string;
        created_at: string;
      };
      shares: Array<{
        id: string; group_id: string; user_id: string; user_phone: string;
        user_name: string; amount: number; status: string; paid_at: string;
      }>;
    }>(`/api/v1/splits/${groupId}`);

    if (!res.success) return falla(res, 'NOT_FOUND');
    if (!res.data) return apiError('NOT_FOUND', traducirFueraDeReact('err_generic'));

    return apiSuccess({
      group: mapGroup(res.data.group),
      shares: res.data.shares.map(mapShare),
    });
  }

  async payShare(groupId: string): Promise<ApiResponse<void>> {
    const res = await this.client.post(`/api/v1/splits/${groupId}/pay`);
    if (!res.success) return falla(res, 'PAY_FAILED');
    return apiSuccess(undefined as unknown as void);
  }

  async declineShare(groupId: string): Promise<ApiResponse<void>> {
    const res = await this.client.post(`/api/v1/splits/${groupId}/decline`);
    if (!res.success) return falla(res, 'DECLINE_FAILED');
    return apiSuccess(undefined as unknown as void);
  }

  async cancelSplit(groupId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/splits/${groupId}`);
    if (!res.success) return falla(res, 'CANCEL_FAILED');
    return apiSuccess(undefined as unknown as void);
  }
}

// Ver el detalle, pagar, rechazar y cancelar pisaban el codigo del cliente con
// el suyo, y SplitPayView nunca veia NETWORK_ERROR, SESSION_EXPIRED,
// RATE_LIMITED ni ACCOUNT_BLOCKED, que el cliente ya trae traducidos: a quien
// estaba sin conexion le decia que no se pudo pagar. El codigo del modulo queda
// solo para cuando no viene ninguno; los rechazos propios del servidor en estas
// rutas ya son ese mismo codigo.
function falla<T>(res: { error?: { code?: string; message?: string } }, codigoDelModulo: string): ApiResponse<T> {
  return apiError<T>(res.error?.code || codigoDelModulo, res.error?.message || traducirFueraDeReact('err_generic'));
}

function mapGroup(g: {
  id: string; creator_id: string; title: string; description: string;
  total_amount: number; currency: string; split_type: string; status: string;
  created_at: string;
}): SplitGroup {
  return {
    id: g.id,
    creatorId: g.creator_id,
    title: g.title,
    description: g.description || undefined,
    totalAmount: g.total_amount / 100,
    currency: g.currency,
    splitType: g.split_type as SplitGroup['splitType'],
    status: g.status as SplitGroup['status'],
    createdAt: g.created_at,
  };
}

function mapShare(s: {
  id: string; group_id: string; user_id: string; user_phone: string;
  user_name: string; amount: number; status: string; paid_at?: string;
}) {
  return {
    id: s.id,
    groupId: s.group_id,
    userId: s.user_id || undefined,
    userPhone: s.user_phone || undefined,
    userName: s.user_name,
    amount: s.amount / 100,
    status: s.status as 'pending' | 'paid' | 'declined',
    paidAt: s.paid_at || undefined,
  };
}
