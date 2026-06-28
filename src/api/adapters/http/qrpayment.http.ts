import type {
  IQRPaymentRepository,
  QRMerchant,
  QRPaymentCode,
  QRPayment,
  MerchantVerificationStatus,
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
  };
}

interface PaymentDTO {
  id: string;
  qr_code_id: string;
  payer_id: string;
  receiver_id: string;
  merchant_id: string;
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
  };
}

export class HttpQRPaymentRepository implements IQRPaymentRepository {
  constructor(private client: HttpClient) {}

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
