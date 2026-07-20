import type {
  IKycRepository,
  IdentityVerifyResult,
  KycStatus,
  BusinessLookupResult,
} from '../../repositories/kyc.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpKycRepository implements IKycRepository {
  constructor(private client: HttpClient) {}

  async getStatus(): Promise<ApiResponse<KycStatus>> {
    const res = await this.client.get<{
      kyc_level: number;
      kyc_status: string;
      limits?: { DailyMinor?: number; MonthlyMinor?: number };
    }>('/api/v1/kyc/status');

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'KYC_STATUS_FAILED', res.error?.message || 'Failed to fetch KYC status');
    }

    return apiSuccess({
      kycLevel: res.data.kyc_level,
      kycStatus: res.data.kyc_status,
      dailyLimit: (res.data.limits?.DailyMinor ?? 0) / 100,
      monthlyLimit: (res.data.limits?.MonthlyMinor ?? 0) / 100,
    });
  }

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

  async lookupBusinessCedula(cedula: string): Promise<ApiResponse<BusinessLookupResult>> {
    // POST so the cedula travels in the body, never in a URL or query string.
    const res = await this.client.post<{ name: string; id_type?: string }>(
      '/api/v1/kyc/business-lookup',
      { cedula },
    );

    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'CEDULA_NOT_FOUND', res.error?.message || 'Lookup failed');
    }

    return apiSuccess({ name: res.data.name, idType: res.data.id_type });
  }
}
