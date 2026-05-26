import type {
  IQRPaymentRepository,
  QRMerchant,
  QRPaymentCode,
  QRPayment,
  RegisterMerchantRequest,
  CreateQRCodeRequest,
  ScanQRPayRequest,
} from '../../repositories/qrpayment.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpQRPaymentRepository implements IQRPaymentRepository {
  constructor(private client: HttpClient) {}

  async registerMerchant(request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.post<{
      id: string; name: string; description: string; category: string;
      qr_code: string; active: boolean;
    }>('/api/v1/qr/merchant', request);

    if (!res.success || !res.data) return apiError('REGISTER_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      id: res.data.id,
      name: res.data.name,
      description: res.data.description,
      category: res.data.category,
      qrCode: res.data.qr_code,
      active: res.data.active,
    });
  }

  async getMerchant(): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.get<{
      id: string; name: string; description: string; category: string;
      qr_code: string; active: boolean;
    }>('/api/v1/qr/merchant');

    if (!res.success || !res.data) return apiError('NOT_FOUND', 'Merchant not found');

    return apiSuccess({
      id: res.data.id,
      name: res.data.name,
      description: res.data.description,
      category: res.data.category,
      qrCode: res.data.qr_code,
      active: res.data.active,
    });
  }

  async createQRCode(request: CreateQRCodeRequest): Promise<ApiResponse<QRPaymentCode>> {
    const res = await this.client.post<{
      id: string; type: string; amount: number; currency: string;
      note: string; qr_data: string; single_use: boolean; used: boolean; expires_at: string;
    }>('/api/v1/qr/codes', {
      type: request.type,
      amount: request.amount ? request.amount * 100 : 0,
      currency: request.currency,
      note: request.note,
      single_use: request.singleUse,
    });

    if (!res.success || !res.data) return apiError('CREATE_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      id: res.data.id,
      type: res.data.type as QRPaymentCode['type'],
      amount: res.data.amount / 100,
      currency: res.data.currency,
      note: res.data.note || undefined,
      qrData: res.data.qr_data,
      singleUse: res.data.single_use,
      used: res.data.used,
      expiresAt: res.data.expires_at || undefined,
    });
  }

  async getQRCodes(): Promise<ApiResponse<QRPaymentCode[]>> {
    const res = await this.client.get<Array<{
      id: string; type: string; amount: number; currency: string;
      note: string; qr_data: string; single_use: boolean; used: boolean; expires_at: string;
    }>>('/api/v1/qr/codes');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch QR codes');

    return apiSuccess(res.data.map((q) => ({
      id: q.id,
      type: q.type as QRPaymentCode['type'],
      amount: q.amount / 100,
      currency: q.currency,
      note: q.note || undefined,
      qrData: q.qr_data,
      singleUse: q.single_use,
      used: q.used,
      expiresAt: q.expires_at || undefined,
    })));
  }

  async scanAndPay(request: ScanQRPayRequest): Promise<ApiResponse<QRPayment>> {
    const res = await this.client.post<{
      id: string; qr_code_id: string; payer_id: string; receiver_id: string;
      merchant_id: string; amount: number; currency: string; status: string;
      note: string; created_at: string;
    }>('/api/v1/qr/pay', {
      qr_data: request.qrData,
      amount: request.amount ? request.amount * 100 : 0,
      currency: request.currency,
    });

    if (!res.success || !res.data) return apiError('PAYMENT_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      id: res.data.id,
      qrCodeId: res.data.qr_code_id,
      payerId: res.data.payer_id,
      receiverId: res.data.receiver_id,
      merchantId: res.data.merchant_id || undefined,
      amount: res.data.amount / 100,
      currency: res.data.currency,
      status: res.data.status as QRPayment['status'],
      note: res.data.note || undefined,
      createdAt: res.data.created_at,
    });
  }

  async getPaymentHistory(): Promise<ApiResponse<QRPayment[]>> {
    const res = await this.client.get<Array<{
      id: string; qr_code_id: string; payer_id: string; receiver_id: string;
      merchant_id: string; amount: number; currency: string; status: string;
      note: string; created_at: string;
    }>>('/api/v1/qr/history');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch history');

    return apiSuccess(res.data.map((p) => ({
      id: p.id,
      qrCodeId: p.qr_code_id,
      payerId: p.payer_id,
      receiverId: p.receiver_id,
      merchantId: p.merchant_id || undefined,
      amount: p.amount / 100,
      currency: p.currency,
      status: p.status as QRPayment['status'],
      note: p.note || undefined,
      createdAt: p.created_at,
    })));
  }
}
