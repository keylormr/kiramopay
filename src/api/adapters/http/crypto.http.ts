import type {
  ICryptoRepository,
  BuyCryptoRequest,
  SellCryptoRequest,
  ConvertCryptoRequest,
  StakeCryptoRequest,
  SendCryptoRequest,
  SendCryptoPreviewRequest,
  CryptoSendPreview,
} from '../../repositories/crypto.repository';
import type { ApiResponse } from '../../types';
import type {
  CryptoAsset,
  CryptoTransaction,
  StakingPosition,
  PriceAlert,
  NuevaAlertaDePrecio,
} from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';
import type { Schema } from '../../generated/helpers';

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
  // Solo en un envio entre personas: a quien se le envio o de quien vino.
  counterparty_name?: string;
}

// La vista previa de un envio, tal como la calcula el servidor. Los decimales
// llegan como texto; nada de esto se recalcula en el telefono.
interface VistaPreviaDelServidor {
  recipient_name: string;
  asset: string;
  amount: number | string;
  fee: number | string;
  total: number | string;
  fee_percent: number | string;
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
    ...(t.counterparty_name ? { counterpartyName: t.counterparty_name } : {}),
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

  async sendPreview(request: SendCryptoPreviewRequest): Promise<ApiResponse<CryptoSendPreview>> {
    const res = await this.client.post<VistaPreviaDelServidor>('/api/v1/crypto/send/preview', {
      asset: request.asset,
      amount: request.amount,
      qr_data: request.qrData,
    });

    if (!res.success || !res.data) {
      // El codigo del servidor pasa tal cual: es el que sabe si el QR es de un
      // comercio, si esta revocado o si la persona se esta enviando a si misma.
      return apiError(res.error?.code || 'SEND_PREVIEW_FAILED', res.error?.message || 'Send preview failed');
    }

    return apiSuccess({
      recipientName: res.data.recipient_name,
      asset: res.data.asset,
      amount: num(res.data.amount),
      fee: num(res.data.fee),
      total: num(res.data.total),
      feePercent: num(res.data.fee_percent),
    });
  }

  async send(request: SendCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const res = await this.client.post<MovimientoDelServidor>('/api/v1/crypto/send', {
      asset: request.asset,
      amount: request.amount,
      qr_data: request.qrData,
      price: request.price,
      ...(request.idempotencyKey ? { idempotency_key: request.idempotencyKey } : {}),
    });

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'SEND_FAILED', res.error?.message || 'Send failed');
    }

    return apiSuccess(movimientoDesdeServidor({ ...res.data, type: 'send' }));
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
    const res = await this.client.get<AlertaDTO[] | null>('/api/v1/crypto/alerts');

    // El codigo y el texto del servidor pasan tal cual: pisarlos con uno fijo
    // le quitaba a la pantalla la forma de explicar el rechazo.
    if (!res.success) {
      return apiError(res.error?.code || 'FETCH_FAILED', res.error?.message || 'Failed to fetch price alerts');
    }
    // Sin alertas el servidor puede responder data: null. Es una lista vacia,
    // no un fallo.
    if (!Array.isArray(res.data)) return apiSuccess([]);
    return apiSuccess(res.data.map(aAlerta));
  }

  async addPriceAlert(alert: NuevaAlertaDePrecio): Promise<ApiResponse<PriceAlert>> {
    const res = await this.client.post<AlertaDTO>('/api/v1/crypto/alerts', {
      asset: alert.asset,
      target_price: alert.targetPrice,
      direction: alert.condition,
    });

    if (!res.success || !res.data) {
      return apiError(
        res.error?.code || 'ALERT_FAILED',
        res.error?.message || 'Failed to add alert',
        undefined,
        res.error?.details,
      );
    }

    // La alerta que vale es la que guardo el servidor: con su id, su estado y
    // el activo ya normalizado.
    return apiSuccess(aAlerta(res.data));
  }

  async removePriceAlert(alertId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/crypto/alerts/${encodeURIComponent(alertId)}`);
    if (!res.success) {
      return apiError(res.error?.code || 'REMOVE_FAILED', res.error?.message || 'Failed to remove alert');
    }
    return apiSuccess(undefined as unknown as void);
  }
}

// Forma de /crypto/alerts, anclada al contrato: re-generar con `npm run gen:api`
// si cambia. Los precios son decimales y llegan como texto.
type AlertaDTO = Schema<'PriceAlertRecord'>;

function aAlerta(a: AlertaDTO): PriceAlert {
  // Un servidor anterior a la 071 no mandaba `status`: sin el, una inactiva es
  // cumplida solo si trae la fecha de cumplimiento.
  const cumplida = a.status ? a.status === 'triggered' : !a.active && !!a.triggered_at;
  return {
    id: a.id,
    asset: a.asset,
    targetPrice: num(a.target_price),
    condition: a.direction === 'below' ? 'below' : 'above',
    active: !cumplida && a.active,
    status: cumplida ? 'triggered' : 'active',
    createdAt: a.created_at || undefined,
    triggeredAt: a.triggered_at || undefined,
    // != null: un null del JSON no es un precio (num(null) daria 0).
    triggeredPrice: a.triggered_price != null && a.triggered_price !== '' ? num(a.triggered_price) : undefined,
  };
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
