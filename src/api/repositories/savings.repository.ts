import type { ApiResponse } from '../types';

// Structurally identical to the savings store's SavingsGoal (amounts in major
// units, e.g. colones), so it assigns cleanly into the store.
export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
  icon: string;
  color: string;
  createdAt: string;
}

export interface CreateSavingsGoalRequest {
  name: string;
  target: number; // major units
  icon?: string;
  color?: string;
}

export interface ISavingsRepository {
  getGoals(): Promise<ApiResponse<SavingsGoal[]>>;
  createGoal(request: CreateSavingsGoalRequest): Promise<ApiResponse<SavingsGoal>>;
  deleteGoal(id: string): Promise<ApiResponse<{ status: string }>>;
  deposit(id: string, amount: number): Promise<ApiResponse<SavingsGoal>>;
  withdraw(id: string, amount: number): Promise<ApiResponse<SavingsGoal>>;
}
