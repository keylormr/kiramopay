import type { IAccountRepository } from '../../repositories/account.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import type { Account, Budget } from '@/types';
import { initialAccounts, initialBudgets } from './mock-data';

const STORAGE_KEY = 'kiramopay_app_state';

function getState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveField(field: string, value: unknown) {
  const state = getState() || {};
  state[field] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export class MockAccountRepository implements IAccountRepository {
  async getAccounts(): Promise<ApiResponse<Account[]>> {
    const state = getState();
    return apiSuccess(state?.accounts ?? initialAccounts);
  }

  async getAccount(ccy: string): Promise<ApiResponse<Account>> {
    const state = getState();
    const accounts: Account[] = state?.accounts ?? initialAccounts;
    const account = accounts.find((a) => a.ccy === ccy);
    if (!account) {
      return apiError('NOT_FOUND', `Account with currency ${ccy} not found`);
    }
    return apiSuccess(account);
  }

  async addAccount(account: Account): Promise<ApiResponse<Account>> {
    const state = getState();
    const accounts: Account[] = state?.accounts ?? [...initialAccounts];
    if (accounts.find((a) => a.ccy === account.ccy)) {
      return apiError('DUPLICATE', `Account with currency ${account.ccy} already exists`);
    }
    accounts.push(account);
    saveField('accounts', accounts);
    return apiSuccess(account);
  }

  async getBalanceSummary(): Promise<ApiResponse<{ totalUsd: number; accounts: Account[] }>> {
    const state = getState();
    const accounts: Account[] = state?.accounts ?? initialAccounts;
    const totalUsd = accounts.reduce((sum, acc) => sum + acc.balance * (acc.rateToUsd ?? 0), 0);
    return apiSuccess({ totalUsd, accounts });
  }

  async getBudgets(): Promise<ApiResponse<Budget[]>> {
    const state = getState();
    return apiSuccess(state?.budgets ?? initialBudgets);
  }

  async updateBudget(id: string, updates: Partial<Budget>): Promise<ApiResponse<Budget>> {
    const state = getState();
    const budgets: Budget[] = state?.budgets ?? [...initialBudgets];
    const index = budgets.findIndex((b) => b.id === id);
    if (index === -1) {
      return apiError('NOT_FOUND', `Budget ${id} not found`);
    }
    budgets[index] = { ...budgets[index], ...updates };
    saveField('budgets', budgets);
    return apiSuccess(budgets[index]);
  }
}
