import type {
  ISplitPayRepository,
  SplitGroup,
  SplitDetail,
  CreateSplitRequest,
} from '../../repositories/splitpay.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

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
      total_amount: request.totalAmount * 100,
      currency: request.currency,
      split_type: request.splitType,
      participants: request.participants.map((p) => ({
        user_id: p.userId,
        user_phone: p.userPhone,
        user_name: p.userName,
        amount: p.amount ? p.amount * 100 : 0,
        percentage: p.percentage,
      })),
    });

    if (!res.success || !res.data) return apiError('CREATE_FAILED', res.error?.message || 'Failed');

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
    }>>('/api/v1/splits');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch splits');

    return apiSuccess(res.data.map(mapGroup));
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

    if (!res.success || !res.data) return apiError('NOT_FOUND', 'Split not found');

    return apiSuccess({
      group: mapGroup(res.data.group),
      shares: res.data.shares.map(mapShare),
    });
  }

  async payShare(groupId: string): Promise<ApiResponse<void>> {
    const res = await this.client.post(`/api/v1/splits/${groupId}/pay`);
    if (!res.success) return apiError('PAY_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  async declineShare(groupId: string): Promise<ApiResponse<void>> {
    const res = await this.client.post(`/api/v1/splits/${groupId}/decline`);
    if (!res.success) return apiError('DECLINE_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  async cancelSplit(groupId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/splits/${groupId}`);
    if (!res.success) return apiError('CANCEL_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }
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
