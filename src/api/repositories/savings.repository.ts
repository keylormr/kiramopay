import type { ApiResponse } from '../types';
import type { ConMarcaDeRepeticion } from './crypto.repository';

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
  // La llave la arma la pantalla y la conserva mientras no sabe que paso; la
  // respuesta marca `repetida` cuando la llave ya tenia hecho el movimiento.
  deposit(id: string, amount: number, idempotencyKey?: string): Promise<ApiResponse<ConMarcaDeRepeticion<SavingsGoal>>>;
  withdraw(id: string, amount: number, idempotencyKey?: string): Promise<ApiResponse<ConMarcaDeRepeticion<SavingsGoal>>>;
}
