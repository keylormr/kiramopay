import type {
  IBudgetRepository,
  CreateBudgetRequest,
  UpdateBudgetRequest,
} from '../../repositories/budget.repository';
import type { ApiResponse } from '../../types';
import type { Budget } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpBudgetRepository implements IBudgetRepository {
  constructor(private client: HttpClient) {}

  async getBudgets(): Promise<ApiResponse<Budget[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        label: string;
        amount_limit: number;
        amount_spent: number;
        currency: string;
        icon: string;
        color: string;
      }>
    >('/api/v1/budgets');

    if (!res.success) {
      return apiError('FETCH_FAILED', 'Failed to fetch budgets');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    const budgets: Budget[] = res.data.map((b) => ({
      id: b.id,
      label: b.label,
      limit: b.amount_limit / 100,
      spent: b.amount_spent / 100,
      ccy: b.currency || 'CRC',
      icon: b.icon,
      color: b.color,
    }));

    return apiSuccess(budgets);
  }

  async create(request: CreateBudgetRequest): Promise<ApiResponse<Budget>> {
    const res = await this.client.post<{
      id: string;
      label: string;
      amount_limit: number;
      amount_spent: number;
      currency: string;
      icon: string;
      color: string;
    }>('/api/v1/budgets', {
      label: request.label,
      amount_limit: Math.round(request.amount_limit * 100),
      currency: request.currency || 'CRC',
      icon: request.icon || '',
      color: request.color || '',
      period: request.period || 'monthly',
    });

    if (!res.success || !res.data) {
      return apiError('CREATE_FAILED', res.error?.message || 'Failed to create budget');
    }

    return apiSuccess({
      id: res.data.id,
      label: res.data.label,
      limit: res.data.amount_limit / 100,
      spent: res.data.amount_spent / 100,
      ccy: res.data.currency || 'CRC',
      icon: res.data.icon,
      color: res.data.color,
    });
  }

  async update(id: string, request: UpdateBudgetRequest): Promise<ApiResponse<void>> {
    const body: Record<string, unknown> = {};
    if (request.label !== undefined) body.label = request.label;
    if (request.amount_limit !== undefined) body.amount_limit = Math.round(request.amount_limit * 100);
    if (request.amount_spent !== undefined) body.amount_spent = Math.round(request.amount_spent * 100);
    if (request.icon !== undefined) body.icon = request.icon;
    if (request.color !== undefined) body.color = request.color;

    const res = await this.client.patch<void>(`/api/v1/budgets/${id}`, body);
    if (!res.success) {
      return apiError('UPDATE_FAILED', res.error?.message || 'Failed to update budget');
    }
    return apiSuccess(undefined as unknown as void);
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    const res = await this.client.del<void>(`/api/v1/budgets/${id}`);
    if (!res.success) {
      return apiError('DELETE_FAILED', res.error?.message || 'Failed to delete budget');
    }
    return apiSuccess(undefined as unknown as void);
  }

  async resetAll(): Promise<ApiResponse<void>> {
    const res = await this.client.post<void>('/api/v1/budgets/reset');
    if (!res.success) {
      return apiError('RESET_FAILED', res.error?.message || 'Failed to reset budgets');
    }
    return apiSuccess(undefined as unknown as void);
  }
}
