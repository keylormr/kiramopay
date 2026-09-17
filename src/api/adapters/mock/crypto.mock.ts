import type {
  ICryptoRepository,
  BuyCryptoRequest,
  SellCryptoRequest,
  ConvertCryptoRequest,
  StakeCryptoRequest,
} from '../../repositories/crypto.repository';
import { ACTIVOS_CON_STAKING } from '../../repositories/crypto.repository';
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

// Mismo formato de id que el servidor: la pantalla retira la posicion por el id
// que le devolvieron, y dos Date.now() seguidos no siempre coinciden.
function nuevoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Apartar o liberar se anota sin precio: el activo solo cambia de lugar.
function movimientoDeStaking(type: 'stake' | 'unstake', asset: string, amount: number): CryptoTransaction {
  return {
    id: nuevoId(),
    type,
    fromAsset: asset,
    fromAmount: amount,
    price: 0,
    fee: 0,
    date: new Date().toISOString(),
    status: 'completed',
  };
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
      id: nuevoId(),
      type: 'buy',
      fromAsset: request.fromCurrency,
      toAsset: request.asset,
      fromAmount: request.fromAmount,
      toAmount: request.amount,
      price: request.price,
      priceCurrency: 'USD',
      // El servidor no cobra comision por comprar, vender ni convertir.
      fee: 0,
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
    if (asset.balance < request.amount) return apiError('CRYPTO_INSUFFICIENT_BALANCE', 'insufficient asset balance');

    asset.balance -= request.amount;
    const tx: CryptoTransaction = {
      id: nuevoId(),
      type: 'sell',
      fromAsset: request.asset,
      toAsset: request.toCurrency,
      fromAmount: request.amount,
      toAmount: request.toAmount,
      price: request.price,
      priceCurrency: 'USD',
      fee: 0,
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
    if (from.balance < request.fromAmount) return apiError('CRYPTO_INSUFFICIENT_BALANCE', 'insufficient asset balance');

    from.balance -= request.fromAmount;
    const newBalance = to.balance + request.toAmount;
    const totalCost = to.balance * to.avgBuyPrice + request.toAmount * request.price;
    to.balance = newBalance;
    to.avgBuyPrice = newBalance > 0 ? totalCost / newBalance : request.price;

    const tx: CryptoTransaction = {
      id: nuevoId(),
      type: 'convert',
      fromAsset: request.fromAsset,
      toAsset: request.toAsset,
      fromAmount: request.fromAmount,
      toAmount: request.toAmount,
      price: request.price,
      priceCurrency: 'USD',
      fee: 0,
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
    // Las mismas reglas que el servidor: solo los activos del programa.
    const apy = ACTIVOS_CON_STAKING[request.asset];
    if (apy === undefined) return apiError('STAKING_NOT_AVAILABLE', 'staking is not available for this asset');
    const crypto = getCryptoState();
    const asset = crypto.assets.find((a: CryptoAsset) => a.symbol === request.asset);
    if (!asset || asset.balance < request.amount) {
      return apiError('CRYPTO_INSUFFICIENT_BALANCE', 'insufficient asset balance');
    }

    asset.balance -= request.amount;
    const position: StakingPosition = {
      id: nuevoId(),
      asset: request.asset,
      amount: request.amount,
      apy,
      startDate: new Date().toISOString(),
      earned: 0,
      locked: request.locked,
      lockPeriodDays: request.lockDays,
    };
    crypto.stakingPositions = [...crypto.stakingPositions, position];
    // Como el servidor: apartar tambien queda en el historial.
    crypto.transactions = [movimientoDeStaking('stake', position.asset, position.amount), ...crypto.transactions];
    saveCryptoState(crypto);
    return apiSuccess(position);
  }

  async unstake(positionId: string): Promise<ApiResponse<void>> {
    const crypto = getCryptoState();
    const position = crypto.stakingPositions.find((p: StakingPosition) => p.id === positionId);
    if (!position) return apiError('STAKING_POSITION_NOT_FOUND', 'staking position not found');

    const asset = crypto.assets.find((a: CryptoAsset) => a.symbol === position.asset);
    if (asset) {
      asset.balance += position.amount + position.earned;
    }
    crypto.stakingPositions = crypto.stakingPositions.filter((p: StakingPosition) => p.id !== positionId);
    crypto.transactions = [
      movimientoDeStaking('unstake', position.asset, position.amount + position.earned),
      ...crypto.transactions,
    ];
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
