import type { ApiResponse } from '../types';

export interface VirtualCard {
  id: string;
  cardNumber: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  cvv?: string;
  cardholderName: string;
  brand: 'visa' | 'mastercard';
  type: 'virtual' | 'physical';
  currency: string;
  status: 'active' | 'frozen' | 'cancelled' | 'expired';
  dailyLimit: number;
  monthlyLimit: number;
  atmLimit: number;
  dailySpent: number;
  monthlySpent: number;
}

export interface CardTransaction {
  id: string;
  cardId: string;
  amount: number;
  currency: string;
  merchantName: string;
  category: string;
  status: 'approved' | 'declined' | 'refunded';
  declineReason?: string;
  createdAt: string;
}

export interface CreateCardRequest {
  type: 'virtual' | 'physical';
  currency: string;
}

export interface UpdateLimitsRequest {
  dailyLimit?: number;
  monthlyLimit?: number;
  atmLimit?: number;
}

export interface ICardsRepository {
  createCard(request: CreateCardRequest): Promise<ApiResponse<VirtualCard>>;
  getCards(): Promise<ApiResponse<VirtualCard[]>>;
  getCard(cardId: string): Promise<ApiResponse<VirtualCard>>;
  freezeCard(cardId: string, frozen: boolean): Promise<ApiResponse<void>>;
  cancelCard(cardId: string): Promise<ApiResponse<void>>;
  updateLimits(cardId: string, request: UpdateLimitsRequest): Promise<ApiResponse<void>>;
  getCardTransactions(cardId: string): Promise<ApiResponse<CardTransaction[]>>;
}
