import type {
  ITransactionRepository,
  TransactionListParams,
  TransactionPage,
} from '../../repositories/transaction.repository';
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

// Machine timestamp of a mock transaction, or null when nothing parses.
function txTime(tx: Transaction): number | null {
  const raw = tx.dateISO || tx.date;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

export class MockTransactionRepository implements ITransactionRepository {
  async getTransactions(limit?: number): Promise<ApiResponse<Transaction[]>> {
    const txs = getTransactions();
    return apiSuccess(limit ? txs.slice(0, limit) : txs);
  }

  // Mirrors the backend's window semantics: from inclusive, to exclusive,
  // undated transactions excluded from bounded windows.
  async listTransactions(params: TransactionListParams): Promise<ApiResponse<TransactionPage>> {
    let txs = getTransactions();
    const from = params.from ? Date.parse(params.from) : null;
    const to = params.to ? Date.parse(params.to) : null;
    if (from !== null || to !== null) {
      txs = txs.filter((tx) => {
        const t = txTime(tx);
        if (t === null) return false;
        if (from !== null && t < from) return false;
        if (to !== null && t >= to) return false;
        return true;
      });
    }
    const total = txs.length;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? total;
    return apiSuccess({ transactions: txs.slice(offset, offset + limit), total });
  }

  async addTransaction(transaction: Transaction): Promise<ApiResponse<Transaction>> {
    const txs = getTransactions();
    txs.unshift(transaction);
    saveTransactions(txs);
    return apiSuccess(transaction);
  }
}
