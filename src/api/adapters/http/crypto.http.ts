import type {
  ICryptoRepository,
  BuyCryptoRequest,
  SellCryptoRequest,
  ConvertCryptoRequest,
  StakeCryptoRequest,
} from '../../repositories/crypto.repository';
import type { ApiResponse } from '../../types';
import type { CryptoAsset, CryptoTransaction, StakingPosition, PriceAlert } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

// Backend money/amount fields are decimal.Decimal, which serialize to JSON as
// quoted strings (e.g. "1.5"). Coerce to a finite number so the UI's arithmetic
// and .toFixed() never receive a string — that crashed CryptoView with
// "x.toFixed is not a function".
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Un movimiento de cripto tal como lo anota el servidor (crypto_transactions).
interface MovimientoDelServidor {
  id: string;
  type: string;
  asset: string;
  amount: number | string;
  price: number | string;
  total?: number | string;
  currency?: string;
  fee?: number | string;
  status?: string;
  created_at: string;
}

// La posicion de staking tal como la devuelve el servidor.
interface PosicionDelServidor {
  id: string;
  asset: string;
  amount: number | string;
  apy: number | string;
  start_date: string;
  locked: boolean;
  lock_days?: number;
  earned: number | string;
}

const ESTADOS: ReadonlyArray<CryptoTransaction['status']> = ['completed', 'pending', 'failed'];

/**
 * Traduce un movimiento del servidor al de la pantalla, segun su tipo.
 *
 * El servidor guarda siempre `asset` y `amount` como la cripto, y en `total` y
 * `currency` lo que se movio del otro lado. Se leia `asset`/`amount` como "lo
 * que sale" para todos los tipos, y en una compra eso es falso: lo que sale es
 * el fiat. Por eso la fila de una compra de US$1 decia "+1 USD" en verde y
 * "$2,505.24" debajo (un dolar por el precio del ETH).
 */
export function movimientoDesdeServidor(t: MovimientoDelServidor): CryptoTransaction {
  const cantidad = num(t.amount);
  const total = num(t.total);
  const moneda = t.currency || 'USD';
  const base = {
    id: t.id,
    price: num(t.price),
    fee: num(t.fee),
    // La fecha se guarda tal cual: la pantalla la formatea en el idioma
    // activo. `new Date(x).toISOString()` lanzaba ante una fecha invalida.
    date: t.created_at,
    status: ESTADOS.includes(t.status as CryptoTransaction['status'])
      ? (t.status as CryptoTransaction['status'])
      : 'completed',
  };
  switch (t.type) {
    case 'buy':
      return { ...base, type: 'buy', fromAsset: moneda, fromAmount: total, toAsset: t.asset, toAmount: cantidad, priceCurrency: moneda };
    case 'sell':
      return { ...base, type: 'sell', fromAsset: t.asset, fromAmount: cantidad, toAsset: moneda, toAmount: total, priceCurrency: moneda };
    case 'convert': {
      // `asset` llega como "BTC→ETH"; `price` es el precio en dolares del destino.
      const [origen, destino] = t.asset.split('→');
      return {
        ...base,
        type: 'convert',
        fromAsset: origen || t.asset,
        fromAmount: cantidad,
        toAsset: destino || moneda,
        toAmount: total,
        priceCurrency: 'USD',
      };
    }
    default: {
      // El servidor dice "reward" donde la pantalla dice "yield".
      const tipo = t.type === 'reward' ? 'yield' : t.type;
      return {
        ...base,
        type: tipo as CryptoTransaction['type'],
        fromAsset: t.asset,
        fromAmount: cantidad,
        priceCurrency: t.currency === 'CRC' ? 'CRC' : 'USD',
      };
    }
  }
}

export function posicionDesdeServidor(p: PosicionDelServidor): StakingPosition {
  return {
    id: p.id,
    asset: p.asset,
    amount: num(p.amount),
    apy: num(p.apy),
    startDate: p.start_date,
    locked: !!p.locked,
    lockPeriodDays: p.lock_days,
    earned: num(p.earned),
  };
}

export class HttpCryptoRepository implements ICryptoRepository {
  constructor(private client: HttpClient) {}

  async getAssets(): Promise<ApiResponse<CryptoAsset[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        symbol: string;
        name: string;
        balance: number | string;
        avg_cost: number | string;
      }>
    >('/api/v1/crypto/assets');

    if (!res.success) {
      return apiError('FETCH_FAILED', 'Failed to fetch crypto assets');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    const assets: CryptoAsset[] = res.data.map((a) => ({
      id: a.id,
      symbol: a.symbol,
      name: a.name,
      balance: num(a.balance),
      avgBuyPrice: num(a.avg_cost),
      currentPrice: 0, // Will be filled by price service
      priceChange24h: 0,
      priceHistory: [],
      color: getAssetColor(a.symbol),
      icon: a.symbol.toLowerCase(),
    }));

    return apiSuccess(assets);
  }

  async getTransactions(): Promise<ApiResponse<CryptoTransaction[]>> {
    const res = await this.client.get<MovimientoDelServidor[]>('/api/v1/crypto/transactions');

    if (!res.success) {
      return apiError(res.error?.code || 'FETCH_FAILED', res.error?.message || 'Failed to fetch crypto transactions');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    return apiSuccess(res.data.map(movimientoDesdeServidor));
  }

  async buy(request: BuyCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const res = await this.client.post<MovimientoDelServidor>('/api/v1/crypto/buy', {
      asset: request.asset,
      amount: request.amount,
      price: request.price,
      from_currency: request.fromCurrency,
      from_amount: request.fromAmount,
      ...(request.idempotencyKey ? { idempotency_key: request.idempotencyKey } : {}),
    });

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'BUY_FAILED', res.error?.message || 'Buy failed');
    }

    return apiSuccess(movimientoDesdeServidor({ ...res.data, type: 'buy' }));
  }

  async sell(request: SellCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const res = await this.client.post<MovimientoDelServidor>('/api/v1/crypto/sell', {
      asset: request.asset,
      amount: request.amount,
      price: request.price,
      to_currency: request.toCurrency,
      to_amount: request.toAmount,
      ...(request.idempotencyKey ? { idempotency_key: request.idempotencyKey } : {}),
    });

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'SELL_FAILED', res.error?.message || 'Sell failed');
    }

    return apiSuccess(movimientoDesdeServidor({ ...res.data, type: 'sell' }));
  }

  async convert(request: ConvertCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const res = await this.client.post<MovimientoDelServidor>('/api/v1/crypto/convert', {
      from_asset: request.fromAsset,
      to_asset: request.toAsset,
      from_amount: request.fromAmount,
      to_amount: request.toAmount,
      price: request.price,
    });

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'CONVERT_FAILED', res.error?.message || 'Convert failed');
    }

    return apiSuccess(movimientoDesdeServidor({ ...res.data, type: 'convert' }));
  }

  async getStakingPositions(): Promise<ApiResponse<StakingPosition[]>> {
    const res = await this.client.get<PosicionDelServidor[]>('/api/v1/crypto/staking');

    if (!res.success) {
      return apiError(res.error?.code || 'FETCH_FAILED', res.error?.message || 'Failed to fetch staking positions');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    return apiSuccess(res.data.map(posicionDesdeServidor));
  }

  async stake(request: StakeCryptoRequest): Promise<ApiResponse<StakingPosition>> {
    // El cuerpo se arma campo por campo: se mandaba el objeto de la pantalla
    // tal cual, con `lockDays` en camelCase, y el servidor lee `lock_days`.
    const res = await this.client.post<PosicionDelServidor>('/api/v1/crypto/staking', {
      asset: request.asset,
      amount: request.amount,
      locked: request.locked,
      ...(request.lockDays ? { lock_days: request.lockDays } : {}),
    });

    if (!res.success || !res.data) {
      // El codigo del servidor pasa tal cual: la pantalla traduce por el. Antes
      // se pisaba con STAKE_FAILED y solo quedaba el texto en ingles.
      return apiError(res.error?.code || 'STAKE_FAILED', res.error?.message || 'Staking failed');
    }

    return apiSuccess(posicionDesdeServidor(res.data));
  }

  async unstake(positionId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/crypto/staking/${encodeURIComponent(positionId)}`);
    if (!res.success) {
      return apiError(res.error?.code || 'UNSTAKE_FAILED', res.error?.message || 'Unstake failed');
    }
    return apiSuccess(undefined as unknown as void);
  }

  async claimYield(_positionId: string): Promise<ApiResponse<{ amount: number }>> {
    // El backend no acredita rendimiento: no existe el endpoint. Devolvia
    // exito con amount 0, y como la vista despachaba igual, la pantalla sumaba
    // una ganancia que ningun servidor respalda. Mejor decir que no se puede.
    return apiError('CLAIM_NOT_AVAILABLE', 'Staking yield is not credited yet');
  }

  async getPriceAlerts(): Promise<ApiResponse<PriceAlert[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        asset: string;
        target_price: number;
        direction: string;
        active: boolean;
      }>
    >('/api/v1/crypto/alerts');

    if (!res.success) {
      return apiError('FETCH_FAILED', 'Failed to fetch price alerts');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    const alerts: PriceAlert[] = res.data.map((a) => ({
      id: a.id,
      asset: a.asset,
      targetPrice: a.target_price,
      condition: a.direction as 'above' | 'below',
      active: a.active,
    }));

    return apiSuccess(alerts);
  }

  async addPriceAlert(alert: PriceAlert): Promise<ApiResponse<PriceAlert>> {
    const res = await this.client.post('/api/v1/crypto/alerts', {
      asset: alert.asset,
      target_price: alert.targetPrice,
      direction: alert.condition,
    });

    if (!res.success) {
      return apiError('ALERT_FAILED', res.error?.message || 'Failed to add alert');
    }

    return apiSuccess(alert);
  }

  async removePriceAlert(alertId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/crypto/alerts/${alertId}`);
    if (!res.success) {
      return apiError('REMOVE_FAILED', res.error?.message || 'Failed to remove alert');
    }
    return apiSuccess(undefined as unknown as void);
  }
}

function getAssetColor(symbol: string): string {
  const colors: Record<string, string> = {
    BTC: '#F7931A',
    ETH: '#627EEA',
    SOL: '#9945FF',
    ADA: '#0D1E30',
    DOT: '#E6007A',
    AVAX: '#E84142',
    LINK: '#2A5ADA',
    MATIC: '#8247E5',
    UNI: '#FF007A',
    ATOM: '#2E3148',
  };
  return colors[symbol] || '#6B7280';
}
