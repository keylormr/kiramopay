import type { ITransactionRepository } from '../../repositories/transaction.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess } from '../../types';
import type { Transaction } from '@/types';
import { initialTransactions } from './mock-data';

const STORAGE_KEY = 'kiramopay_app_state';

function getTransactions(): Transaction[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const state = data ? JSON.parse(data) : null;
    return state?.transactions ?? initialTransactions;
  } catch {
    return initialTransactions;
  }
}

function saveTransactions(transactions: Transaction[]) {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const state = data ? JSON.parse(data) : {};
    state.transactions = transactions;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // noop
  }
}

export class MockTransactionRepository implements ITransactionRepository {
  async getTransactions(limit?: number): Promise<ApiResponse<Transaction[]>> {
    const txs = getTransactions();
    return apiSuccess(limit ? txs.slice(0, limit) : txs);
  }

  async addTransaction(transaction: Transaction): Promise<ApiResponse<Transaction>> {
    const txs = getTransactions();
    txs.unshift(transaction);
    saveTransactions(txs);
    return apiSuccess(transaction);
  }
}
