import type { ApiResponse } from '../types';

export interface PointsAccount {
  id: string;
  userId: string;
  totalPoints: number;
  availablePoints: number;
  lifetimePoints: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
}

export interface PointsTransaction {
  id: string;
  type: 'earn' | 'redeem' | 'expire' | 'bonus';
  points: number;
  description: string;
  refType?: string;
  refId?: string;
  createdAt: string;
}

export interface Reward {
  id: string;
  name: string;
  description: string;
  category: 'discount' | 'voucher' | 'gift_card' | 'experience';
  pointsCost: number;
  imageUrl: string;
  partnerCode?: string;
  stock: number;
}

export interface Redemption {
  id: string;
  rewardId: string;
  points: number;
  status: 'pending' | 'completed' | 'cancelled';
  code?: string;
  createdAt: string;
}

export interface CashbackRule {
  id: string;
  category: string;
  percentage: number;
  maxPoints: number;
  active: boolean;
}

// Programa de referidos: el resumen que ve el usuario en Perfil. bonusPoints
// es lo que la UI promete y viene del servidor (REFERRAL_BONUS_POINTS); 0
// significa que el programa esta apagado y la UI no promete nada.
export interface ReferralSummary {
  referralCode: string;
  invitedCount: number;
  pointsEarned: number;
  bonusPoints: number;
}

// Points are issued server-side from real captured margin; there is no
// client-facing earn call (a client-reported amount would allow
// self-crediting redeemable points). The referral bonus is likewise issued by
// the server after a verified registration.
export interface ILoyaltyRepository {
  getAccount(): Promise<ApiResponse<PointsAccount>>;
  getTransactions(): Promise<ApiResponse<PointsTransaction[]>>;
  getRewards(): Promise<ApiResponse<Reward[]>>;
  redeemReward(rewardId: string): Promise<ApiResponse<Redemption>>;
  getRedemptions(): Promise<ApiResponse<Redemption[]>>;
  getCashbackRules(): Promise<ApiResponse<CashbackRule[]>>;
  getReferrals(): Promise<ApiResponse<ReferralSummary>>;
}
