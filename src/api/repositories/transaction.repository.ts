import type { ApiResponse } from '../types';
import type { Transaction } from '@/types';

export interface ITransactionRepository {
  getTransactions(limit?: number): Promise<ApiResponse<Transaction[]>>;
  addTransaction(transaction: Transaction): Promise<ApiResponse<Transaction>>;
}
