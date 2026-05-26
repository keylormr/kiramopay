import type {
  ICardsRepository,
  VirtualCard,
  CardTransaction,
  CreateCardRequest,
  UpdateLimitsRequest,
} from '../../repositories/cards.repository';
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

function generateCardNumber(): string {
  // Luhn-valid Visa test card
  const prefix = '4';
  let num = prefix;
  for (let i = 0; i < 14; i++) num += Math.floor(Math.random() * 10);
  // Luhn checksum
  let sum = 0;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = parseInt(num[i], 10);
    if ((num.length - i) % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return num + check;
}

const initialCards: VirtualCard[] = [
  {
    id: 'card-1',
    cardNumber: '4111111111111111',
    last4: '1111',
    expiryMonth: 12,
    expiryYear: 2027,
    cardholderName: 'KEILOR MARTINEZ',
    brand: 'visa',
    type: 'virtual',
    currency: 'CRC',
    status: 'active',
    dailyLimit: 500000,
    monthlyLimit: 2000000,
    atmLimit: 0,
    dailySpent: 7500,
    monthlySpent: 45000,
  },
];

export class MockCardsRepository implements ICardsRepository {
  async createCard(request: CreateCardRequest): Promise<ApiResponse<VirtualCard>> {
    const state = getState();
    const cards: VirtualCard[] = state?.cards ?? [...initialCards];
    const cardNumber = generateCardNumber();
    const card: VirtualCard = {
      id: `card-${Date.now()}`,
      cardNumber,
      last4: cardNumber.slice(-4),
      expiryMonth: new Date().getMonth() + 1,
      expiryYear: new Date().getFullYear() + 3,
      cardholderName: 'KIRAMOPAY USER',
      brand: 'visa',
      type: request.type,
      currency: request.currency,
      status: 'active',
      dailyLimit: 500000,
      monthlyLimit: 2000000,
      atmLimit: request.type === 'physical' ? 200000 : 0,
      dailySpent: 0,
      monthlySpent: 0,
    };
    cards.push(card);
    saveField('cards', cards);
    return apiSuccess(card);
  }

  async getCards(): Promise<ApiResponse<VirtualCard[]>> {
    const state = getState();
    return apiSuccess(state?.cards ?? initialCards);
  }

  async getCard(cardId: string): Promise<ApiResponse<VirtualCard>> {
    const state = getState();
    const cards: VirtualCard[] = state?.cards ?? initialCards;
    const card = cards.find((c) => c.id === cardId);
    if (!card) return apiError('NOT_FOUND', 'Tarjeta no encontrada');
    return apiSuccess(card);
  }

  async freezeCard(cardId: string, frozen: boolean): Promise<ApiResponse<void>> {
    const state = getState();
    const cards: VirtualCard[] = state?.cards ?? [...initialCards];
    const idx = cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return apiError('NOT_FOUND', 'Tarjeta no encontrada');
    cards[idx].status = frozen ? 'frozen' : 'active';
    saveField('cards', cards);
    return apiSuccess(undefined as unknown as void);
  }

  async cancelCard(cardId: string): Promise<ApiResponse<void>> {
    const state = getState();
    const cards: VirtualCard[] = state?.cards ?? [...initialCards];
    const idx = cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return apiError('NOT_FOUND', 'Tarjeta no encontrada');
    cards[idx].status = 'cancelled';
    saveField('cards', cards);
    return apiSuccess(undefined as unknown as void);
  }

  async updateLimits(cardId: string, request: UpdateLimitsRequest): Promise<ApiResponse<void>> {
    const state = getState();
    const cards: VirtualCard[] = state?.cards ?? [...initialCards];
    const idx = cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return apiError('NOT_FOUND', 'Tarjeta no encontrada');
    if (request.dailyLimit !== undefined) cards[idx].dailyLimit = request.dailyLimit;
    if (request.monthlyLimit !== undefined) cards[idx].monthlyLimit = request.monthlyLimit;
    if (request.atmLimit !== undefined) cards[idx].atmLimit = request.atmLimit;
    saveField('cards', cards);
    return apiSuccess(undefined as unknown as void);
  }

  async getCardTransactions(cardId: string): Promise<ApiResponse<CardTransaction[]>> {
    const state = getState();
    const txs: CardTransaction[] = state?.cardTransactions ?? [
      { id: 'ctx-1', cardId: 'card-1', amount: 7500, currency: 'CRC', merchantName: 'Cafe Alma', category: 'Comida', status: 'approved', createdAt: '2026-02-16T09:41:00Z' },
      { id: 'ctx-2', cardId: 'card-1', amount: 4350, currency: 'CRC', merchantName: 'Uber', category: 'Transporte', status: 'approved', createdAt: '2026-02-15T08:15:00Z' },
    ];
    return apiSuccess(txs.filter((t) => t.cardId === cardId));
  }
}
