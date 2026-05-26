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

const STORAGE_KEY = 'kiramopay_app_state';

function getState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveField(field: string, value: unknown) {
  const state = getState() || {};
  state[field] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export class MockQRPaymentRepository implements IQRPaymentRepository {
  async registerMerchant(request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>> {
    const merchant: QRMerchant = {
      id: `merch-${Date.now()}`,
      name: request.name,
      description: request.description,
      category: request.category,
      qrCode: `MERCH-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      active: true,
    };
    saveField('qrMerchant', merchant);
    return apiSuccess(merchant);
  }

  async getMerchant(): Promise<ApiResponse<QRMerchant>> {
    const state = getState();
    if (!state?.qrMerchant) return apiError('NOT_FOUND', 'No eres un comercio registrado');
    return apiSuccess(state.qrMerchant);
  }

  async createQRCode(request: CreateQRCodeRequest): Promise<ApiResponse<QRPaymentCode>> {
    const code: QRPaymentCode = {
      id: `qr-${Date.now()}`,
      type: request.type as QRPaymentCode['type'],
      amount: request.amount ?? 0,
      currency: request.currency,
      note: request.note,
      qrData: JSON.stringify({
        id: `qr-${Date.now()}`,
        type: request.type,
        amount: request.amount,
        currency: request.currency,
      }),
      singleUse: request.singleUse,
      used: false,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    const state = getState();
    const codes: QRPaymentCode[] = state?.qrCodes ?? [];
    codes.unshift(code);
    saveField('qrCodes', codes);
    return apiSuccess(code);
  }

  async getQRCodes(): Promise<ApiResponse<QRPaymentCode[]>> {
    const state = getState();
    return apiSuccess(state?.qrCodes ?? []);
  }

  async scanAndPay(request: ScanQRPayRequest): Promise<ApiResponse<QRPayment>> {
    let qrInfo: { id?: string; amount?: number; type?: string };
    try {
      qrInfo = JSON.parse(request.qrData);
    } catch {
      return apiError('INVALID_QR', 'Codigo QR invalido');
    }

    const payment: QRPayment = {
      id: `qrpay-${Date.now()}`,
      qrCodeId: qrInfo.id ?? 'unknown',
      payerId: 'current-user',
      receiverId: 'merchant',
      amount: request.amount ?? qrInfo.amount ?? 0,
      currency: request.currency,
      status: 'completed',
      createdAt: new Date().toISOString(),
    };
    const state = getState();
    const payments: QRPayment[] = state?.qrPayments ?? [];
    payments.unshift(payment);
    saveField('qrPayments', payments);
    return apiSuccess(payment);
  }

  async getPaymentHistory(): Promise<ApiResponse<QRPayment[]>> {
    const state = getState();
    return apiSuccess(state?.qrPayments ?? []);
  }
}
