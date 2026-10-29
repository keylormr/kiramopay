import type {
  IEscrowRepository,
  EscrowAgreement,
  EscrowAdminPage,
  EscrowStatus,
  CreateEscrowRequest,
} from '../../repositories/escrow.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess } from '../../types';
import { falla } from './falla';
import { HttpClient } from './client';

interface RawAgreement {
  id: string;
  buyer_id: string;
  seller_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  description: string;
  dispute_reason?: string;
  created_at: string;
  updated_at: string;
  delivered_at?: string;
  deliver_by?: string;
  review_by?: string;
  closed_by_expiry?: string;
  disputed_at?: string;
  funded_at?: string;
  released_at?: string;
  refunded_at?: string;
  cancelled_at?: string;
  counterparty_name?: string;
}

function mapAgreement(r: RawAgreement): EscrowAgreement {
  return {
    id: r.id,
    buyerId: r.buyer_id,
    sellerId: r.seller_id,
    amountMinor: r.amount_minor,
    currency: r.currency,
    status: r.status as EscrowStatus,
    description: r.description,
    disputeReason: r.dispute_reason || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deliveredAt: r.delivered_at || undefined,
    deliverBy: r.deliver_by || undefined,
    reviewBy: r.review_by || undefined,
    closedByExpiry:
      r.closed_by_expiry === 'entrega' || r.closed_by_expiry === 'revision' ? r.closed_by_expiry : undefined,
    disputedAt: r.disputed_at || undefined,
    fundedAt: r.funded_at || undefined,
    releasedAt: r.released_at || undefined,
    refundedAt: r.refunded_at || undefined,
    cancelledAt: r.cancelled_at || undefined,
    counterpartyName: r.counterparty_name || undefined,
  };
}

export class HttpEscrowRepository implements IEscrowRepository {
  constructor(private client: HttpClient) {}

  async list(limit = 50): Promise<ApiResponse<EscrowAgreement[]>> {
    const res = await this.client.get<RawAgreement[]>(`/api/v1/escrow?limit=${limit}`);
    if (!res.success || !res.data) {
      return falla(res, 'ESCROW_LIST_FAILED');
    }
    return apiSuccess(res.data.map(mapAgreement));
  }

  async get(id: string): Promise<ApiResponse<EscrowAgreement>> {
    const res = await this.client.get<RawAgreement>(`/api/v1/escrow/${id}`);
    if (!res.success || !res.data) {
      return falla(res, 'ESCROW_GET_FAILED');
    }
    return apiSuccess(mapAgreement(res.data));
  }

  async create(req: CreateEscrowRequest): Promise<ApiResponse<EscrowAgreement>> {
    const res = await this.client.post<RawAgreement>('/api/v1/escrow', {
      seller_phone: req.sellerPhone,
      seller_id: req.sellerId,
      amount_minor: req.amountMinor,
      currency: req.currency,
      description: req.description,
    });
    if (!res.success || !res.data) {
      // Se conserva el codigo del servidor —ESCROW_SELLER_NOT_FOUND es el que
      // importa aca— igual que en `action`. Pisarlo con uno generico deja a la
      // pantalla sin forma de decir QUE paso.
      return falla(res, 'ESCROW_CREATE_FAILED');
    }
    return apiSuccess(mapAgreement(res.data));
  }

  private async action(id: string, verb: string, body?: unknown): Promise<ApiResponse<EscrowAgreement>> {
    const res = await this.client.post<RawAgreement>(`/api/v1/escrow/${id}/${verb}`, body);
    if (!res.success || !res.data) {
      // Preserve the backend error code (MFA_REQUIRED, insufficient funds, daily
      // limit, fraud block, …) so the UI can react; only fall back to a generic
      // code when the backend did not provide one.
      return falla(res, 'ESCROW_ACTION_FAILED');
    }
    return apiSuccess(mapAgreement(res.data));
  }

  fund(id: string): Promise<ApiResponse<EscrowAgreement>> {
    return this.action(id, 'fund');
  }

  release(id: string): Promise<ApiResponse<EscrowAgreement>> {
    return this.action(id, 'release');
  }

  refund(id: string): Promise<ApiResponse<EscrowAgreement>> {
    return this.action(id, 'refund');
  }

  dispute(id: string, reason: string): Promise<ApiResponse<EscrowAgreement>> {
    return this.action(id, 'dispute', { reason });
  }

  cancel(id: string): Promise<ApiResponse<EscrowAgreement>> {
    return this.action(id, 'cancel');
  }

  deliver(id: string): Promise<ApiResponse<EscrowAgreement>> {
    return this.action(id, 'deliver');
  }

  async adminList(
    status?: EscrowStatus | 'all',
    limit = 50,
    offset = 0,
  ): Promise<ApiResponse<EscrowAdminPage>> {
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) qs.set('status', status);
    const res = await this.client.get<{
      agreements: RawAgreement[];
      total: number;
      status: string;
    }>(`/api/v1/admin/escrow?${qs.toString()}`);
    if (!res.success || !res.data) {
      return falla(res, 'ESCROW_LIST_FAILED');
    }
    return apiSuccess({
      agreements: (res.data.agreements ?? []).map(mapAgreement),
      total: res.data.total,
      status: res.data.status as EscrowAdminPage['status'],
    });
  }

  async adminResolve(id: string, outcome: 'released' | 'refunded'): Promise<ApiResponse<EscrowAgreement>> {
    const res = await this.client.post<RawAgreement>(`/api/v1/admin/escrow/${id}/resolve`, { outcome });
    if (!res.success || !res.data) {
      return falla(res, 'ESCROW_RESOLVE_FAILED');
    }
    return apiSuccess(mapAgreement(res.data));
  }
}
