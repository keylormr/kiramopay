import type {
  ILoyaltyRepository,
  PointsAccount,
  PointsTransaction,
  Reward,
  Redemption,
  CashbackRule,
  EarnPointsRequest,
} from '../../repositories/loyalty.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpLoyaltyRepository implements ILoyaltyRepository {
  constructor(private client: HttpClient) {}

  async getAccount(): Promise<ApiResponse<PointsAccount>> {
    const res = await this.client.get<{
      id: string; user_id: string; total_points: number;
      available_points: number; lifetime_points: number; tier: string;
    }>('/api/v1/loyalty/account');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch loyalty account');

    return apiSuccess({
      id: res.data.id,
      userId: res.data.user_id,
      totalPoints: res.data.total_points,
      availablePoints: res.data.available_points,
      lifetimePoints: res.data.lifetime_points,
      tier: res.data.tier as PointsAccount['tier'],
    });
  }

  async getTransactions(): Promise<ApiResponse<PointsTransaction[]>> {
    const res = await this.client.get<Array<{
      id: string; type: string; points: number; description: string;
      ref_type: string; ref_id: string; created_at: string;
    }>>('/api/v1/loyalty/transactions');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch transactions');

    return apiSuccess(res.data.map((t) => ({
      id: t.id,
      type: t.type as PointsTransaction['type'],
      points: t.points,
      description: t.description,
      refType: t.ref_type || undefined,
      refId: t.ref_id || undefined,
      createdAt: t.created_at,
    })));
  }

  async earnPoints(request: EarnPointsRequest): Promise<ApiResponse<PointsTransaction>> {
    const res = await this.client.post<{
      id: string; type: string; points: number; description: string;
      ref_type: string; ref_id: string; created_at: string;
    }>('/api/v1/loyalty/earn', {
      ref_type: request.refType,
      ref_id: request.refId,
      amount: request.amount,
    });

    if (!res.success || !res.data) return apiError('EARN_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      id: res.data.id,
      type: res.data.type as PointsTransaction['type'],
      points: res.data.points,
      description: res.data.description,
      refType: res.data.ref_type,
      refId: res.data.ref_id,
      createdAt: res.data.created_at,
    });
  }

  async getRewards(): Promise<ApiResponse<Reward[]>> {
    const res = await this.client.get<Array<{
      id: string; name: string; description: string; category: string;
      points_cost: number; image_url: string; partner_code: string;
      stock: number;
    }>>('/api/v1/loyalty/rewards');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch rewards');

    return apiSuccess(res.data.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category as Reward['category'],
      pointsCost: r.points_cost,
      imageUrl: r.image_url,
      partnerCode: r.partner_code || undefined,
      stock: r.stock,
    })));
  }

  async redeemReward(rewardId: string): Promise<ApiResponse<Redemption>> {
    const res = await this.client.post<{
      id: string; reward_id: string; points: number; status: string;
      code: string; created_at: string;
    }>('/api/v1/loyalty/redeem', { reward_id: rewardId });

    if (!res.success || !res.data) return apiError('REDEEM_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      id: res.data.id,
      rewardId: res.data.reward_id,
      points: res.data.points,
      status: res.data.status as Redemption['status'],
      code: res.data.code || undefined,
      createdAt: res.data.created_at,
    });
  }

  async getRedemptions(): Promise<ApiResponse<Redemption[]>> {
    const res = await this.client.get<Array<{
      id: string; reward_id: string; points: number; status: string;
      code: string; created_at: string;
    }>>('/api/v1/loyalty/redemptions');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch redemptions');

    return apiSuccess(res.data.map((r) => ({
      id: r.id,
      rewardId: r.reward_id,
      points: r.points,
      status: r.status as Redemption['status'],
      code: r.code || undefined,
      createdAt: r.created_at,
    })));
  }

  async getCashbackRules(): Promise<ApiResponse<CashbackRule[]>> {
    const res = await this.client.get<Array<{
      id: string; category: string; percentage: number;
      max_points_per_tx: number; active: boolean;
    }>>('/api/v1/loyalty/cashback-rules');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch rules');

    return apiSuccess(res.data.map((r) => ({
      id: r.id,
      category: r.category,
      percentage: r.percentage,
      maxPoints: r.max_points_per_tx,
      active: r.active,
    })));
  }
}
