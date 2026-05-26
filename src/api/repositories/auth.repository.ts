import type { ApiResponse } from '../types';
import type { User } from '@/types';

export interface LoginRequest {
  cedula: string;
  password: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

export interface LoginResponse {
  user: User;
  /** @deprecated Use tokens.access_token; kept for back-compat. */
  token?: string;
  tokens?: TokenPair;
}

export interface RegisterRequest {
  cedula: string;
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  password: string;
}

export interface RegisterResponse {
  user: User;
  tokens?: TokenPair;
}

export interface ChangePasswordRequest {
  cedula: string;
  oldPassword: string;
  newPassword: string;
}

export interface IAuthRepository {
  login(request: LoginRequest): Promise<ApiResponse<LoginResponse>>;
  register(request: RegisterRequest): Promise<ApiResponse<RegisterResponse>>;
  validatePassword(cedula: string, password: string): Promise<ApiResponse<{ valid: boolean }>>;
  changePassword(request: ChangePasswordRequest): Promise<ApiResponse<{ changed: boolean }>>;
  logout(): Promise<ApiResponse<void>>;
}
