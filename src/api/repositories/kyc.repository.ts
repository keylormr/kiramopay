import type { ApiResponse } from '../types';

export interface IdentityVerifyResult {
  /** verified = promoted to N1; mismatch = name didn't match; not_found = id not in registry. */
  status: 'verified' | 'mismatch' | 'not_found';
  /** Official name returned by the registry (present for verified/mismatch). */
  verifiedName?: string;
  idType?: string;
  kycLevel: number;
}

/**
 * KYC repository — automated N1 identity verification. Like auth/mfa this ALWAYS
 * talks to the real backend (security-sensitive); there is no mock adapter.
 */
/** Current KYC level and the transaction limits it grants (in colones). */
export interface KycStatus {
  kycLevel: number;
  kycStatus: string;
  dailyLimit: number;
  monthlyLimit: number;
}

export interface IKycRepository {
  /**
   * Verify the authed user's own registered cedula against the Hacienda
   * registry. On a name match the account is promoted to KYC level 1.
   */
  verifyIdentity(): Promise<ApiResponse<IdentityVerifyResult>>;

  /** Current KYC level/status and the limits it grants for this user. */
  getStatus(): Promise<ApiResponse<KycStatus>>;
}
