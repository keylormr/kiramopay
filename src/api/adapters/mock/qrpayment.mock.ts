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
const DEFAULT_COMMISSION_BPS = 50; // 0.50%

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

function readMerchants(): QRMerchant[] {
  const state = getState();
  return Array.isArray(state?.qrMerchants) ? state.qrMerchants : [];
}

export class MockQRPaymentRepository implements IQRPaymentRepository {
  async registerMerchant(request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>> {
    const merchant: QRMerchant = {
      id: `merch-${Date.now()}`,
      name: request.name,
      description: request.description,
      category: request.category,
      qrCode: `MRC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      active: true,
      cedula: request.cedula,
      cedulaType: request.cedulaType,
      legalName: request.legalName,
      // The mock has no admin, so it auto-verifies to keep the demo flow working.
      verificationStatus: 'verified',
      commissionBps: DEFAULT_COMMISSION_BPS,
    };
    const merchants = readMerchants();
    merchants.push(merchant);
    saveField('qrMerchants', merchants);
    return apiSuccess(merchant);
  }

  async getMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    return apiSuccess(readMerchants());
  }

  async createQRCode(request: CreateQRCodeRequest): Promise<ApiResponse<QRPaymentCode>> {
    const id = `qr-${Date.now()}`;
    const code: QRPaymentCode = {
      id,
      type: request.type as QRPaymentCode['type'],
      amount: request.amount ?? 0,
      currency: request.currency,
      note: request.note,
      qrData: JSON.stringify({
        id,
        type: request.type,
        amount: request.amount,
        currency: request.currency,
        merchantId: request.merchantId,
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
    let qrInfo: { id?: string; amount?: number; type?: string; merchantId?: string };
    try {
      qrInfo = JSON.parse(request.qrData);
    } catch {
      return apiError('INVALID_QR', 'Codigo QR invalido');
    }

    const amount = request.amount ?? qrInfo.amount ?? 0;
    // Mirror the server: merchant codes carry a commission absorbed by the merchant.
    // The backend computes the fee in centimos (floored), so compute it there too
    // and express it back in colones — the unit the mock stores amounts in.
    const isMerchant = qrInfo.type === 'merchant_fixed' || qrInfo.type === 'merchant_dynamic';
    const fee = isMerchant ? Math.floor((amount * 100 * DEFAULT_COMMISSION_BPS) / 10000) / 100 : 0;

    const payment: QRPayment = {
      id: `qrpay-${Date.now()}`,
      qrCodeId: qrInfo.id ?? 'unknown',
      payerId: 'current-user',
      receiverId: 'merchant',
      merchantId: qrInfo.merchantId,
      amount,
      fee,
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

  // ── Admin ──────────────────────────────────────────────────────────────────

  async listPendingMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    return apiSuccess(readMerchants().filter((m) => m.verificationStatus === 'pending'));
  }

  async approveMerchant(merchantId: string): Promise<ApiResponse<QRMerchant>> {
    return this.setStatus(merchantId, 'verified', '');
  }

  async rejectMerchant(merchantId: string, reason: string): Promise<ApiResponse<QRMerchant>> {
    return this.setStatus(merchantId, 'rejected', reason);
  }

  private setStatus(
    merchantId: string,
    status: QRMerchant['verificationStatus'],
    reason: string,
  ): ApiResponse<QRMerchant> {
    const merchants = readMerchants();
    const idx = merchants.findIndex((m) => m.id === merchantId);
    if (idx === -1) return apiError('NOT_FOUND', 'Merchant not found');
    merchants[idx] = { ...merchants[idx], verificationStatus: status, rejectionReason: reason || undefined };
    saveField('qrMerchants', merchants);
    return apiSuccess(merchants[idx]);
  }
}
