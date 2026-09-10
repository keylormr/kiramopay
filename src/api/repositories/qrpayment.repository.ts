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

/**
 * QRPaymentCode es ahora la IDENTIDAD de cobro: una por persona-y-moneda y una
 * por comercio-sucursal-y-moneda. Se imprime, se pega y no cambia jamas.
 *
 * `amount`, `note`, `singleUse`, `used` y `expiresAt` quedan CONGELADOS en un
 * codigo activo: el monto y el vencimiento viven en QRCharge. Siguen aqui
 * porque el historico y las filas viejas los usan.
 */
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
  status?: 'active' | 'historic' | 'revoked';
}

export type QRChargeStatus = 'pending' | 'paid' | 'cancelled' | 'expired' | 'superseded';

/**
 * QRCharge es UNA VENTA: monto, nota, vencimiento y estado, con su PROPIO
 * payload. Es el QR que aparece en la pantalla del cajero, no el que esta
 * pegado en la pared.
 */
export interface QRCharge {
  id: string;
  qrCodeId: string;
  merchantId?: string;
  locationId?: string;
  createdBy: string;
  /** MAJOR units (el adaptador convierte desde centimos). */
  amount: number;
  currency: string;
  note?: string;
  channel: 'counter' | 'link';
  status: QRChargeStatus;
  qrData: string;
  expiresAt: string;
  paidBy?: string;
  paidAt?: string;
  supersededBy?: string;
  createdAt: string;
}

/**
 * ResolvedQR es lo que la hoja de pago pinta ANTES del boton de pagar: a quien
 * se le esta por pagar. Un codigo pegado en un mostrador se puede tapar con el
 * de otro, y hasta ahora la hoja no mostraba nunca quien recibe.
 */
export interface ResolvedQR {
  kind: 'code' | 'charge' | 'legacy';
  payeeName?: string;
  merchantName?: string;
  locationName?: string;
  currency: string;
  /** MAJOR units. 0 = monto abierto, lo escribe el pagador. */
  amount: number;
  note?: string;
  status?: string;
  expiresAt?: string;
  chargeId?: string;
  qrCodeId: string;
}

export interface QRPayment {
  id: string;
  qrCodeId: string;
  /** El cobro que se reclamo; vacio si fue un pago de monto abierto. */
  chargeId?: string;
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
  /** El cobro que el pagador VIO. Si el cajero lo cambio, el servidor rechaza. */
  chargeId?: string;
  /**
   * Nonce del pagador, solo para el camino de MONTO ABIERTO. Se acuna al tocar
   * Pagar y sobrevive a un reintento de red: sin el, el servidor no puede
   * distinguir "el telefono reintento" de "quiso pagar otra vez".
   *
   * UUID sin guiones (32 caracteres).
   */
  idempotencyKey?: string;
}

export interface CreateChargeRequest {
  qrCodeId: string;
  /** MAJOR units. */
  amount: number;
  note?: string;
  channel?: 'counter' | 'link';
  /** Id del cobro que se reemplaza cuando cambia el monto. */
  replaces?: string;
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
  /** El codigo permanente propio; se crea la primera vez que se pide. */
  getMyCode(currency?: string): Promise<ApiResponse<QRPaymentCode>>;
  /** El codigo permanente del mostrador (comercio + sucursal + moneda). */
  getMerchantCode(merchantId: string, opts?: { locationId?: string; currency?: string }): Promise<ApiResponse<QRPaymentCode>>;
  /** Retira un codigo permanente propio y deja emitir otro. */
  revokeCode(codeId: string): Promise<ApiResponse<void>>;
  /** Quien cobra, cuanto y en que estado esta, para la hoja de pago. */
  resolveQr(qrData: string): Promise<ApiResponse<ResolvedQR>>;
  createCharge(request: CreateChargeRequest): Promise<ApiResponse<QRCharge>>;
  getCharge(chargeId: string): Promise<ApiResponse<QRCharge>>;
  cancelCharge(chargeId: string): Promise<ApiResponse<void>>;
  listCharges(status?: QRChargeStatus): Promise<ApiResponse<QRCharge[]>>;
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
