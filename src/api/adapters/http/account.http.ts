import type { IAccountRepository } from '../../repositories/account.repository';
import type { ApiResponse } from '../../types';
import type { Account, Budget } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';
// Generated from backend/docs/openapi.yaml — re-run `npm run gen:api`
// after any backend handler/schema change. The compiler will then surface
// every adapter that needs updating.
import type { ApiData } from '../../generated/helpers';

// Anchor on the path+method. If the spec ever renames `crc` → `balance_crc`,
// this line stays correct and the destructuring below stops compiling.
type BalancePayload = ApiData<'/api/v1/wallets/me/balance', 'get'>;

export class HttpAccountRepository implements IAccountRepository {
  constructor(private client: HttpClient) {}

  async getAccounts(): Promise<ApiResponse<Account[]>> {
    // We still accept the legacy {balance_crc, balance_usd} shape so older
    // backend deploys keep working — but the generated type is the source
    // of truth for the *current* spec.
    const res = await this.client.get<
      BalancePayload & { balance_crc?: number; balance_usd?: number }
    >('/api/v1/wallets/me/balance');

    if (!res.success || !res.data) {
      return apiError('FETCH_FAILED', 'Failed to fetch accounts');
    }

    const crcMinor = res.data.crc ?? res.data.balance_crc ?? 0;
    const usdMinor = res.data.usd ?? res.data.balance_usd ?? 0;

    const accounts: Account[] = [
      {
        name: 'Cuenta Colones',
        type: 'fiat',
        ccy: 'CRC',
        balance: crcMinor / 100, // centimos → colones
        symbol: '₡',
        flag: '🇨🇷',
        iban: '',
      },
      {
        name: 'Cuenta Dólares',
        type: 'fiat',
        ccy: 'USD',
        balance: usdMinor / 100, // cents → dollars
        symbol: '$',
        flag: '🇺🇸',
        iban: '',
      },
    ];

    return apiSuccess(accounts);
  }

  async getAccount(ccy: string): Promise<ApiResponse<Account>> {
    const res = await this.getAccounts();
    if (!res.success || !res.data) {
      return apiError('NOT_FOUND', 'Account not found');
    }
    const account = res.data.find((a) => a.ccy === ccy);
    if (!account) {
      return apiError('NOT_FOUND', `No account for currency ${ccy}`);
    }
    return apiSuccess(account);
  }

  async addAccount(_account: Account): Promise<ApiResponse<Account>> {
    // Backend doesn't support adding custom accounts in Phase 1
    return apiError('NOT_IMPLEMENTED', 'Adding accounts not available yet');
  }

  async getBalanceSummary(): Promise<ApiResponse<{ totalUsd: number; accounts: Account[] }>> {
    const res = await this.getAccounts();
    if (!res.success || !res.data) {
      return apiError('FETCH_FAILED', 'Failed to fetch balance');
    }

    const exchangeRate = 520; // CRC per USD approximate
    const totalUsd = res.data.reduce((sum, a) => {
      if (a.ccy === 'USD') return sum + a.balance;
      return sum + a.balance / exchangeRate;
    }, 0);

    return apiSuccess({ totalUsd, accounts: res.data });
  }

  async getBudgets(): Promise<ApiResponse<Budget[]>> {
    // Budgets are client-side only for now
    return apiSuccess([]);
  }

  async updateBudget(_id: string, _updates: Partial<Budget>): Promise<ApiResponse<Budget>> {
    return apiError('NOT_IMPLEMENTED', 'Budget management not available on server yet');
  }
}
