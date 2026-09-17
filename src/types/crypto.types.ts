export interface CryptoAsset {
  id: string;
  symbol: string;
  name: string;
  icon: string;
  color: string;
  balance: number;
  avgBuyPrice: number;
  currentPrice: number;
  priceChange24h: number;
  priceHistory: number[];
}

/**
 * Un movimiento de cripto. `from*` es lo que sale y `to*` lo que entra:
 *  - compra: sale el fiat (fromAsset = USD/CRC, fromAmount = lo pagado) y
 *    entra la cripto (toAsset, toAmount);
 *  - venta: sale la cripto y entra el fiat (toAsset = USD/CRC);
 *  - conversion: sale una cripto y entra la otra;
 *  - el resto (staking, rendimiento, envio): solo fromAsset/fromAmount.
 */
export interface CryptoTransaction {
  id: string;
  type: 'buy' | 'sell' | 'convert' | 'send' | 'receive' | 'stake' | 'unstake' | 'yield';
  fromAsset: string;
  toAsset?: string;
  fromAmount: number;
  toAmount?: number;
  /** Precio de una unidad de la cripto, en `priceCurrency`. */
  price: number;
  /**
   * Moneda de `price` y de `fee`. El servidor anota compras y ventas en la
   * moneda del pago (una compra en colones trae el precio en colones); sin el
   * dato, dolares.
   */
  priceCurrency?: string;
  fee: number;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  txHash?: string;
}

export interface StakingPosition {
  id: string;
  asset: string;
  amount: number;
  apy: number;
  startDate: string;
  earned: number;
  locked: boolean;
  lockPeriodDays?: number;
}

/**
 * Alerta de precio tal como la guarda el servidor. Los precios van en dolares,
 * la moneda del feed. `triggeredAt` y `triggeredPrice` existen solo cuando el
 * barrido del servidor la cumplio: una alerta avisa una sola vez.
 */
export interface PriceAlert {
  id: string;
  asset: string;
  targetPrice: number;
  condition: 'above' | 'below';
  active: boolean;
  status: 'active' | 'triggered';
  createdAt?: string;
  triggeredAt?: string;
  triggeredPrice?: number;
}

/** Lo unico que la persona decide al crear una alerta. */
export interface NuevaAlertaDePrecio {
  asset: string;
  targetPrice: number;
  condition: 'above' | 'below';
}

export interface CryptoState {
  assets: CryptoAsset[];
  transactions: CryptoTransaction[];
  stakingPositions: StakingPosition[];
  priceAlerts: PriceAlert[];
  favoriteAssets: string[];
  defaultConvertCurrency: string;
}
