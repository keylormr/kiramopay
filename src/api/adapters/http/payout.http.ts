import type {
  IPayoutRepository,
  Payout,
  PayoutStatus,
  PayoutDestination,
  CreatePayoutRequest,
} from '../../repositories/payout.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

interface RawDestination {
  type: string;
  account: string;
  name: string;
  bank?: string;
  country?: string;
}

interface RawPayout {
  id: string;
  user_id: string;
  rail: string;
  amount_minor: number;
  currency: string;
  status: string;
  destination: RawDestination;
  external_id?: string;
  failure_reason?: string;
  processing_at?: string;
  completed_at?: string;
  failed_at?: string;
  created_at: string;
  updated_at: string;
}

function mapDestination(d: RawDestination): PayoutDestination {
  return {
    type: d.type,
    account: d.account,
    name: d.name,
    bank: d.bank || undefined,
    country: d.country || undefined,
  };
}

function mapPayout(r: RawPayout): Payout {
  return {
    id: r.id,
    userId: r.user_id,
    rail: r.rail,
    amountMinor: r.amount_minor,
    currency: r.currency,
    status: r.status as PayoutStatus,
    destination: mapDestination(r.destination),
    externalId: r.external_id || undefined,
    failureReason: r.failure_reason || undefined,
    processingAt: r.processing_at || undefined,
    completedAt: r.completed_at || undefined,
    failedAt: r.failed_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class HttpPayoutRepository implements IPayoutRepository {
  constructor(private client: HttpClient) {}

  async list(limit = 50): Promise<ApiResponse<Payout[]>> {
    const res = await this.client.get<RawPayout[]>(`/api/v1/payouts?limit=${limit}`);
    if (!res.success || !res.data) {
      return apiError('PAYOUT_LIST_FAILED', res.error?.message || 'Could not load payouts');
    }
    return apiSuccess(res.data.map(mapPayout));
  }

  async get(id: string): Promise<ApiResponse<Payout>> {
    const res = await this.client.get<RawPayout>(`/api/v1/payouts/${id}`);
    if (!res.success || !res.data) {
      return apiError('PAYOUT_GET_FAILED', res.error?.message || 'Could not load payout');
    }
    return apiSuccess(mapPayout(res.data));
  }

  async create(req: CreatePayoutRequest): Promise<ApiResponse<Payout>> {
    const res = await this.client.post<RawPayout>('/api/v1/payouts', {
      rail: req.rail,
      amount_minor: req.amountMinor,
      currency: req.currency,
      destination: {
        type: req.destination.type,
        account: req.destination.account,
        name: req.destination.name,
        bank: req.destination.bank,
        country: req.destination.country,
      },
      idempotency_key: req.idempotencyKey,
    });
    if (!res.success || !res.data) {
      // Preserve MFA_REQUIRED so the UI can prompt for a TOTP code and retry.
      const code = res.error?.code === 'MFA_REQUIRED' ? 'MFA_REQUIRED' : 'PAYOUT_CREATE_FAILED';
      return apiError(code, res.error?.message || 'Could not create payout');
    }
    return apiSuccess(mapPayout(res.data));
  }

  async refresh(id: string): Promise<ApiResponse<Payout>> {
    const res = await this.client.post<RawPayout>(`/api/v1/payouts/${id}/refresh`, undefined);
    if (!res.success || !res.data) {
      return apiError('PAYOUT_REFRESH_FAILED', res.error?.message || 'Could not refresh payout');
    }
    return apiSuccess(mapPayout(res.data));
  }

  async rails(): Promise<ApiResponse<string[]>> {
    const res = await this.client.get<{ rails: string[] }>('/api/v1/payouts/rails');
    if (!res.success || !res.data) {
      return apiError('PAYOUT_RAILS_FAILED', res.error?.message || 'Could not load rails');
    }
    return apiSuccess(res.data.rails || []);
  }
}
