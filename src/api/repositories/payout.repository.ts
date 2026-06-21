import type { ApiResponse } from '../types';

/** Lifecycle state of a payout (mirrors backend internal/payout). */
export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Rail-typed beneficiary. Different rails read different fields. */
export interface PayoutDestination {
  type: string;
  account: string;
  name: string;
  bank?: string;
  country?: string;
}

export interface Payout {
  id: string;
  userId: string;
  rail: string;
  amountMinor: number;
  currency: string;
  status: PayoutStatus;
  destination: PayoutDestination;
  externalId?: string;
  failureReason?: string;
  processingAt?: string;
  completedAt?: string;
  failedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePayoutRequest {
  rail: string;
  amountMinor: number;
  currency?: string;
  destination: PayoutDestination;
  /** Caller-supplied dedupe key; makes a retried POST safe. */
  idempotencyKey: string;
}

/**
 * Payout repository — ledger-backed outbound payments over pluggable rails.
 * Like auth/mfa/escrow this ALWAYS talks to the real backend (it moves money);
 * there is no mock adapter.
 */
export interface IPayoutRepository {
  /** List the caller's payouts, newest first. */
  list(limit?: number): Promise<ApiResponse<Payout[]>>;
  /** Get one payout (owner only). */
  get(id: string): Promise<ApiResponse<Payout>>;
  /** Open and submit a payout (debits the wallet, hands off to the rail). */
  create(req: CreatePayoutRequest): Promise<ApiResponse<Payout>>;
  /** Reconcile a processing payout against its rail (user-triggered poll). */
  refresh(id: string): Promise<ApiResponse<Payout>>;
  /** The rail names the caller can send through. */
  rails(): Promise<ApiResponse<string[]>>;
}
