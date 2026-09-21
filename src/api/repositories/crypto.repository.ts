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

/**
 * Enviar un activo a otra persona de KiramoPay. No sale a ninguna cadena: el
 * activo pasa de una tenencia a la otra dentro de la aplicacion, por eso al
 * destinatario se lo identifica por su codigo QR personal y no por una
 * direccion.
 *
 * `amount` es lo que RECIBE quien recibe. La comision de KiramoPay (0,25 %) la
 * suma el servidor encima y la paga quien envia; el cliente nunca la calcula,
 * solo muestra la que el servidor devolvio en la vista previa.
 */
export interface SendCryptoRequest {
  asset: string;
  amount: number;
  /** El contenido crudo del QR personal de quien recibe. */
  qrData: string;
  /** Precio en dolares del activo, para el tope diario y el monitoreo. */
  price: number;
  /**
   * Igual que en la compra: repetir el MISMO envio con la misma llave (tras un
   * corte de red o el desafio de MFA) no envia dos veces.
   */
  idempotencyKey?: string;
}

/**
 * La vista previa del envio: quien recibe y cuanto sale en total. No requiere
 * precio porque no mueve nada — solo resuelve el QR y calcula la comision.
 */
export interface SendCryptoPreviewRequest {
  asset: string;
  amount: number;
  qrData: string;
}

/** Los tres numeros que la pantalla muestra antes de confirmar, tal como los calculo el servidor. */
export interface CryptoSendPreview {
  /** El nombre de quien recibe, resuelto a partir del QR. */
  recipientName: string;
  asset: string;
  /** Lo que llega a quien recibe. */
  amount: number;
  /** La comision de KiramoPay, en el mismo activo. */
  fee: number;
  /** Lo que baja del saldo de quien envia: amount + fee. */
  total: number;
  /** El porcentaje de la comision, para mostrarlo sin fijarlo en el cliente. */
  feePercent: number;
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
  /** Resuelve el QR y devuelve los numeros del envio sin mover nada. */
  sendPreview(request: SendCryptoPreviewRequest): Promise<ApiResponse<CryptoSendPreview>>;
  send(request: SendCryptoRequest): Promise<ApiResponse<CryptoTransaction>>;
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
