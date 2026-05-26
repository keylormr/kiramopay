import type { ApiResponse } from '../types';
import type { Account, Budget } from '@/types';

export interface IAccountRepository {
  getAccounts(): Promise<ApiResponse<Account[]>>;
  getAccount(ccy: string): Promise<ApiResponse<Account>>;
  addAccount(account: Account): Promise<ApiResponse<Account>>;
  getBalanceSummary(): Promise<ApiResponse<{ totalUsd: number; accounts: Account[] }>>;
  getBudgets(): Promise<ApiResponse<Budget[]>>;
  updateBudget(id: string, updates: Partial<Budget>): Promise<ApiResponse<Budget>>;
}
