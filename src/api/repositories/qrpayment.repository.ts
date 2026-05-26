import type { ApiResponse } from '../types';

export interface QRMerchant {
  id: string;
  name: string;
  description: string;
  category: string;
  qrCode: string;
  active: boolean;
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
}

export interface QRPayment {
  id: string;
  qrCodeId: string;
  payerId: string;
  receiverId: string;
  merchantId?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  note?: string;
  createdAt: string;
}

export interface RegisterMerchantRequest {
  name: string;
  description: string;
  category: string;
}

export interface CreateQRCodeRequest {
  type: string;
  amount?: number;
  currency: string;
  note?: string;
  singleUse: boolean;
}

export interface ScanQRPayRequest {
  qrData: string;
  amount?: number;
  currency: string;
}

export interface IQRPaymentRepository {
  registerMerchant(request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>>;
  getMerchant(): Promise<ApiResponse<QRMerchant>>;
  createQRCode(request: CreateQRCodeRequest): Promise<ApiResponse<QRPaymentCode>>;
  getQRCodes(): Promise<ApiResponse<QRPaymentCode[]>>;
  scanAndPay(request: ScanQRPayRequest): Promise<ApiResponse<QRPayment>>;
  getPaymentHistory(): Promise<ApiResponse<QRPayment[]>>;
}
