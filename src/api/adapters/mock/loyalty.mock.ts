import type {
  ILoyaltyRepository,
  PointsAccount,
  PointsTransaction,
  Reward,
  Redemption,
  CashbackRule,
  EarnPointsRequest,
} from '../../repositories/loyalty.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';

const STORAGE_KEY = 'kiramopay_app_state';

function getState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveField(field: string, value: unknown) {
  const state = getState() || {};
  state[field] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const initialAccount: PointsAccount = {
  id: 'pts-1',
  userId: 'current-user',
  totalPoints: 4500,
  availablePoints: 4500,
  lifetimePoints: 12800,
  tier: 'silver',
};

const initialTransactions: PointsTransaction[] = [
  { id: 'pt-1', type: 'earn', points: 150, description: 'Compra en Cafe Alma', refType: 'transaction', refId: '1', createdAt: '2026-02-16T09:41:00Z' },
  { id: 'pt-2', type: 'earn', points: 500, description: 'Pago de servicio ICE', refType: 'bill', refId: '1', createdAt: '2026-02-14T10:00:00Z' },
  { id: 'pt-3', type: 'redeem', points: -2000, description: 'Canje: Vale AutoMercado ₡5,000', createdAt: '2026-02-10T14:30:00Z' },
  { id: 'pt-4', type: 'bonus', points: 1000, description: 'Bono de bienvenida', createdAt: '2026-01-15T08:00:00Z' },
];

const initialRewards: Reward[] = [
  { id: 'rw-1', name: 'Vale AutoMercado ₡5,000', description: 'Vale de descuento para compras en AutoMercado', category: 'voucher', pointsCost: 2000, imageUrl: '/rewards/automercado.png', stock: 50 },
  { id: 'rw-2', name: 'Cafe gratis Starbucks', description: 'Bebida mediana gratis en cualquier Starbucks CR', category: 'voucher', pointsCost: 800, imageUrl: '/rewards/starbucks.png', partnerCode: 'SBUX', stock: 100 },
  { id: 'rw-3', name: '10% descuento Uber', description: 'Codigo de 10% de descuento en tu proximo viaje Uber', category: 'discount', pointsCost: 500, imageUrl: '/rewards/uber.png', partnerCode: 'UBER', stock: 200 },
  { id: 'rw-4', name: 'Gift Card Netflix ₡10,000', description: 'Tarjeta de regalo Netflix Costa Rica', category: 'gift_card', pointsCost: 5000, imageUrl: '/rewards/netflix.png', stock: 25 },
];

const initialCashbackRules: CashbackRule[] = [
  { id: 'cb-1', category: 'Comida', percentage: 2, maxPoints: 500, active: true },
  { id: 'cb-2', category: 'Transporte', percentage: 1.5, maxPoints: 300, active: true },
  { id: 'cb-3', category: 'Servicios', percentage: 3, maxPoints: 1000, active: true },
  { id: 'cb-4', category: 'Supermercado', percentage: 5, maxPoints: 2000, active: true },
];

export class MockLoyaltyRepository implements ILoyaltyRepository {
  async getAccount(): Promise<ApiResponse<PointsAccount>> {
    const state = getState();
    return apiSuccess(state?.pointsAccount ?? initialAccount);
  }

  async getTransactions(): Promise<ApiResponse<PointsTransaction[]>> {
    const state = getState();
    return apiSuccess(state?.pointsTransactions ?? initialTransactions);
  }

  async earnPoints(request: EarnPointsRequest): Promise<ApiResponse<PointsTransaction>> {
    const state = getState();
    const account: PointsAccount = state?.pointsAccount ?? { ...initialAccount };
    const points = Math.floor(request.amount * 0.02); // 2% default earn rate

    const tx: PointsTransaction = {
      id: `pt-${Date.now()}`,
      type: 'earn',
      points,
      description: `Puntos por ${request.refType}`,
      refType: request.refType,
      refId: request.refId,
      createdAt: new Date().toISOString(),
    };

    account.totalPoints += points;
    account.availablePoints += points;
    account.lifetimePoints += points;
    saveField('pointsAccount', account);

    const txs: PointsTransaction[] = state?.pointsTransactions ?? [...initialTransactions];
    txs.unshift(tx);
    saveField('pointsTransactions', txs);

    return apiSuccess(tx);
  }

  async getRewards(): Promise<ApiResponse<Reward[]>> {
    return apiSuccess(initialRewards);
  }

  async redeemReward(rewardId: string): Promise<ApiResponse<Redemption>> {
    const reward = initialRewards.find((r) => r.id === rewardId);
    if (!reward) return apiError('NOT_FOUND', 'Recompensa no encontrada');

    const state = getState();
    const account: PointsAccount = state?.pointsAccount ?? { ...initialAccount };
    if (account.availablePoints < reward.pointsCost) {
      return apiError('INSUFFICIENT', 'Puntos insuficientes');
    }

    account.availablePoints -= reward.pointsCost;
    account.totalPoints -= reward.pointsCost;
    saveField('pointsAccount', account);

    const redemption: Redemption = {
      id: `rd-${Date.now()}`,
      rewardId,
      points: reward.pointsCost,
      status: 'completed',
      code: `KP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      createdAt: new Date().toISOString(),
    };

    const redemptions: Redemption[] = state?.redemptions ?? [];
    redemptions.unshift(redemption);
    saveField('redemptions', redemptions);

    return apiSuccess(redemption);
  }

  async getRedemptions(): Promise<ApiResponse<Redemption[]>> {
    const state = getState();
    return apiSuccess(state?.redemptions ?? []);
  }

  async getCashbackRules(): Promise<ApiResponse<CashbackRule[]>> {
    return apiSuccess(initialCashbackRules);
  }
}
