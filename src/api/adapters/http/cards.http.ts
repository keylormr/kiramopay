import type {
  ICardsRepository,
  VirtualCard,
  CardTransaction,
  CreateCardRequest,
  UpdateLimitsRequest,
} from '../../repositories/cards.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpCardsRepository implements ICardsRepository {
  constructor(private client: HttpClient) {}

  async createCard(request: CreateCardRequest): Promise<ApiResponse<VirtualCard>> {
    const res = await this.client.post<RawCard>('/api/v1/cards', request);
    if (!res.success || !res.data) return apiError('CREATE_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapCard(res.data));
  }

  async getCards(): Promise<ApiResponse<VirtualCard[]>> {
    const res = await this.client.get<RawCard[] | null>('/api/v1/cards');
    if (!res.success) return apiError('FETCH_FAILED', 'Failed to fetch cards');
    // A null payload is "no cards yet", not a failure.
    return apiSuccess(Array.isArray(res.data) ? res.data.map(mapCard) : []);
  }

  async getCard(cardId: string): Promise<ApiResponse<VirtualCard>> {
    const res = await this.client.get<RawCard>(`/api/v1/cards/${cardId}`);
    if (!res.success || !res.data) return apiError('NOT_FOUND', 'Card not found');
    return apiSuccess(mapCard(res.data));
  }

  async freezeCard(cardId: string, frozen: boolean): Promise<ApiResponse<void>> {
    const res = await this.client.post(`/api/v1/cards/${cardId}/freeze`, { frozen });
    if (!res.success) return apiError('FREEZE_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  async cancelCard(cardId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/cards/${cardId}`);
    if (!res.success) return apiError('CANCEL_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  async updateLimits(cardId: string, request: UpdateLimitsRequest): Promise<ApiResponse<void>> {
    const res = await this.client.patch(`/api/v1/cards/${cardId}/limits`, {
      daily_limit: request.dailyLimit ? request.dailyLimit * 100 : undefined,
      monthly_limit: request.monthlyLimit ? request.monthlyLimit * 100 : undefined,
      atm_limit: request.atmLimit ? request.atmLimit * 100 : undefined,
    });
    if (!res.success) return apiError('UPDATE_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  async getCardTransactions(cardId: string): Promise<ApiResponse<CardTransaction[]>> {
    const res = await this.client.get<Array<{
      id: string; card_id: string; amount: number; currency: string;
      merchant_name: string; category: string; status: string;
      decline_reason: string; created_at: string;
    }>>(`/api/v1/cards/${cardId}/transactions`);

    if (!res.success) return apiError('FETCH_FAILED', 'Failed to fetch transactions');
    if (!Array.isArray(res.data)) return apiSuccess([]);

    return apiSuccess(res.data.map((t) => ({
      id: t.id,
      cardId: t.card_id,
      amount: t.amount / 100,
      currency: t.currency,
      merchantName: t.merchant_name,
      category: t.category,
      status: t.status as CardTransaction['status'],
      declineReason: t.decline_reason || undefined,
      createdAt: t.created_at,
    })));
  }
}

interface RawCard {
  id: string; card_number: string; last4: string;
  expiry_month: number; expiry_year: number; cvv: string;
  cardholder_name: string; brand: string; type: string;
  currency: string; status: string;
  daily_limit: number; monthly_limit: number; atm_limit: number;
  daily_spent: number; monthly_spent: number;
}

function mapCard(c: RawCard): VirtualCard {
  return {
    id: c.id,
    cardNumber: c.card_number,
    last4: c.last4,
    expiryMonth: c.expiry_month,
    expiryYear: c.expiry_year,
    cvv: c.cvv || undefined,
    cardholderName: c.cardholder_name,
    brand: c.brand as VirtualCard['brand'],
    type: c.type as VirtualCard['type'],
    currency: c.currency,
    status: c.status as VirtualCard['status'],
    dailyLimit: c.daily_limit / 100,
    monthlyLimit: c.monthly_limit / 100,
    atmLimit: c.atm_limit / 100,
    dailySpent: c.daily_spent / 100,
    monthlySpent: c.monthly_spent / 100,
  };
}
