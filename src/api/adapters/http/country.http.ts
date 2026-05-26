import type {
  ICountryRepository,
  CountryInfo,
  ExchangeRate,
  RegionalWallet,
  CrossBorderTransfer,
  CrossBorderRequest,
  ConvertCurrencyRequest,
  ConvertCurrencyResponse,
} from '../../repositories/country.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpCountryRepository implements ICountryRepository {
  constructor(private client: HttpClient) {}

  async getCountries(): Promise<ApiResponse<CountryInfo[]>> {
    const res = await this.client.get<Array<{
      id: string; code: string; name: string; currency: string;
      currency_symbol: string; currency_name: string; phone_prefix: string;
      flag_emoji: string; active: boolean;
    }>>('/api/v1/countries', false);

    if (!res.success) return apiError('FETCH_FAILED', 'Failed to fetch countries');
    if (!Array.isArray(res.data)) return apiSuccess([]);

    return apiSuccess(res.data.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      currency: c.currency,
      currencySymbol: c.currency_symbol,
      currencyName: c.currency_name,
      phonePrefix: c.phone_prefix,
      flagEmoji: c.flag_emoji,
      active: c.active,
    })));
  }

  async getExchangeRates(): Promise<ApiResponse<ExchangeRate[]>> {
    const res = await this.client.get<Array<{
      id: string; from_currency: string; to_currency: string;
      rate: number; source: string; updated_at: string;
    }> | null>('/api/v1/exchange-rates', false);

    if (!res.success) return apiError('FETCH_FAILED', 'Failed to fetch rates');
    if (!Array.isArray(res.data)) return apiSuccess([]);

    return apiSuccess(res.data.map((r) => ({
      id: r.id,
      fromCurrency: r.from_currency,
      toCurrency: r.to_currency,
      rate: r.rate,
      source: r.source,
      updatedAt: r.updated_at,
    })));
  }

  async convertCurrency(request: ConvertCurrencyRequest): Promise<ApiResponse<ConvertCurrencyResponse>> {
    const res = await this.client.post<{
      from_currency: string; to_currency: string;
      from_amount: number; to_amount: number; rate: number;
    }>('/api/v1/country/convert', {
      from_currency: request.fromCurrency,
      to_currency: request.toCurrency,
      amount: request.amount * 100,
    });

    if (!res.success || !res.data) return apiError('CONVERT_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      fromCurrency: res.data.from_currency,
      toCurrency: res.data.to_currency,
      fromAmount: res.data.from_amount / 100,
      toAmount: res.data.to_amount / 100,
      rate: res.data.rate,
    });
  }

  async getUserWallets(): Promise<ApiResponse<RegionalWallet[]>> {
    const res = await this.client.get<Array<{
      id: string; country_code: string; currency: string; balance: number; active: boolean;
    }> | null>('/api/v1/country/wallets');

    if (!res.success) return apiError('FETCH_FAILED', 'Failed to fetch wallets');
    if (!Array.isArray(res.data)) return apiSuccess([]);

    return apiSuccess(res.data.map((w) => ({
      id: w.id,
      countryCode: w.country_code,
      currency: w.currency,
      balance: w.balance / 100,
      active: w.active,
    })));
  }

  async createWallet(countryCode: string): Promise<ApiResponse<RegionalWallet>> {
    const res = await this.client.post<{
      id: string; country_code: string; currency: string; balance: number; active: boolean;
    }>(`/api/v1/country/wallets/${countryCode}`);

    if (!res.success || !res.data) return apiError('CREATE_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      id: res.data.id,
      countryCode: res.data.country_code,
      currency: res.data.currency,
      balance: res.data.balance / 100,
      active: res.data.active,
    });
  }

  async sendCrossBorder(request: CrossBorderRequest): Promise<ApiResponse<CrossBorderTransfer>> {
    const res = await this.client.post<{
      id: string; sender_id: string; receiver_phone: string;
      from_country: string; to_country: string; from_currency: string; to_currency: string;
      from_amount: number; to_amount: number; exchange_rate: number; fee: number;
      status: string; created_at: string;
    }>('/api/v1/country/transfer', {
      receiver_phone: request.receiverPhone,
      to_country: request.toCountry,
      amount: request.amount * 100,
      currency: request.currency,
    });

    if (!res.success || !res.data) return apiError('TRANSFER_FAILED', res.error?.message || 'Failed');

    return apiSuccess(mapTransfer(res.data));
  }

  async getTransferHistory(): Promise<ApiResponse<CrossBorderTransfer[]>> {
    const res = await this.client.get<Array<{
      id: string; sender_id: string; receiver_phone: string;
      from_country: string; to_country: string; from_currency: string; to_currency: string;
      from_amount: number; to_amount: number; exchange_rate: number; fee: number;
      status: string; created_at: string;
    }>>('/api/v1/country/transfers');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch transfers');

    return apiSuccess(res.data.map(mapTransfer));
  }

  async getTransfer(transferId: string): Promise<ApiResponse<CrossBorderTransfer>> {
    const res = await this.client.get<{
      id: string; sender_id: string; receiver_phone: string;
      from_country: string; to_country: string; from_currency: string; to_currency: string;
      from_amount: number; to_amount: number; exchange_rate: number; fee: number;
      status: string; created_at: string;
    }>(`/api/v1/country/transfers/${transferId}`);

    if (!res.success || !res.data) return apiError('NOT_FOUND', 'Transfer not found');

    return apiSuccess(mapTransfer(res.data));
  }
}

function mapTransfer(t: {
  id: string; sender_id: string; receiver_phone: string;
  from_country: string; to_country: string; from_currency: string; to_currency: string;
  from_amount: number; to_amount: number; exchange_rate: number; fee: number;
  status: string; created_at: string;
}): CrossBorderTransfer {
  return {
    id: t.id,
    senderId: t.sender_id,
    receiverPhone: t.receiver_phone,
    fromCountry: t.from_country,
    toCountry: t.to_country,
    fromCurrency: t.from_currency,
    toCurrency: t.to_currency,
    fromAmount: t.from_amount / 100,
    toAmount: t.to_amount / 100,
    exchangeRate: t.exchange_rate,
    fee: t.fee / 100,
    status: t.status as CrossBorderTransfer['status'],
    createdAt: t.created_at,
  };
}
