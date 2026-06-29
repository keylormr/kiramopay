import type {
  ISavingsRepository,
  SavingsGoal,
  CreateSavingsGoalRequest,
} from '../../repositories/savings.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';

const KEY = 'kiramopay_savings_goals';

function read(): SavingsGoal[] {
  try {
    const d = localStorage.getItem(KEY);
    return d ? JSON.parse(d) : [];
  } catch {
    return [];
  }
}
function write(goals: SavingsGoal[]) {
  localStorage.setItem(KEY, JSON.stringify(goals));
}

// Mock persists goals locally. It does NOT move real money — in mock mode the
// view applies the wallet debit/credit itself (there is no backend ledger).
export class MockSavingsRepository implements ISavingsRepository {
  async getGoals(): Promise<ApiResponse<SavingsGoal[]>> {
    return apiSuccess(read());
  }

  async createGoal(request: CreateSavingsGoalRequest): Promise<ApiResponse<SavingsGoal>> {
    const goal: SavingsGoal = {
      id: `sg-${Date.now()}`,
      name: request.name,
      target: request.target,
      saved: 0,
      icon: request.icon ?? 'piggy-bank',
      color: request.color ?? '',
      createdAt: new Date().toISOString(),
    };
    const goals = read();
    goals.push(goal);
    write(goals);
    return apiSuccess(goal);
  }

  async deleteGoal(id: string): Promise<ApiResponse<{ status: string }>> {
    write(read().filter((g) => g.id !== id));
    return apiSuccess({ status: 'deleted' });
  }

  async deposit(id: string, amount: number): Promise<ApiResponse<SavingsGoal>> {
    return this.adjust(id, amount);
  }

  async withdraw(id: string, amount: number): Promise<ApiResponse<SavingsGoal>> {
    return this.adjust(id, -amount);
  }

  private adjust(id: string, delta: number): ApiResponse<SavingsGoal> {
    const goals = read();
    const i = goals.findIndex((g) => g.id === id);
    if (i === -1) return apiError('NOT_FOUND', 'Goal not found');
    goals[i] = { ...goals[i], saved: Math.max(0, goals[i].saved + delta) };
    write(goals);
    return apiSuccess(goals[i]);
  }
}
