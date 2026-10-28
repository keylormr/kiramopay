import type { IAccountRepository } from '../../repositories/account.repository';
import type { ApiResponse } from '../../types';
import type { Account, Budget } from '@/types';
import { apiSuccess } from '../../types';
import { falla, errorPropio } from './falla';
import { HttpClient } from './client';
import { getUsdToCrcRate } from '@/services/fxRate';
import { saldoTotal } from '@/utils/saldoTotal';
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
      return falla(res, 'FETCH_FAILED');
    }

    const crcMinor = res.data.crc ?? res.data.balance_crc ?? 0;
    const usdMinor = res.data.usd ?? res.data.balance_usd ?? 0;

    // Attach the USD conversion factor so callers (HomeView "USD Total",
    // ProfileView, getBalanceSummary) convert consistently instead of counting
    // CRC 1:1 against USD. Sourced from the single shared FX rate.
    //
    // Without a rate from the server the CRC account carries NO factor (not 0,
    // not a made-up one): saldoTotal then reports the total as unavailable and
    // the screens say so, instead of painting a figure nobody gave.
    const usdPerCrc = await getUsdToCrcRate();
    const crcToUsd = usdPerCrc !== null && usdPerCrc > 0 ? 1 / usdPerCrc : undefined;

    const accounts: Account[] = [
      {
        name: 'Cuenta Colones',
        type: 'fiat',
        ccy: 'CRC',
        balance: crcMinor / 100, // centimos → colones
        symbol: '₡',
        flag: '🇨🇷',
        iban: '',
        rateToUsd: crcToUsd,
      },
      {
        name: 'Cuenta Dólares',
        type: 'fiat',
        ccy: 'USD',
        balance: usdMinor / 100, // cents → dollars
        symbol: '$',
        flag: '🇺🇸',
        iban: '',
        rateToUsd: 1,
      },
    ];

    return apiSuccess(accounts);
  }

  async getAccount(ccy: string): Promise<ApiResponse<Account>> {
    const res = await this.getAccounts();
    if (!res.success || !res.data) {
      return falla(res, 'NOT_FOUND');
    }
    const account = res.data.find((a) => a.ccy === ccy);
    if (!account) {
      return errorPropio('NOT_FOUND');
    }
    return apiSuccess(account);
  }

  async addAccount(_account: Account): Promise<ApiResponse<Account>> {
    // Backend doesn't support adding custom accounts in Phase 1
    return errorPropio('NOT_IMPLEMENTED');
  }

  async getBalanceSummary(): Promise<ApiResponse<{ totalUsd: number | null; accounts: Account[] }>> {
    const res = await this.getAccounts();
    if (!res.success || !res.data) {
      return falla(res, 'FETCH_FAILED');
    }

    // getAccounts already attached rateToUsd from the shared FX rate, so the
    // summary reuses it instead of a second (divergent) hardcoded constant. An
    // account with a balance and no rate leaves the total null: a partial sum
    // that silently drops the colones would understate it.
    const totalUsd = saldoTotal(res.data, 'USD').enUsd;

    return apiSuccess({ totalUsd, accounts: res.data });
  }

  async getBudgets(): Promise<ApiResponse<Budget[]>> {
    // Budgets are client-side only for now
    return apiSuccess([]);
  }

  async updateBudget(_id: string, _updates: Partial<Budget>): Promise<ApiResponse<Budget>> {
    return errorPropio('NOT_IMPLEMENTED');
  }
}
