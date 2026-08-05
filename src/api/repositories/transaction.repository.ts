import type { ApiResponse } from '../types';
import type { Transaction } from '@/types';

export interface TransactionListParams {
  limit?: number;
  offset?: number;
  /** ISO timestamp; inclusive lower bound on the transaction date. */
  from?: string;
  /** ISO timestamp; exclusive upper bound on the transaction date. */
  to?: string;
}

/** One page of transactions plus the total match count, so callers can page
 * through a window and know when they have everything. */
export interface TransactionPage {
  transactions: Transaction[];
  total: number;
}

export interface ITransactionRepository {
  getTransactions(limit?: number): Promise<ApiResponse<Transaction[]>>;
  listTransactions(params: TransactionListParams): Promise<ApiResponse<TransactionPage>>;
  addTransaction(transaction: Transaction): Promise<ApiResponse<Transaction>>;
}
