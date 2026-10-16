import type { ApiResponse } from '../types';
import type { SavedService, Bill, Recharge } from '@/types';
import type { ConMarcaDeRepeticion } from './crypto.repository';

export interface PayBillRequest {
  providerId: string;
  providerName: string;
  clientId: string;
  amount: number;
  period: string;
  /**
   * La llave del pago. La misma llave con los mismos datos contesta con el
   * pago que ya estaba hecho en vez de cobrar otro (ver intentoPendiente).
   */
  idempotencyKey?: string;
}

export interface RechargeRequest {
  operatorId: string;
  phone: string;
  amount: number;
  /** La llave de la recarga, como en PayBillRequest. */
  idempotencyKey?: string;
}

export interface IServicesRepository {
  getSavedServices(): Promise<ApiResponse<SavedService[]>>;
  addSavedService(service: SavedService): Promise<ApiResponse<SavedService>>;
  getBillHistory(): Promise<ApiResponse<Bill[]>>;
  payBill(request: PayBillRequest): Promise<ApiResponse<ConMarcaDeRepeticion<Bill>>>;
  getRechargeHistory(): Promise<ApiResponse<Recharge[]>>;
  recharge(request: RechargeRequest): Promise<ApiResponse<ConMarcaDeRepeticion<Recharge>>>;
}
