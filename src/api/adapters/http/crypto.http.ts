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

export class HttpCryptoRepository implements ICryptoRepository {
  constructor(private client: HttpClient) {}

  async getAssets(): Promise<ApiResponse<CryptoAsset[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        symbol: string;
        name: string;
        balance: number;
        avg_cost: number;
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
      balance: a.balance,
      avgBuyPrice: a.avg_cost,
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
        amount: number;
        price: number;
        total: number;
        currency: string;
        fee: number;
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
      fromAmount: t.amount,
      price: t.price,
      fee: t.fee,
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
      amount: number;
      price: number;
      total: number;
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
      return apiError('BUY_FAILED', res.error?.message || 'Buy failed');
    }

    return apiSuccess({
      id: res.data.id,
      type: 'buy',
      fromAsset: res.data.asset,
      fromAmount: res.data.amount,
      price: res.data.price,
      fee: 0,
      date: res.data.created_at,
      status: 'completed',
    });
  }

  async sell(request: SellCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const res = await this.client.post<{
      id: string;
      asset: string;
      amount: number;
      price: number;
      total: number;
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
      return apiError('SELL_FAILED', res.error?.message || 'Sell failed');
    }

    return apiSuccess({
      id: res.data.id,
      type: 'sell',
      fromAsset: res.data.asset,
      fromAmount: res.data.amount,
      price: res.data.price,
      fee: 0,
      date: res.data.created_at,
      status: 'completed',
    });
  }

  async convert(request: ConvertCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const res = await this.client.post<{
      id: string;
      asset: string;
      amount: number;
      price: number;
      total: number;
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
      return apiError('CONVERT_FAILED', res.error?.message || 'Convert failed');
    }

    return apiSuccess({
      id: res.data.id,
      type: 'convert',
      fromAsset: res.data.asset,
      fromAmount: res.data.amount,
      price: res.data.price,
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
        amount: number;
        apy: number;
        start_date: string;
        locked: boolean;
        lock_days: number;
        earned: number;
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
      amount: p.amount,
      apy: p.apy,
      startDate: p.start_date,
      locked: p.locked,
      lockPeriodDays: p.lock_days,
      earned: p.earned,
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
      amount: res.data.amount,
      apy: res.data.apy,
      startDate: res.data.start_date,
      locked: res.data.locked,
      lockPeriodDays: res.data.lock_days,
      earned: res.data.earned,
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
    // Yield claiming is automatic in the backend
    return apiSuccess({ amount: 0 });
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
