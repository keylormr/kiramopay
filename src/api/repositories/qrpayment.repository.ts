import type { ApiResponse } from '../types';

export type MerchantVerificationStatus = 'pending' | 'verified' | 'rejected';

/** How the logged-in user relates to a business (phase 3 team model). */
export type MerchantRole = 'owner' | 'manager' | 'cashier';

export interface QRMerchant {
  id: string;
  name: string;
  description: string;
  category: string;
  qrCode: string;
  active: boolean;
  cedula: string;
  cedulaType: 'fisica' | 'juridica';
  legalName: string;
  verificationStatus: MerchantVerificationStatus;
  rejectionReason?: string;
  commissionBps: number;
  /** Role of the CURRENT user on this business; drives which UI is shown. */
  role: MerchantRole;
}

export interface StaffMember {
  id: string;
  merchantId: string;
  userId: string;
  firstName: string;
  lastName: string;
  role: 'cashier' | 'manager';
  status: 'active' | 'revoked';
  locationId?: string;
  createdAt: string;
}

export interface MerchantLocation {
  id: string;
  merchantId: string;
  name: string;
  address: string;
  active: boolean;
}

export interface CatalogItem {
  id: string;
  merchantId: string;
  name: string;
  /** Price in MAJOR units (adapter converts to/from centimos). */
  price: number;
  currency: string;
  active: boolean;
  sortOrder: number;
}

/** One day of the sales series, dated in the client's own timezone. */
export interface BusinessReportDay {
  date: string; // YYYY-MM-DD
  gross: number;
  fee: number;
  net: number;
  count: number;
}

/** Sales aggregated for one location or collector; empty key = unattributed. */
export interface BusinessReportBucket {
  key?: string;
  label?: string;
  gross: number;
  fee: number;
  net: number;
  count: number;
}

export interface BusinessReport {
  days: number;
  totals: BusinessReportBucket;
  daily: BusinessReportDay[];
  byLocation: BusinessReportBucket[];
  byCollector: BusinessReportBucket[];
}

export interface QRPaymentCode {
  id: string;
  type: 'merchant_fixed' | 'merchant_dynamic' | 'p2p_request' | 'p2p_receive';
  amount: number;
  currency: string;
  note?: string;
  qrData: string;
  singleUse: boolean;
  used: boolean;
  expiresAt?: string;
  merchantId?: string;
  locationId?: string;
}

export interface QRPayment {
  id: string;
  qrCodeId: string;
  payerId: string;
  receiverId: string;
  merchantId?: string;
  /** Shop location the charge was for, when the business uses locations. */
  locationId?: string;
  /** Team member (owner or staff) who generated the charge. */
  collectedBy?: string;
  amount: number;
  fee: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  note?: string;
  createdAt: string;
}

export interface RegisterMerchantRequest {
  name: string;
  description: string;
  category: string;
  cedula: string;
  cedulaType: 'fisica' | 'juridica';
  legalName: string;
}

export interface CreateQRCodeRequest {
  type: string;
  amount?: number;
  currency: string;
  note?: string;
  singleUse: boolean;
  merchantId?: string;
  locationId?: string;
}

export interface ScanQRPayRequest {
  qrData: string;
  amount?: number;
  currency: string;
}

export interface IQRPaymentRepository {
  registerMerchant(request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>>;
  getMerchants(): Promise<ApiResponse<QRMerchant[]>>;
  /**
   * Correct the shop's own details. Changing the cedula or legal name sends the
   * merchant back to review — identity is not editable behind a verified badge.
   */
  updateMerchant(merchantId: string, request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>>;
  /** The shop's own balance, in major units (business money, not the owner's). */
  getMerchantBalance(merchantId: string, currency?: string): Promise<ApiResponse<number>>;
  /** Move part of the shop's balance into the owner's personal wallet. */
  withdrawMerchant(
    merchantId: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
  ): Promise<ApiResponse<void>>;
  createQRCode(request: CreateQRCodeRequest): Promise<ApiResponse<QRPaymentCode>>;
  getQRCodes(): Promise<ApiResponse<QRPaymentCode[]>>;
  scanAndPay(request: ScanQRPayRequest): Promise<ApiResponse<QRPayment>>;
  getPaymentHistory(): Promise<ApiResponse<QRPayment[]>>;
  /** The shop's sales feed — every charge of the business, visible to the whole team. */
  getMerchantPayments(merchantId: string): Promise<ApiResponse<QRPayment[]>>;
  /** Aggregated sales report (daily, by location, by collector). Owner/manager. */
  getMerchantReport(merchantId: string, days: number): Promise<ApiResponse<BusinessReport>>;
  // Team (owner manages; identified by the cedula the employee registered with).
  getStaff(merchantId: string): Promise<ApiResponse<StaffMember[]>>;
  addStaff(merchantId: string, cedula: string, role: 'cashier' | 'manager', locationId?: string): Promise<ApiResponse<StaffMember>>;
  updateStaff(merchantId: string, staffId: string, role: 'cashier' | 'manager', locationId?: string): Promise<ApiResponse<StaffMember>>;
  revokeStaff(merchantId: string, staffId: string): Promise<ApiResponse<void>>;
  // Locations (owner/manager write; team reads).
  getLocations(merchantId: string): Promise<ApiResponse<MerchantLocation[]>>;
  createLocation(merchantId: string, name: string, address: string): Promise<ApiResponse<MerchantLocation>>;
  updateLocation(merchantId: string, locationId: string, patch: { name?: string; address?: string; active?: boolean }): Promise<ApiResponse<MerchantLocation>>;
  // Catalog (owner/manager write; team reads). Prices in major units.
  getCatalog(merchantId: string): Promise<ApiResponse<CatalogItem[]>>;
  createCatalogItem(merchantId: string, item: { name: string; price: number; currency?: string }): Promise<ApiResponse<CatalogItem>>;
  updateCatalogItem(merchantId: string, itemId: string, patch: { name?: string; price?: number; active?: boolean; sortOrder?: number }): Promise<ApiResponse<CatalogItem>>;
  deleteCatalogItem(merchantId: string, itemId: string): Promise<ApiResponse<void>>;
  // Admin (gated server-side by the admin role).
  listPendingMerchants(): Promise<ApiResponse<QRMerchant[]>>;
  approveMerchant(merchantId: string): Promise<ApiResponse<QRMerchant>>;
  rejectMerchant(merchantId: string, reason: string): Promise<ApiResponse<QRMerchant>>;
  setMerchantCommission(merchantId: string, commissionBps: number): Promise<ApiResponse<QRMerchant>>;
}
