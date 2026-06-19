import type { ApiResponse } from '../types';

/** Workflow state of an escrow agreement (mirrors backend internal/escrow). */
export type EscrowStatus =
  | 'pending'
  | 'funded'
  | 'released'
  | 'refunded'
  | 'disputed'
  | 'cancelled';

export interface EscrowAgreement {
  id: string;
  buyerId: string;
  sellerId: string;
  amountMinor: number;
  currency: string;
  status: EscrowStatus;
  description: string;
  disputeReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEscrowRequest {
  sellerId: string;
  amountMinor: number;
  currency?: string;
  description: string;
}

/**
 * Escrow repository — ledger-backed buyer-funded payment holds. Like auth/mfa
 * this ALWAYS talks to the real backend (it moves money); there is no mock
 * adapter.
 */
export interface IEscrowRepository {
  /** List the caller's agreements (as buyer or seller), newest first. */
  list(limit?: number): Promise<ApiResponse<EscrowAgreement[]>>;
  /** Get one agreement (parties only). */
  get(id: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Create a pending agreement (caller = buyer; no money moves yet). */
  create(req: CreateEscrowRequest): Promise<ApiResponse<EscrowAgreement>>;
  /** Fund the agreement (buyer only; debits buyer → escrow). */
  fund(id: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Release held funds to the seller (buyer only). */
  release(id: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Return held funds to the buyer (seller only). */
  refund(id: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Freeze a funded agreement pending admin resolution (either party). */
  dispute(id: string, reason: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Cancel a pending (unfunded) agreement (either party). */
  cancel(id: string): Promise<ApiResponse<EscrowAgreement>>;
}
