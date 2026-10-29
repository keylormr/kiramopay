import type { ApiResponse } from '../types';
import type { Account, Budget } from '@/types';

export interface IAccountRepository {
  getAccounts(): Promise<ApiResponse<Account[]>>;
  getAccount(ccy: string): Promise<ApiResponse<Account>>;
  addAccount(account: Account): Promise<ApiResponse<Account>>;
  /** `totalUsd` is null when an account has a balance and no exchange rate. */
  getBalanceSummary(): Promise<ApiResponse<{ totalUsd: number | null; accounts: Account[] }>>;
  getBudgets(): Promise<ApiResponse<Budget[]>>;
  updateBudget(id: string, updates: Partial<Budget>): Promise<ApiResponse<Budget>>;
}
