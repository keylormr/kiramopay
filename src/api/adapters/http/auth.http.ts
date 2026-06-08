import type {
  IAuthRepository,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  ChangePasswordRequest,
  TokenPair,
} from '../../repositories/auth.repository';
import type { ApiResponse } from '../../types';
import type { User } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpAuthRepository implements IAuthRepository {
  constructor(private client: HttpClient) {}

  async login(request: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    const res = await this.client.post<{
      user: {
        id: string;
        cedula: string;
        phone: string;
        first_name: string;
        last_name: string;
        email: string;
        kyc_level: number;
        status: string;
      };
      tokens: { access_token: string; refresh_token: string; expires_at: number };
    }>('/api/v1/auth/login', request, false);

    if (!res.success || !res.data) {
      return apiError('AUTH_FAILED', res.error?.message || 'Login failed');
    }

    const { user: u, tokens } = res.data;

    // Map backend user to frontend User type
    const user: User = {
      id: u.id,
      cedula: u.cedula,
      firstName: u.first_name,
      lastName: u.last_name,
      phone: u.phone,
      email: u.email || '',
      avatar: '',
      createdAt: new Date().toISOString(),
      kycLevel: u.kyc_level as 0 | 1 | 2,
    };

    // IMPORTANT: expose the full `tokens` object — the auth store reads
    // `result.data.tokens.access_token` to feed the in-memory provider that
    // HttpClient consults on every request. Returning only the legacy
    // `token` field leaves the store with accessToken=null → every
    // subsequent request is unauthenticated.
    return apiSuccess<LoginResponse>({
      user,
      token: tokens.access_token,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
      },
    });
  }

  async register(
    request: RegisterRequest,
  ): Promise<ApiResponse<{ user: User; tokens?: { access_token: string; refresh_token: string } }>> {
    const res = await this.client.post<{
      user: {
        id: string;
        cedula: string;
        phone: string;
        first_name: string;
        last_name: string;
        email: string;
      };
      tokens: { access_token: string; refresh_token: string };
    }>(
      '/api/v1/auth/register',
      {
        cedula: request.cedula,
        phone: request.phone,
        first_name: request.firstName,
        last_name: request.lastName,
        email: request.email,
        password: request.password,
      },
      false,
    );

    if (!res.success || !res.data) {
      return apiError('REGISTER_FAILED', res.error?.message || 'Registration failed');
    }

    const { user: u, tokens } = res.data;

    const user: User = {
      id: u.id,
      cedula: u.cedula,
      firstName: u.first_name,
      lastName: u.last_name,
      phone: u.phone,
      email: u.email || '',
      avatar: '',
      createdAt: new Date().toISOString(),
      kycLevel: 0,
    };

    return apiSuccess({
      user,
      tokens: { access_token: tokens.access_token, refresh_token: tokens.refresh_token },
    });
  }

  async validatePassword(
    _cedula: string,
    password: string,
  ): Promise<ApiResponse<{ valid: boolean }>> {
    return apiSuccess({ valid: password.length >= 8 });
  }

  async changePassword(
    request: ChangePasswordRequest,
  ): Promise<ApiResponse<{ changed: boolean }>> {
    const res = await this.client.post('/api/v1/auth/change-password', {
      old_password: request.oldPassword,
      new_password: request.newPassword,
    });

    if (!res.success) {
      return apiError('CHANGE_PASSWORD_FAILED', res.error?.message || 'Failed to change password');
    }

    return apiSuccess({ changed: true });
  }

  async refresh(refreshToken: string): Promise<ApiResponse<TokenPair>> {
    // auth=false: the refresh token travels in the body, not the Authorization
    // header — and this MUST NOT trigger the HttpClient's 401 refresh loop.
    const res = await this.client.post<{
      access_token: string;
      refresh_token: string;
      expires_at?: number;
    }>('/api/v1/auth/refresh', { refresh_token: refreshToken }, false);

    if (!res.success || !res.data) {
      return apiError('REFRESH_FAILED', res.error?.message || 'Token refresh failed');
    }
    return apiSuccess<TokenPair>({
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token,
      expires_at: res.data.expires_at,
    });
  }

  async logout(): Promise<ApiResponse<void>> {
    await this.client.post('/api/v1/auth/logout');
    this.client.clearTokens();
    return apiSuccess(undefined as unknown as void);
  }
}
