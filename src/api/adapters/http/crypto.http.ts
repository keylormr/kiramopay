import type {
  ICryptoRepository,
  BuyCryptoRequest,
  SellCryptoRequest,
  ConvertCryptoRequest,
  StakeCryptoRequest,
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
    const res = await this.client.get<
      Array<{
        id: string;
        type: string;
        asset: string;
        amount: number | string;
        price: number | string;
        total: number | string;
        currency: string;
        fee: number | string;
        status: string;
        created_at: string;
      }>
    >('/api/v1/crypto/transactions');

    if (!res.success) {
      return apiError('FETCH_FAILED', 'Failed to fetch crypto transactions');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    const txs: CryptoTransaction[] = res.data.map((t) => ({
      id: t.id,
      type: t.type as CryptoTransaction['type'],
      fromAsset: t.asset,
      fromAmount: num(t.amount),
      price: num(t.price),
      fee: num(t.fee),
      date: new Date(t.created_at).toISOString(),
      status: t.status as 'completed' | 'pending' | 'failed',
    }));

    return apiSuccess(txs);
  }

  async buy(request: BuyCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const res = await this.client.post<{
      id: string;
      type: string;
      asset: string;
      amount: number | string;
      price: number | string;
      total: number | string;
      currency: string;
      status: string;
      created_at: string;
    }>('/api/v1/crypto/buy', {
      asset: request.asset,
      amount: request.amount,
      price: request.price,
      from_currency: request.fromCurrency,
      from_amount: request.fromAmount,
    });

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'BUY_FAILED', res.error?.message || 'Buy failed');
    }

    return apiSuccess({
      id: res.data.id,
      type: 'buy',
      fromAsset: res.data.asset,
      fromAmount: num(res.data.amount),
      price: num(res.data.price),
      fee: 0,
      date: res.data.created_at,
      status: 'completed',
    });
  }

  async sell(request: SellCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const res = await this.client.post<{
      id: string;
      asset: string;
      amount: number | string;
      price: number | string;
      total: number | string;
      currency: string;
      created_at: string;
    }>('/api/v1/crypto/sell', {
      asset: request.asset,
      amount: request.amount,
      price: request.price,
      to_currency: request.toCurrency,
      to_amount: request.toAmount,
    });

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'SELL_FAILED', res.error?.message || 'Sell failed');
    }

    return apiSuccess({
      id: res.data.id,
      type: 'sell',
      fromAsset: res.data.asset,
      fromAmount: num(res.data.amount),
      price: num(res.data.price),
      fee: 0,
      date: res.data.created_at,
      status: 'completed',
    });
  }

  async convert(request: ConvertCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const res = await this.client.post<{
      id: string;
      asset: string;
      amount: number | string;
      price: number | string;
      total: number | string;
      currency: string;
      created_at: string;
    }>('/api/v1/crypto/convert', {
      from_asset: request.fromAsset,
      to_asset: request.toAsset,
      from_amount: request.fromAmount,
      to_amount: request.toAmount,
      price: request.price,
    });

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'CONVERT_FAILED', res.error?.message || 'Convert failed');
    }

    return apiSuccess({
      id: res.data.id,
      type: 'convert',
      fromAsset: res.data.asset,
      fromAmount: num(res.data.amount),
      price: num(res.data.price),
      fee: 0,
      date: res.data.created_at,
      status: 'completed',
    });
  }

  async getStakingPositions(): Promise<ApiResponse<StakingPosition[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        asset: string;
        amount: number | string;
        apy: number;
        start_date: string;
        locked: boolean;
        lock_days: number;
        earned: number | string;
        status: string;
      }>
    >('/api/v1/crypto/staking');

    if (!res.success) {
      return apiError('FETCH_FAILED', 'Failed to fetch staking positions');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    const positions: StakingPosition[] = res.data.map((p) => ({
      id: p.id,
      asset: p.asset,
      amount: num(p.amount),
      apy: num(p.apy),
      startDate: p.start_date,
      locked: p.locked,
      lockPeriodDays: p.lock_days,
      earned: num(p.earned),
    }));

    return apiSuccess(positions);
  }

  async stake(request: StakeCryptoRequest): Promise<ApiResponse<StakingPosition>> {
    const res = await this.client.post<{
      id: string;
      asset: string;
      amount: number;
      apy: number;
      start_date: string;
      locked: boolean;
      lock_days: number;
      earned: number;
      status: string;
    }>('/api/v1/crypto/staking', request);

    if (!res.success || !res.data) {
      return apiError('STAKE_FAILED', res.error?.message || 'Staking failed');
    }

    return apiSuccess({
      id: res.data.id,
      asset: res.data.asset,
      amount: num(res.data.amount),
      apy: num(res.data.apy),
      startDate: res.data.start_date,
      locked: res.data.locked,
      lockPeriodDays: res.data.lock_days,
      earned: num(res.data.earned),
    });
  }

  async unstake(positionId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/crypto/staking/${positionId}`);
    if (!res.success) {
      return apiError('UNSTAKE_FAILED', res.error?.message || 'Unstake failed');
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
