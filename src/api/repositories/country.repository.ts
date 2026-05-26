import type { ApiResponse } from '../types';

export interface CountryInfo {
  id: string;
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
  currencyName: string;
  phonePrefix: string;
  flagEmoji: string;
  active: boolean;
}

export interface ExchangeRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: string;
  updatedAt: string;
}

export interface RegionalWallet {
  id: string;
  countryCode: string;
  currency: string;
  balance: number;
  active: boolean;
}

export interface CrossBorderTransfer {
  id: string;
  senderId: string;
  receiverPhone: string;
  fromCountry: string;
  toCountry: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: number;
  toAmount: number;
  exchangeRate: number;
  fee: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
}

export interface CrossBorderRequest {
  receiverPhone: string;
  toCountry: string;
  amount: number;
  currency: string;
}

export interface ConvertCurrencyRequest {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
}

export interface ConvertCurrencyResponse {
  fromCurrency: string;
  toCurrency: string;
  fromAmount: number;
  toAmount: number;
  rate: number;
}

export interface ICountryRepository {
  getCountries(): Promise<ApiResponse<CountryInfo[]>>;
  getExchangeRates(): Promise<ApiResponse<ExchangeRate[]>>;
  convertCurrency(request: ConvertCurrencyRequest): Promise<ApiResponse<ConvertCurrencyResponse>>;
  getUserWallets(): Promise<ApiResponse<RegionalWallet[]>>;
  createWallet(countryCode: string): Promise<ApiResponse<RegionalWallet>>;
  sendCrossBorder(request: CrossBorderRequest): Promise<ApiResponse<CrossBorderTransfer>>;
  getTransferHistory(): Promise<ApiResponse<CrossBorderTransfer[]>>;
  getTransfer(transferId: string): Promise<ApiResponse<CrossBorderTransfer>>;
}
