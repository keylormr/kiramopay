import type { ApiResponse } from '../types';
import type { SavedService, Bill, Recharge } from '@/types';

export interface PayBillRequest {
  providerId: string;
  providerName: string;
  clientId: string;
  amount: number;
  period: string;
}

export interface RechargeRequest {
  operatorId: string;
  phone: string;
  amount: number;
}

export interface IServicesRepository {
  getSavedServices(): Promise<ApiResponse<SavedService[]>>;
  addSavedService(service: SavedService): Promise<ApiResponse<SavedService>>;
  getBillHistory(): Promise<ApiResponse<Bill[]>>;
  payBill(request: PayBillRequest): Promise<ApiResponse<Bill>>;
  getRechargeHistory(): Promise<ApiResponse<Recharge[]>>;
  recharge(request: RechargeRequest): Promise<ApiResponse<Recharge>>;
}
