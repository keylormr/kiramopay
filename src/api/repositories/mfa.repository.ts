import type { ApiResponse } from '../types';

export interface TotpEnrollResponse {
  /** Base32 secret to type manually into an authenticator app. */
  secret: string;
  /** otpauth:// URI to render as a QR code. */
  otpauthUrl: string;
}

/**
 * MFA repository — TOTP authenticator-app enrollment. Like auth, this ALWAYS
 * talks to the real backend (security-sensitive); there is no mock adapter.
 */
export interface IMfaRepository {
  /** Whether the current user has an active authenticator enrollment. */
  totpStatus(): Promise<ApiResponse<{ enabled: boolean }>>;
  /** Begin enrollment; returns the secret + otpauth URI (inactive until confirmed). */
  totpEnroll(): Promise<ApiResponse<TotpEnrollResponse>>;
  /** Confirm the first code, activating 2FA and returning one-time recovery codes. */
  totpConfirm(code: string): Promise<ApiResponse<{ recoveryCodes: string[] }>>;
  /** Verify a TOTP/recovery code for a high-risk operation (records a verified challenge). */
  totpVerify(code: string, purpose?: string): Promise<ApiResponse<{ verified: boolean }>>;
  /** Disable 2FA after re-verifying a current code. */
  totpDisable(code: string): Promise<ApiResponse<{ disabled: boolean }>>;
}
