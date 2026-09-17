import type { ApiResponse } from '../types';
import type {
  CryptoAsset,
  CryptoTransaction,
  StakingPosition,
  PriceAlert,
  NuevaAlertaDePrecio,
} from '@/types';

export interface BuyCryptoRequest {
  asset: string;
  amount: number;
  price: number;
  fromCurrency: string;
  fromAmount: number;
  /**
   * Llave de idempotencia del intento. Repetir la MISMA compra con la misma
   * llave (tras un corte de red o el desafio de MFA) no cobra dos veces.
   */
  idempotencyKey?: string;
}

export interface SellCryptoRequest {
  asset: string;
  amount: number;
  price: number;
  toCurrency: string;
  toAmount: number;
  /** Igual que en la compra: la repeticion de la misma venta no vende dos veces. */
  idempotencyKey?: string;
}

export interface ConvertCryptoRequest {
  fromAsset: string;
  toAsset: string;
  fromAmount: number;
  toAmount: number;
  price: number;
}

// Sin tasa: la fija el servidor y cualquier valor del cliente se ignora.
export interface StakeCryptoRequest {
  asset: string;
  amount: number;
  locked: boolean;
  lockDays?: number;
}

/**
 * Los activos del programa de staking, con la tasa objetivo que anota el
 * servidor (stakingAPY en backend/internal/crypto/service.go). USDT y USDC
 * salieron del programa: anunciar rendimiento sobre monedas atadas al dolar
 * roza la captacion, y ademas no se podian conseguir en la aplicacion.
 */
export const ACTIVOS_CON_STAKING: Readonly<Record<string, number>> = {
  ETH: 4.5,
  SOL: 7.2,
};

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
  /** Devuelve la alerta como la guardo el servidor (id, estado, fecha). */
  addPriceAlert(alert: NuevaAlertaDePrecio): Promise<ApiResponse<PriceAlert>>;
  removePriceAlert(alertId: string): Promise<ApiResponse<void>>;
}
