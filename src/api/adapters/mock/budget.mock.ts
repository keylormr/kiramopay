import type {
  IBudgetRepository,
  CreateBudgetRequest,
  UpdateBudgetRequest,
} from '../../repositories/budget.repository';
import type { ApiResponse } from '../../types';
import type { Budget } from '@/types';
import { apiSuccess } from '../../types';
import { initialBudgets } from './mock-data';

const STORAGE_KEY = 'kiramopay_budgets';

function load(): Budget[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [...initialBudgets];
  } catch {
    return [...initialBudgets];
  }
}

function save(budgets: Budget[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(budgets));
}

export class MockBudgetRepository implements IBudgetRepository {
  async getBudgets(): Promise<ApiResponse<Budget[]>> {
    return apiSuccess(load());
  }

  async create(request: CreateBudgetRequest): Promise<ApiResponse<Budget>> {
    const budgets = load();
    const budget: Budget = {
      id: `budget-${Date.now()}`,
      label: request.label,
      limit: request.amount_limit,
      spent: 0,
      ccy: request.currency || 'CRC',
      icon: request.icon,
      color: request.color,
    };
    budgets.push(budget);
    save(budgets);
    return apiSuccess(budget);
  }

  async update(id: string, request: UpdateBudgetRequest): Promise<ApiResponse<void>> {
    const budgets = load();
    const idx = budgets.findIndex((b) => b.id === id);
    if (idx >= 0) {
      if (request.label !== undefined) budgets[idx].label = request.label;
      if (request.amount_limit !== undefined) budgets[idx].limit = request.amount_limit;
      if (request.amount_spent !== undefined) budgets[idx].spent = request.amount_spent;
      if (request.icon !== undefined) budgets[idx].icon = request.icon;
      if (request.color !== undefined) budgets[idx].color = request.color;
      save(budgets);
    }
    return apiSuccess(undefined as unknown as void);
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    save(load().filter((b) => b.id !== id));
    return apiSuccess(undefined as unknown as void);
  }

  async resetAll(): Promise<ApiResponse<void>> {
    save(load().map((b) => ({ ...b, spent: 0 })));
    return apiSuccess(undefined as unknown as void);
  }
}
