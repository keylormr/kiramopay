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

/** Una empresa a la que se le puede pagar un recibo: lo que el servidor acepta. */
export interface ServiceProviderInfo {
  /** El `provider_code` que se manda al pagar, tal cual lo dio el servidor. */
  code: string;
  name: string;
  /** electricity, water, telecom o internet. */
  category: string;
}

/** Un operador al que se le puede recargar. */
export interface ServiceOperatorInfo {
  code: string;
  name: string;
}

/**
 * Lo que la pantalla de Servicios ofrece. Sale del servidor: la pantalla no
 * lleva una lista propia (11 de las 15 empresas que llevaba no existian alla).
 */
export interface ServiceCatalog {
  /**
   * El cobro se puede entregar. Falso mientras no haya convenio con las
   * empresas ni con los operadores (produccion hoy): pagar responderia
   * SIN_CONVENIO, y la pantalla lo avisa antes del formulario.
   */
  agreementsActive: boolean;
  providers: ServiceProviderInfo[];
  operators: ServiceOperatorInfo[];
}

export interface IServicesRepository {
  getCatalog(): Promise<ApiResponse<ServiceCatalog>>;
  getSavedServices(): Promise<ApiResponse<SavedService[]>>;
  addSavedService(service: SavedService): Promise<ApiResponse<SavedService>>;
  getBillHistory(): Promise<ApiResponse<Bill[]>>;
  payBill(request: PayBillRequest): Promise<ApiResponse<ConMarcaDeRepeticion<Bill>>>;
  getRechargeHistory(): Promise<ApiResponse<Recharge[]>>;
  recharge(request: RechargeRequest): Promise<ApiResponse<ConMarcaDeRepeticion<Recharge>>>;
}
