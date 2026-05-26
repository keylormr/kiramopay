import type {
  ICryptoRepository,
  BuyCryptoRequest,
  SellCryptoRequest,
  ConvertCryptoRequest,
  StakeCryptoRequest,
} from '../../repositories/crypto.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import type { CryptoAsset, CryptoTransaction, StakingPosition, PriceAlert } from '@/types';
import { initialCryptoAssets, initialCryptoTransactions, initialStakingPositions } from './mock-data';

const STORAGE_KEY = 'kiramopay_app_state';

function getCryptoState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const state = data ? JSON.parse(data) : null;
    return state?.crypto ?? {
      assets: initialCryptoAssets,
      transactions: initialCryptoTransactions,
      stakingPositions: initialStakingPositions,
      priceAlerts: [],
      favoriteAssets: ['BTC', 'ETH', 'USDT'],
      defaultConvertCurrency: 'CRC',
    };
  } catch {
    return {
      assets: initialCryptoAssets,
      transactions: initialCryptoTransactions,
      stakingPositions: initialStakingPositions,
      priceAlerts: [],
      favoriteAssets: ['BTC', 'ETH', 'USDT'],
      defaultConvertCurrency: 'CRC',
    };
  }
}

function saveCryptoState(crypto: Record<string, unknown>) {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const state = data ? JSON.parse(data) : {};
    state.crypto = crypto;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // noop
  }
}

export class MockCryptoRepository implements ICryptoRepository {
  async getAssets(): Promise<ApiResponse<CryptoAsset[]>> {
    return apiSuccess(getCryptoState().assets);
  }

  async getTransactions(): Promise<ApiResponse<CryptoTransaction[]>> {
    return apiSuccess(getCryptoState().transactions);
  }

  async buy(request: BuyCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const crypto = getCryptoState();
    const assets: CryptoAsset[] = crypto.assets;
    const asset = assets.find((a: CryptoAsset) => a.symbol === request.asset);
    if (!asset) return apiError('NOT_FOUND', `Asset ${request.asset} not found`);

    const newBalance = asset.balance + request.amount;
    const totalCost = asset.balance * asset.avgBuyPrice + request.amount * request.price;
    asset.balance = newBalance;
    asset.avgBuyPrice = newBalance > 0 ? totalCost / newBalance : request.price;

    const tx: CryptoTransaction = {
      id: `ctx-${Date.now()}`,
      type: 'buy',
      fromAsset: request.fromCurrency,
      toAsset: request.asset,
      fromAmount: request.fromAmount,
      toAmount: request.amount,
      price: request.price,
      fee: request.fromAmount * 0.005,
      date: 'Ahora',
      status: 'completed',
    };
    crypto.transactions = [tx, ...crypto.transactions];
    saveCryptoState(crypto);
    return apiSuccess(tx);
  }

  async sell(request: SellCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const crypto = getCryptoState();
    const asset = crypto.assets.find((a: CryptoAsset) => a.symbol === request.asset);
    if (!asset) return apiError('NOT_FOUND', `Asset ${request.asset} not found`);
    if (asset.balance < request.amount) return apiError('INSUFFICIENT', 'Insufficient balance');

    asset.balance -= request.amount;
    const tx: CryptoTransaction = {
      id: `ctx-${Date.now()}`,
      type: 'sell',
      fromAsset: request.asset,
      toAsset: request.toCurrency,
      fromAmount: request.amount,
      toAmount: request.toAmount,
      price: request.price,
      fee: request.toAmount * 0.005,
      date: 'Ahora',
      status: 'completed',
    };
    crypto.transactions = [tx, ...crypto.transactions];
    saveCryptoState(crypto);
    return apiSuccess(tx);
  }

  async convert(request: ConvertCryptoRequest): Promise<ApiResponse<CryptoTransaction>> {
    const crypto = getCryptoState();
    const from = crypto.assets.find((a: CryptoAsset) => a.symbol === request.fromAsset);
    const to = crypto.assets.find((a: CryptoAsset) => a.symbol === request.toAsset);
    if (!from || !to) return apiError('NOT_FOUND', 'Asset not found');
    if (from.balance < request.fromAmount) return apiError('INSUFFICIENT', 'Insufficient balance');

    from.balance -= request.fromAmount;
    const newBalance = to.balance + request.toAmount;
    const totalCost = to.balance * to.avgBuyPrice + request.toAmount * request.price;
    to.balance = newBalance;
    to.avgBuyPrice = newBalance > 0 ? totalCost / newBalance : request.price;

    const tx: CryptoTransaction = {
      id: `ctx-${Date.now()}`,
      type: 'convert',
      fromAsset: request.fromAsset,
      toAsset: request.toAsset,
      fromAmount: request.fromAmount,
      toAmount: request.toAmount,
      price: request.price,
      fee: request.fromAmount * 0.001,
      date: 'Ahora',
      status: 'completed',
    };
    crypto.transactions = [tx, ...crypto.transactions];
    saveCryptoState(crypto);
    return apiSuccess(tx);
  }

  async getStakingPositions(): Promise<ApiResponse<StakingPosition[]>> {
    return apiSuccess(getCryptoState().stakingPositions);
  }

  async stake(request: StakeCryptoRequest): Promise<ApiResponse<StakingPosition>> {
    const crypto = getCryptoState();
    const asset = crypto.assets.find((a: CryptoAsset) => a.symbol === request.asset);
    if (!asset) return apiError('NOT_FOUND', `Asset ${request.asset} not found`);
    if (asset.balance < request.amount) return apiError('INSUFFICIENT', 'Insufficient balance');

    asset.balance -= request.amount;
    const position: StakingPosition = {
      id: `stake-${Date.now()}`,
      asset: request.asset,
      amount: request.amount,
      apy: request.apy,
      startDate: 'Ahora',
      earned: 0,
      locked: request.locked,
      lockPeriodDays: request.lockDays,
    };
    crypto.stakingPositions = [...crypto.stakingPositions, position];
    saveCryptoState(crypto);
    return apiSuccess(position);
  }

  async unstake(positionId: string): Promise<ApiResponse<void>> {
    const crypto = getCryptoState();
    const position = crypto.stakingPositions.find((p: StakingPosition) => p.id === positionId);
    if (!position) return apiError('NOT_FOUND', 'Staking position not found');

    const asset = crypto.assets.find((a: CryptoAsset) => a.symbol === position.asset);
    if (asset) {
      asset.balance += position.amount + position.earned;
    }
    crypto.stakingPositions = crypto.stakingPositions.filter((p: StakingPosition) => p.id !== positionId);
    saveCryptoState(crypto);
    return apiSuccess(undefined as unknown as void);
  }

  async claimYield(positionId: string): Promise<ApiResponse<{ amount: number }>> {
    const crypto = getCryptoState();
    const position = crypto.stakingPositions.find((p: StakingPosition) => p.id === positionId);
    if (!position) return apiError('NOT_FOUND', 'Staking position not found');

    const amount = position.earned;
    const asset = crypto.assets.find((a: CryptoAsset) => a.symbol === position.asset);
    if (asset) {
      asset.balance += amount;
    }
    position.earned = 0;
    saveCryptoState(crypto);
    return apiSuccess({ amount });
  }

  async getPriceAlerts(): Promise<ApiResponse<PriceAlert[]>> {
    return apiSuccess(getCryptoState().priceAlerts);
  }

  async addPriceAlert(alert: PriceAlert): Promise<ApiResponse<PriceAlert>> {
    const crypto = getCryptoState();
    crypto.priceAlerts = [...crypto.priceAlerts, alert];
    saveCryptoState(crypto);
    return apiSuccess(alert);
  }

  async removePriceAlert(alertId: string): Promise<ApiResponse<void>> {
    const crypto = getCryptoState();
    crypto.priceAlerts = crypto.priceAlerts.filter((a: PriceAlert) => a.id !== alertId);
    saveCryptoState(crypto);
    return apiSuccess(undefined as unknown as void);
  }
}
