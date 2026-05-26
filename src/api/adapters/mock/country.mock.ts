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

const initialCountries: CountryInfo[] = [
  { id: 'cr', code: 'CR', name: 'Costa Rica', currency: 'CRC', currencySymbol: '₡', currencyName: 'Colon', phonePrefix: '+506', flagEmoji: '🇨🇷', active: true },
  { id: 'pa', code: 'PA', name: 'Panama', currency: 'PAB', currencySymbol: 'B/.', currencyName: 'Balboa', phonePrefix: '+507', flagEmoji: '🇵🇦', active: true },
  { id: 'gt', code: 'GT', name: 'Guatemala', currency: 'GTQ', currencySymbol: 'Q', currencyName: 'Quetzal', phonePrefix: '+502', flagEmoji: '🇬🇹', active: true },
];

const initialRates: ExchangeRate[] = [
  { id: 'crc-usd', fromCurrency: 'CRC', toCurrency: 'USD', rate: 0.0019, source: 'mock', updatedAt: new Date().toISOString() },
  { id: 'usd-crc', fromCurrency: 'USD', toCurrency: 'CRC', rate: 526.50, source: 'mock', updatedAt: new Date().toISOString() },
  { id: 'crc-pab', fromCurrency: 'CRC', toCurrency: 'PAB', rate: 0.0019, source: 'mock', updatedAt: new Date().toISOString() },
  { id: 'crc-gtq', fromCurrency: 'CRC', toCurrency: 'GTQ', rate: 0.015, source: 'mock', updatedAt: new Date().toISOString() },
  { id: 'usd-gtq', fromCurrency: 'USD', toCurrency: 'GTQ', rate: 7.85, source: 'mock', updatedAt: new Date().toISOString() },
];

const initialWallets: RegionalWallet[] = [
  { id: 'w-cr', countryCode: 'CR', currency: 'CRC', balance: 384500, active: true },
];

export class MockCountryRepository implements ICountryRepository {
  async getCountries(): Promise<ApiResponse<CountryInfo[]>> {
    return apiSuccess(initialCountries);
  }

  async getExchangeRates(): Promise<ApiResponse<ExchangeRate[]>> {
    return apiSuccess(initialRates);
  }

  async convertCurrency(request: ConvertCurrencyRequest): Promise<ApiResponse<ConvertCurrencyResponse>> {
    const rate = initialRates.find(
      (r) => r.fromCurrency === request.fromCurrency && r.toCurrency === request.toCurrency,
    );
    if (!rate) return apiError('UNSUPPORTED', `Conversion ${request.fromCurrency} -> ${request.toCurrency} not supported`);
    const toAmount = request.amount * rate.rate;
    return apiSuccess({
      fromCurrency: request.fromCurrency,
      toCurrency: request.toCurrency,
      fromAmount: request.amount,
      toAmount: Math.round(toAmount * 100) / 100,
      rate: rate.rate,
    });
  }

  async getUserWallets(): Promise<ApiResponse<RegionalWallet[]>> {
    const state = getState();
    return apiSuccess(state?.regionalWallets ?? initialWallets);
  }

  async createWallet(countryCode: string): Promise<ApiResponse<RegionalWallet>> {
    const state = getState();
    const wallets: RegionalWallet[] = state?.regionalWallets ?? [...initialWallets];
    const country = initialCountries.find((c) => c.code === countryCode);
    if (!country) return apiError('NOT_FOUND', 'Pais no encontrado');
    if (wallets.find((w) => w.countryCode === countryCode)) {
      return apiError('DUPLICATE', 'Ya tienes una billetera para este pais');
    }
    const wallet: RegionalWallet = {
      id: `w-${countryCode.toLowerCase()}`,
      countryCode,
      currency: country.currency,
      balance: 0,
      active: true,
    };
    wallets.push(wallet);
    saveField('regionalWallets', wallets);
    return apiSuccess(wallet);
  }

  async sendCrossBorder(request: CrossBorderRequest): Promise<ApiResponse<CrossBorderTransfer>> {
    const country = initialCountries.find((c) => c.code === request.toCountry);
    if (!country) return apiError('NOT_FOUND', 'Pais destino no encontrado');
    const rate = initialRates.find(
      (r) => r.fromCurrency === request.currency && r.toCurrency === country.currency,
    );
    const exchangeRate = rate?.rate ?? 1;
    const transfer: CrossBorderTransfer = {
      id: `xb-${Date.now()}`,
      senderId: 'current-user',
      receiverPhone: request.receiverPhone,
      fromCountry: 'CR',
      toCountry: request.toCountry,
      fromCurrency: request.currency,
      toCurrency: country.currency,
      fromAmount: request.amount,
      toAmount: Math.round(request.amount * exchangeRate * 100) / 100,
      exchangeRate,
      fee: Math.round(request.amount * 0.02),
      status: 'completed',
      createdAt: new Date().toISOString(),
    };
    const state = getState();
    const history: CrossBorderTransfer[] = state?.crossBorderHistory ?? [];
    history.unshift(transfer);
    saveField('crossBorderHistory', history);
    return apiSuccess(transfer);
  }

  async getTransferHistory(): Promise<ApiResponse<CrossBorderTransfer[]>> {
    const state = getState();
    return apiSuccess(state?.crossBorderHistory ?? []);
  }

  async getTransfer(transferId: string): Promise<ApiResponse<CrossBorderTransfer>> {
    const state = getState();
    const history: CrossBorderTransfer[] = state?.crossBorderHistory ?? [];
    const transfer = history.find((t) => t.id === transferId);
    if (!transfer) return apiError('NOT_FOUND', 'Transferencia no encontrada');
    return apiSuccess(transfer);
  }
}
