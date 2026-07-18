import type { IKycRepository, IdentityVerifyResult } from '../../repositories/kyc.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpKycRepository implements IKycRepository {
  constructor(private client: HttpClient) {}

  async verifyIdentity(): Promise<ApiResponse<IdentityVerifyResult>> {
    const res = await this.client.post<{
      status: string;
      verified_name?: string;
      id_type?: string;
      kyc_level: number;
    }>('/api/v1/kyc/verify-identity');

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'IDENTITY_VERIFY_FAILED', res.error?.message || 'Identity verification failed');
    }

    return apiSuccess({
      status: res.data.status as IdentityVerifyResult['status'],
      verifiedName: res.data.verified_name,
      idType: res.data.id_type,
      kycLevel: res.data.kyc_level,
    });
  }
}
