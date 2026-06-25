import type {
  IEscrowRepository,
  EscrowAgreement,
  EscrowStatus,
  CreateEscrowRequest,
} from '../../repositories/escrow.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
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
  };
}

export class HttpEscrowRepository implements IEscrowRepository {
  constructor(private client: HttpClient) {}

  async list(limit = 50): Promise<ApiResponse<EscrowAgreement[]>> {
    const res = await this.client.get<RawAgreement[]>(`/api/v1/escrow?limit=${limit}`);
    if (!res.success || !res.data) {
      return apiError('ESCROW_LIST_FAILED', res.error?.message || 'Could not load agreements');
    }
    return apiSuccess(res.data.map(mapAgreement));
  }

  async get(id: string): Promise<ApiResponse<EscrowAgreement>> {
    const res = await this.client.get<RawAgreement>(`/api/v1/escrow/${id}`);
    if (!res.success || !res.data) {
      return apiError('ESCROW_GET_FAILED', res.error?.message || 'Could not load agreement');
    }
    return apiSuccess(mapAgreement(res.data));
  }

  async create(req: CreateEscrowRequest): Promise<ApiResponse<EscrowAgreement>> {
    const res = await this.client.post<RawAgreement>('/api/v1/escrow', {
      seller_id: req.sellerId,
      amount_minor: req.amountMinor,
      currency: req.currency,
      description: req.description,
    });
    if (!res.success || !res.data) {
      return apiError('ESCROW_CREATE_FAILED', res.error?.message || 'Could not create agreement');
    }
    return apiSuccess(mapAgreement(res.data));
  }

  private async action(id: string, verb: string, body?: unknown): Promise<ApiResponse<EscrowAgreement>> {
    const res = await this.client.post<RawAgreement>(`/api/v1/escrow/${id}/${verb}`, body);
    if (!res.success || !res.data) {
      // Preserve the backend error code (MFA_REQUIRED, insufficient funds, daily
      // limit, fraud block, …) so the UI can react; only fall back to a generic
      // code when the backend did not provide one.
      const code = res.error?.code || 'ESCROW_ACTION_FAILED';
      return apiError(code, res.error?.message || 'Action failed');
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
}
