import type { ApiResponse } from '../types';
import type { Budget } from '@/types';

export interface CreateBudgetRequest {
  label: string;
  amount_limit: number;
  currency?: string;
  icon?: string;
  color?: string;
  period?: string;
}

export interface UpdateBudgetRequest {
  label?: string;
  amount_limit?: number;
  amount_spent?: number;
  icon?: string;
  color?: string;
}

export interface IBudgetRepository {
  getBudgets(): Promise<ApiResponse<Budget[]>>;
  create(request: CreateBudgetRequest): Promise<ApiResponse<Budget>>;
  update(id: string, request: UpdateBudgetRequest): Promise<ApiResponse<void>>;
  delete(id: string): Promise<ApiResponse<void>>;
  resetAll(): Promise<ApiResponse<void>>;
}
