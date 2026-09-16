import type {
  IBudgetRepository,
  CreateBudgetRequest,
  UpdateBudgetRequest,
} from '../../repositories/budget.repository';
import type { ApiResponse } from '../../types';
import type { Budget } from '@/types';
import { apiSuccess, apiError } from '../../types';
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

// Los mismos rechazos que el servidor (backend/internal/budget), para que el
// modo sin backend no acepte lo que produccion rechaza.
function validarNombre(label: string): ApiResponse<never> | null {
  const limpio = label.trim();
  if (!limpio) return apiError('BUDGET_LABEL_REQUIRED', 'the budget needs a label');
  if ([...limpio].length > 100) return apiError('BUDGET_LABEL_TOO_LONG', 'the label can have up to 100 characters');
  return null;
}

const noEncontrado = () => apiError<never>('BUDGET_NOT_FOUND', 'budget not found');

export class MockBudgetRepository implements IBudgetRepository {
  async getBudgets(): Promise<ApiResponse<Budget[]>> {
    return apiSuccess(load());
  }

  async create(request: CreateBudgetRequest): Promise<ApiResponse<Budget>> {
    const rechazo = validarNombre(request.label);
    if (rechazo) return rechazo;
    if (!(Math.round(request.amount_limit * 100) > 0)) {
      return apiError('BUDGET_INVALID_LIMIT', 'amount_limit must be greater than zero');
    }
    const budgets = load();
    const budget: Budget = {
      id: `budget-${Date.now()}`,
      label: request.label.trim(),
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
    if (idx < 0) return noEncontrado();
    if (request.label !== undefined) {
      const rechazo = validarNombre(request.label);
      if (rechazo) return rechazo;
    }
    if (request.amount_limit !== undefined && !(Math.round(request.amount_limit * 100) > 0)) {
      return apiError('BUDGET_INVALID_LIMIT', 'amount_limit must be greater than zero');
    }
    if (request.amount_spent !== undefined && request.amount_spent < 0) {
      return apiError('BUDGET_INVALID_SPENT', 'amount_spent cannot be negative');
    }
    if (request.label !== undefined) budgets[idx].label = request.label.trim();
    if (request.amount_limit !== undefined) budgets[idx].limit = request.amount_limit;
    if (request.amount_spent !== undefined) budgets[idx].spent = request.amount_spent;
    if (request.icon !== undefined) budgets[idx].icon = request.icon;
    if (request.color !== undefined) budgets[idx].color = request.color;
    save(budgets);
    return apiSuccess(undefined as unknown as void);
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    const budgets = load();
    if (!budgets.some((b) => b.id === id)) return noEncontrado();
    save(budgets.filter((b) => b.id !== id));
    return apiSuccess(undefined as unknown as void);
  }

  async resetAll(): Promise<ApiResponse<void>> {
    save(load().map((b) => ({ ...b, spent: 0 })));
    return apiSuccess(undefined as unknown as void);
  }
}
