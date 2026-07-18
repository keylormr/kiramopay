import type { ITransactionRepository } from '../../repositories/transaction.repository';
import type { ApiResponse } from '../../types';
import type { Transaction } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpTransactionRepository implements ITransactionRepository {
  constructor(private client: HttpClient) {}

  async getTransactions(limit?: number): Promise<ApiResponse<Transaction[]>> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));

    const res = await this.client.get<{
      transactions: Array<{
        id: string;
        type: string;
        amount: number;
        currency: string;
        fee: number;
        counterparty_name: string;
        counterparty_phone: string;
        status: string;
        created_at: string;
        metadata: string;
      }>;
      total: number;
    }>(`/api/v1/transactions?${params.toString()}`);

    if (!res.success || !res.data) {
      return apiError('FETCH_FAILED', 'Failed to fetch transactions');
    }

    const transactions: Transaction[] = res.data.transactions.map((tx) => ({
      id: tx.id,
      title: tx.counterparty_name || parseDescription(tx.metadata),
      type: mapTxType(tx.type) as 'credit' | 'debit',
      // Backend returns the amount as a positive magnitude with direction encoded
      // in `type`; sign it here so income shows as +/green and spends as -/red.
      amount: (isIncoming(tx.type) ? 1 : -1) * (Math.abs(tx.amount) / 100), // centimos → colones
      ccy: tx.currency,
      description: tx.counterparty_name || parseDescription(tx.metadata),
      date: new Date(tx.created_at).toLocaleDateString('es-CR'),
      dateISO: tx.created_at, // raw ISO timestamp for filtering / charts
      status: tx.status as 'completed' | 'pending',
      category: mapCategory(tx.type),
    }));

    return apiSuccess(transactions);
  }

  async addTransaction(transaction: Transaction): Promise<ApiResponse<Transaction>> {
    const res = await this.client.post<{
      id: string;
      status: string;
    }>('/api/v1/transactions', {
      type: transaction.type,
      amount: Math.round(transaction.amount * 100), // colones → centimos
      currency: transaction.ccy || 'CRC',
      description: transaction.description,
    });

    if (!res.success) {
      return apiError('CREATE_FAILED', res.error?.message || 'Failed to create transaction');
    }

    return apiSuccess(transaction);
  }
}

// Transaction types where money ENTERS the user's wallet (credit / positive amount).
// Mirrors the backend's incoming set (the complement of transaction.isOutgoing plus the
// savings/escrow money-in types); every other type is treated as outgoing (debit, negative).
const INCOMING_TYPES = new Set([
  'sinpe_receive',
  'qr_receive',
  'deposit',
  'p2p_receive',
  'refund',
  'crypto_sell', // fiat enters the wallet from selling crypto
  'savings_withdraw', // SYSTEM:SAVINGS -> wallet
  'escrow_receive',
  'escrow_refund',
]);

function isIncoming(backendType: string): boolean {
  return INCOMING_TYPES.has(backendType);
}

function mapTxType(backendType: string): 'credit' | 'debit' {
  return isIncoming(backendType) ? 'credit' : 'debit';
}

function mapCategory(backendType: string): string {
  const map: Record<string, string> = {
    sinpe_send: 'transfers',
    sinpe_receive: 'transfers',
    bill_payment: 'services',
    recharge: 'services',
    qr_payment: 'shopping',
    deposit: 'income',
    withdrawal: 'cash',
  };
  return map[backendType] || 'other';
}

function parseDescription(metadata: string): string {
  try {
    const parsed = JSON.parse(metadata);
    return parsed.description || '';
  } catch {
    return '';
  }
}
