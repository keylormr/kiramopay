import type {
  IMfaRepository,
  TotpEnrollResponse,
} from '../../repositories/mfa.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess } from '../../types';
import { falla } from './falla';
import { HttpClient } from './client';

export class HttpMfaRepository implements IMfaRepository {
  constructor(private client: HttpClient) {}

  async totpStatus(): Promise<ApiResponse<{ enabled: boolean }>> {
    const res = await this.client.get<{ enabled: boolean }>('/api/v1/mfa/totp/status');
    if (!res.success || !res.data) {
      return falla(res, 'TOTP_STATUS_FAILED');
    }
    return apiSuccess({ enabled: !!res.data.enabled });
  }

  async totpEnroll(): Promise<ApiResponse<TotpEnrollResponse>> {
    const res = await this.client.post<{ secret: string; otpauth_url: string }>(
      '/api/v1/mfa/totp/enroll',
    );
    if (!res.success || !res.data) {
      return falla(res, 'TOTP_ENROLL_FAILED');
    }
    return apiSuccess({ secret: res.data.secret, otpauthUrl: res.data.otpauth_url });
  }

  async totpConfirm(code: string): Promise<ApiResponse<{ recoveryCodes: string[] }>> {
    const res = await this.client.post<{ recovery_codes: string[] }>(
      '/api/v1/mfa/totp/confirm',
      { code },
    );
    if (!res.success || !res.data) {
      return falla(res, 'TOTP_CONFIRM_FAILED');
    }
    return apiSuccess({ recoveryCodes: res.data.recovery_codes || [] });
  }

  async totpVerify(code: string, purpose?: string): Promise<ApiResponse<{ verified: boolean }>> {
    const res = await this.client.post<{ status: string }>('/api/v1/mfa/totp/verify', {
      code,
      purpose,
    });
    if (!res.success) {
      return falla(res, 'TOTP_VERIFY_FAILED');
    }
    return apiSuccess({ verified: true });
  }

  async totpDisable(code: string): Promise<ApiResponse<{ disabled: boolean }>> {
    const res = await this.client.post<{ status: string }>('/api/v1/mfa/totp/disable', { code });
    if (!res.success) {
      return falla(res, 'TOTP_DISABLE_FAILED');
    }
    return apiSuccess({ disabled: true });
  }
}
