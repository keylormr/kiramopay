import type { ApiResponse } from '../types';

export type AdminUserStatus = 'active' | 'blocked' | 'suspended' | 'closed';

/**
 * A user as the admin console sees it. The identity fields arrive already
 * masked by the server (last digits only, obfuscated mailbox); the full values
 * never reach the client.
 */
export interface AdminUser {
  id: string;
  firstName: string;
  lastName: string;
  /** Nombre de usuario, SIN enmascarar: es lo que soporte tiene que poder dictar. */
  username: string;
  cedulaMasked: string;
  phoneMasked: string;
  emailMasked: string;
  status: AdminUserStatus;
  role: string;
  kycLevel: number;
  createdAt: string;
  lastLoginAt: string | null;
  blockedAt: string | null;
  blockedReason: string;
  blockedByName: string;
  /** Scheduled expiry (ISO-8601). Null when the account never expires. */
  expiresAt: string | null;
}

/**
 * Admin repository: remote account blocking. Like kyc/auth this ALWAYS talks
 * to the real backend (the role is enforced server-side); there is no mock
 * adapter.
 */
export interface IAdminRepository {
  /** Exact match by cedula/phone/email, or partial match by name (3+ chars). */
  searchUsers(term: string): Promise<ApiResponse<AdminUser[]>>;
  listBlockedUsers(): Promise<ApiResponse<AdminUser[]>>;
  getUser(id: string): Promise<ApiResponse<AdminUser>>;
  /** Blocks the account and revokes every session. The reason is audited. */
  blockUser(id: string, reason: string): Promise<ApiResponse<AdminUser>>;
  unblockUser(id: string): Promise<ApiResponse<AdminUser>>;
  /**
   * Schedules when the account stops working, or clears it with null. Setting
   * it blocks nothing right away: a sweep on the server closes the account once
   * the moment passes, through the same path as a manual block.
   */
  setUserExpiry(id: string, expiresAt: string | null): Promise<ApiResponse<AdminUser>>;
}
