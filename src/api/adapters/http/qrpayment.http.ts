import type {
  IQRPaymentRepository,
  QRMerchant,
  QRPaymentCode,
  QRPayment,
  MerchantVerificationStatus,
  MerchantRole,
  StaffMember,
  MerchantLocation,
  CatalogItem,
  BusinessReport,
  BusinessReportBucket,
  BusinessReportDay,
  RegisterMerchantRequest,
  CreateQRCodeRequest,
  ScanQRPayRequest,
} from '../../repositories/qrpayment.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

interface MerchantDTO {
  id: string;
  name: string;
  description: string;
  category: string;
  qr_code: string;
  active: boolean;
  cedula?: string;
  cedula_type?: string;
  legal_name?: string;
  verification_status?: string;
  rejection_reason?: string;
  commission_bps?: number;
  role?: string;
}

function mapMerchant(d: MerchantDTO): QRMerchant {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    category: d.category,
    qrCode: d.qr_code,
    active: d.active,
    cedula: d.cedula ?? '',
    cedulaType: (d.cedula_type === 'juridica' ? 'juridica' : 'fisica'),
    legalName: d.legal_name ?? '',
    verificationStatus: (d.verification_status as MerchantVerificationStatus) ?? 'pending',
    rejectionReason: d.rejection_reason || undefined,
    commissionBps: d.commission_bps ?? 0,
    // Endpoints that return a single merchant (register/update/admin) are all
    // owner or admin flows, so owner is the right default when absent.
    role: (d.role as MerchantRole) || 'owner',
  };
}

interface StaffDTO {
  id: string;
  merchant_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
  location_id?: string;
  created_at: string;
}

function mapStaff(d: StaffDTO): StaffMember {
  return {
    id: d.id,
    merchantId: d.merchant_id,
    userId: d.user_id,
    firstName: d.first_name,
    lastName: d.last_name,
    role: d.role === 'manager' ? 'manager' : 'cashier',
    status: d.status === 'revoked' ? 'revoked' : 'active',
    locationId: d.location_id || undefined,
    createdAt: d.created_at,
  };
}

interface LocationDTO {
  id: string;
  merchant_id: string;
  name: string;
  address: string;
  active: boolean;
}

function mapLocation(d: LocationDTO): MerchantLocation {
  return { id: d.id, merchantId: d.merchant_id, name: d.name, address: d.address, active: d.active };
}

interface CatalogItemDTO {
  id: string;
  merchant_id: string;
  name: string;
  price_minor: number;
  currency: string;
  active: boolean;
  sort_order: number;
}

function mapCatalogItem(d: CatalogItemDTO): CatalogItem {
  return {
    id: d.id,
    merchantId: d.merchant_id,
    name: d.name,
    price: d.price_minor / 100, // minor -> major
    currency: d.currency,
    active: d.active,
    sortOrder: d.sort_order,
  };
}

interface PaymentDTO {
  id: string;
  qr_code_id: string;
  payer_id: string;
  receiver_id: string;
  merchant_id: string;
  location_id?: string;
  collected_by?: string;
  amount: number;
  fee?: number;
  currency: string;
  status: string;
  note: string;
  created_at: string;
}

function mapPayment(d: PaymentDTO): QRPayment {
  return {
    id: d.id,
    qrCodeId: d.qr_code_id,
    payerId: d.payer_id,
    receiverId: d.receiver_id,
    merchantId: d.merchant_id || undefined,
    locationId: d.location_id || undefined,
    collectedBy: d.collected_by || undefined,
    amount: d.amount / 100,
    fee: (d.fee ?? 0) / 100,
    currency: d.currency,
    status: d.status as QRPayment['status'],
    note: d.note || undefined,
    createdAt: d.created_at,
  };
}

interface QRCodeDTO {
  id: string;
  type: string;
  amount: number;
  currency: string;
  note: string;
  qr_data: string;
  single_use: boolean;
  used: boolean;
  expires_at: string;
  merchant_id?: string;
  location_id?: string;
}

function mapCode(d: QRCodeDTO): QRPaymentCode {
  return {
    id: d.id,
    type: d.type as QRPaymentCode['type'],
    amount: d.amount / 100,
    currency: d.currency,
    note: d.note || undefined,
    qrData: d.qr_data,
    singleUse: d.single_use,
    used: d.used,
    expiresAt: d.expires_at || undefined,
    merchantId: d.merchant_id || undefined,
    locationId: d.location_id || undefined,
  };
}

export class HttpQRPaymentRepository implements IQRPaymentRepository {
  constructor(private client: HttpClient) {}

  async updateMerchant(merchantId: string, request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.patch<MerchantDTO>(`/api/v1/qr/merchants/${merchantId}`, {
      name: request.name,
      description: request.description,
      category: request.category,
      cedula: request.cedula,
      cedula_type: request.cedulaType,
      legal_name: request.legalName,
    });

    if (!res.success || !res.data) return apiError('UPDATE_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapMerchant(res.data));
  }

  async getMerchantBalance(merchantId: string, currency = 'CRC'): Promise<ApiResponse<number>> {
    const res = await this.client.get<{ balance: number; currency: string }>(
      `/api/v1/qr/merchants/${merchantId}/balance?currency=${currency}`,
    );
    if (!res.success || !res.data) return apiError('FETCH_FAILED', res.error?.message || 'Failed');
    return apiSuccess(res.data.balance / 100); // minor units -> major
  }

  async withdrawMerchant(
    merchantId: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
  ): Promise<ApiResponse<void>> {
    const res = await this.client.post(`/api/v1/qr/merchants/${merchantId}/withdraw`, {
      amount: Math.round(amount * 100), // major -> minor units
      currency,
      idempotency_key: idempotencyKey,
    });
    if (!res.success) return apiError('WITHDRAW_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  async registerMerchant(request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.post<MerchantDTO>('/api/v1/qr/merchant', {
      name: request.name,
      description: request.description,
      category: request.category,
      cedula: request.cedula,
      cedula_type: request.cedulaType,
      legal_name: request.legalName,
    });

    if (!res.success || !res.data) return apiError('REGISTER_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapMerchant(res.data));
  }

  async getMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    const res = await this.client.get<MerchantDTO[]>('/api/v1/qr/merchants');
    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch merchants');
    return apiSuccess(res.data.map(mapMerchant));
  }

  async createQRCode(request: CreateQRCodeRequest): Promise<ApiResponse<QRPaymentCode>> {
    const res = await this.client.post<QRCodeDTO>('/api/v1/qr/codes', {
      type: request.type,
      amount: request.amount ? request.amount * 100 : 0,
      currency: request.currency,
      note: request.note,
      single_use: request.singleUse,
      merchant_id: request.merchantId,
      location_id: request.locationId,
    });

    if (!res.success || !res.data) return apiError('CREATE_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapCode(res.data));
  }

  async getQRCodes(): Promise<ApiResponse<QRPaymentCode[]>> {
    const res = await this.client.get<QRCodeDTO[]>('/api/v1/qr/codes');
    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch QR codes');
    return apiSuccess(res.data.map(mapCode));
  }

  async scanAndPay(request: ScanQRPayRequest): Promise<ApiResponse<QRPayment>> {
    const res = await this.client.post<PaymentDTO>('/api/v1/qr/pay', {
      qr_data: request.qrData,
      amount: request.amount ? request.amount * 100 : 0,
      currency: request.currency,
    });

    if (!res.success || !res.data) return apiError('PAYMENT_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapPayment(res.data));
  }

  async getPaymentHistory(): Promise<ApiResponse<QRPayment[]>> {
    const res = await this.client.get<PaymentDTO[]>('/api/v1/qr/history');
    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch history');
    return apiSuccess(res.data.map(mapPayment));
  }

  async getMerchantPayments(merchantId: string): Promise<ApiResponse<QRPayment[]>> {
    const res = await this.client.get<PaymentDTO[]>(`/api/v1/qr/merchants/${merchantId}/payments`);
    if (!res.success || !res.data) return apiError('FETCH_FAILED', res.error?.message || 'Failed');
    return apiSuccess(res.data.map(mapPayment));
  }

  async getMerchantReport(merchantId: string, days: number): Promise<ApiResponse<BusinessReport>> {
    // The tz offset makes the server bucket days by the USER's calendar.
    const tz = new Date().getTimezoneOffset();
    interface BucketDTO { key?: string; label?: string; gross: number; fee: number; net: number; count: number }
    interface DayDTO { date: string; gross: number; fee: number; net: number; count: number }
    interface ReportDTO { days: number; totals: BucketDTO; daily: DayDTO[] | null; by_location: BucketDTO[] | null; by_collector: BucketDTO[] | null }
    const res = await this.client.get<ReportDTO>(`/api/v1/qr/merchants/${merchantId}/report?days=${days}&tz=${tz}`);
    if (!res.success || !res.data) return apiError('FETCH_FAILED', res.error?.message || 'Failed');
    const bucket = (b: BucketDTO): BusinessReportBucket => ({
      key: b.key || undefined,
      label: b.label || undefined,
      gross: b.gross / 100,
      fee: b.fee / 100,
      net: b.net / 100,
      count: b.count,
    });
    const day = (d: DayDTO): BusinessReportDay => ({
      date: d.date, gross: d.gross / 100, fee: d.fee / 100, net: d.net / 100, count: d.count,
    });
    return apiSuccess({
      days: res.data.days,
      totals: bucket(res.data.totals),
      daily: (res.data.daily ?? []).map(day),
      byLocation: (res.data.by_location ?? []).map(bucket),
      byCollector: (res.data.by_collector ?? []).map(bucket),
    });
  }

  // ── Team ───────────────────────────────────────────────────────────────────

  async getStaff(merchantId: string): Promise<ApiResponse<StaffMember[]>> {
    const res = await this.client.get<StaffDTO[]>(`/api/v1/qr/merchants/${merchantId}/staff`);
    if (!res.success || !res.data) return apiError('FETCH_FAILED', res.error?.message || 'Failed');
    return apiSuccess(res.data.map(mapStaff));
  }

  async addStaff(merchantId: string, cedula: string, role: 'cashier' | 'manager', locationId?: string): Promise<ApiResponse<StaffMember>> {
    const res = await this.client.post<StaffDTO>(`/api/v1/qr/merchants/${merchantId}/staff`, {
      cedula, role, location_id: locationId,
    });
    if (!res.success || !res.data) return apiError('ADD_STAFF_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapStaff(res.data));
  }

  async updateStaff(merchantId: string, staffId: string, role: 'cashier' | 'manager', locationId?: string): Promise<ApiResponse<StaffMember>> {
    const res = await this.client.put<StaffDTO>(`/api/v1/qr/merchants/${merchantId}/staff/${staffId}`, {
      role, location_id: locationId,
    });
    if (!res.success || !res.data) return apiError('UPDATE_STAFF_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapStaff(res.data));
  }

  async revokeStaff(merchantId: string, staffId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/qr/merchants/${merchantId}/staff/${staffId}`);
    if (!res.success) return apiError('REVOKE_STAFF_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  // ── Locations ──────────────────────────────────────────────────────────────

  async getLocations(merchantId: string): Promise<ApiResponse<MerchantLocation[]>> {
    const res = await this.client.get<LocationDTO[]>(`/api/v1/qr/merchants/${merchantId}/locations`);
    if (!res.success || !res.data) return apiError('FETCH_FAILED', res.error?.message || 'Failed');
    return apiSuccess(res.data.map(mapLocation));
  }

  async createLocation(merchantId: string, name: string, address: string): Promise<ApiResponse<MerchantLocation>> {
    const res = await this.client.post<LocationDTO>(`/api/v1/qr/merchants/${merchantId}/locations`, { name, address });
    if (!res.success || !res.data) return apiError('CREATE_LOCATION_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapLocation(res.data));
  }

  async updateLocation(
    merchantId: string,
    locationId: string,
    patch: { name?: string; address?: string; active?: boolean },
  ): Promise<ApiResponse<MerchantLocation>> {
    const res = await this.client.put<LocationDTO>(`/api/v1/qr/merchants/${merchantId}/locations/${locationId}`, {
      name: patch.name ?? '',
      address: patch.address ?? '',
      active: patch.active,
    });
    if (!res.success || !res.data) return apiError('UPDATE_LOCATION_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapLocation(res.data));
  }

  // ── Catalog ────────────────────────────────────────────────────────────────

  async getCatalog(merchantId: string): Promise<ApiResponse<CatalogItem[]>> {
    const res = await this.client.get<CatalogItemDTO[]>(`/api/v1/qr/merchants/${merchantId}/catalog`);
    if (!res.success || !res.data) return apiError('FETCH_FAILED', res.error?.message || 'Failed');
    return apiSuccess(res.data.map(mapCatalogItem));
  }

  async createCatalogItem(
    merchantId: string,
    item: { name: string; price: number; currency?: string },
  ): Promise<ApiResponse<CatalogItem>> {
    const res = await this.client.post<CatalogItemDTO>(`/api/v1/qr/merchants/${merchantId}/catalog`, {
      name: item.name,
      price_minor: Math.round(item.price * 100), // major -> minor
      currency: item.currency,
    });
    if (!res.success || !res.data) return apiError('CREATE_ITEM_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapCatalogItem(res.data));
  }

  async updateCatalogItem(
    merchantId: string,
    itemId: string,
    patch: { name?: string; price?: number; active?: boolean; sortOrder?: number },
  ): Promise<ApiResponse<CatalogItem>> {
    const res = await this.client.put<CatalogItemDTO>(`/api/v1/qr/merchants/${merchantId}/catalog/${itemId}`, {
      name: patch.name ?? '',
      price_minor: patch.price !== undefined ? Math.round(patch.price * 100) : 0,
      active: patch.active,
      sort_order: patch.sortOrder,
    });
    if (!res.success || !res.data) return apiError('UPDATE_ITEM_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapCatalogItem(res.data));
  }

  async deleteCatalogItem(merchantId: string, itemId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/qr/merchants/${merchantId}/catalog/${itemId}`);
    if (!res.success) return apiError('DELETE_ITEM_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async listPendingMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    const res = await this.client.get<MerchantDTO[]>('/api/v1/admin/merchants/pending');
    if (!res.success || !res.data) return apiError('FETCH_FAILED', res.error?.message || 'Failed');
    return apiSuccess(res.data.map(mapMerchant));
  }

  async approveMerchant(merchantId: string): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.post<MerchantDTO>(`/api/v1/admin/merchants/${merchantId}/approve`, {});
    if (!res.success || !res.data) return apiError('APPROVE_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapMerchant(res.data));
  }

  async rejectMerchant(merchantId: string, reason: string): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.post<MerchantDTO>(`/api/v1/admin/merchants/${merchantId}/reject`, { reason });
    if (!res.success || !res.data) return apiError('REJECT_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapMerchant(res.data));
  }

  async setMerchantCommission(merchantId: string, commissionBps: number): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.patch<MerchantDTO>(`/api/v1/admin/merchants/${merchantId}/commission`, { commission_bps: commissionBps });
    if (!res.success || !res.data) return apiError('SET_COMMISSION_FAILED', res.error?.message || 'Failed');
    return apiSuccess(mapMerchant(res.data));
  }
}
