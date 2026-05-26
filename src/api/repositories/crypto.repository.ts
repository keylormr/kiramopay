import type { ApiResponse } from '../types';
import type { CryptoAsset, CryptoTransaction, StakingPosition, PriceAlert } from '@/types';

export interface BuyCryptoRequest {
  asset: string;
  amount: number;
  price: number;
  fromCurrency: string;
  fromAmount: number;
}

export interface SellCryptoRequest {
  asset: string;
  amount: number;
  price: number;
  toCurrency: string;
  toAmount: number;
}

export interface ConvertCryptoRequest {
  fromAsset: string;
  toAsset: string;
  fromAmount: number;
  toAmount: number;
  price: number;
}

export interface StakeCryptoRequest {
  asset: string;
  amount: number;
  apy: number;
  locked: boolean;
  lockDays?: number;
}

export interface ICryptoRepository {
  getAssets(): Promise<ApiResponse<CryptoAsset[]>>;
  getTransactions(): Promise<ApiResponse<CryptoTransaction[]>>;
  buy(request: BuyCryptoRequest): Promise<ApiResponse<CryptoTransaction>>;
  sell(request: SellCryptoRequest): Promise<ApiResponse<CryptoTransaction>>;
  convert(request: ConvertCryptoRequest): Promise<ApiResponse<CryptoTransaction>>;
  getStakingPositions(): Promise<ApiResponse<StakingPosition[]>>;
  stake(request: StakeCryptoRequest): Promise<ApiResponse<StakingPosition>>;
  unstake(positionId: string): Promise<ApiResponse<void>>;
  claimYield(positionId: string): Promise<ApiResponse<{ amount: number }>>;
  getPriceAlerts(): Promise<ApiResponse<PriceAlert[]>>;
  addPriceAlert(alert: PriceAlert): Promise<ApiResponse<PriceAlert>>;
  removePriceAlert(alertId: string): Promise<ApiResponse<void>>;
}
