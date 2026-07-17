import type {
  ISavingsRepository,
  SavingsGoal,
  CreateSavingsGoalRequest,
} from '../../repositories/savings.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

interface GoalDTO {
  id: string;
  name: string;
  target_minor: number;
  saved_minor: number;
  currency: string;
  icon: string;
  color: string;
  created_at: string;
}

// A per-request key so an exact retry of the same deposit/withdraw (offline
// queue replay, proxy resend) is deduplicated by the backend and moves money
// only once. A fresh user action gets a fresh key.
function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mapGoal(d: GoalDTO): SavingsGoal {
  return {
    id: d.id,
    name: d.name,
    target: d.target_minor / 100,
    saved: d.saved_minor / 100,
    icon: d.icon,
    color: d.color,
    createdAt: d.created_at,
  };
}

export class HttpSavingsRepository implements ISavingsRepository {
  constructor(private client: HttpClient) {}

  async getGoals(): Promise<ApiResponse<SavingsGoal[]>> {
    const res = await this.client.get<GoalDTO[]>('/api/v1/savings/goals');
    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch savings goals');
    return apiSuccess(res.data.map(mapGoal));
  }

  async createGoal(request: CreateSavingsGoalRequest): Promise<ApiResponse<SavingsGoal>> {
    const res = await this.client.post<GoalDTO>('/api/v1/savings/goals', {
      name: request.name,
      target_minor: Math.round(request.target * 100),
      currency: 'CRC',
      icon: request.icon,
      color: request.color,
    });
    if (!res.success || !res.data) return apiError('CREATE_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapGoal(res.data));
  }

  async deleteGoal(id: string): Promise<ApiResponse<{ status: string }>> {
    const res = await this.client.del<{ status: string }>(`/api/v1/savings/goals/${id}`);
    if (!res.success) return apiError('DELETE_FAILED', res.error?.message || 'Failed');
    return apiSuccess(res.data ?? { status: 'deleted' });
  }

  async deposit(id: string, amount: number): Promise<ApiResponse<SavingsGoal>> {
    const res = await this.client.post<GoalDTO>(
      `/api/v1/savings/goals/${id}/deposit`,
      { amount_minor: Math.round(amount * 100) },
      true,
      { 'Idempotency-Key': idempotencyKey() }, // exact retries (queue/replay) move money once
    );
    if (!res.success || !res.data) return apiError('SAVINGS_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapGoal(res.data));
  }

  async withdraw(id: string, amount: number): Promise<ApiResponse<SavingsGoal>> {
    const res = await this.client.post<GoalDTO>(
      `/api/v1/savings/goals/${id}/withdraw`,
      { amount_minor: Math.round(amount * 100) },
      true,
      { 'Idempotency-Key': idempotencyKey() },
    );
    if (!res.success || !res.data) return apiError('SAVINGS_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapGoal(res.data));
  }
}
