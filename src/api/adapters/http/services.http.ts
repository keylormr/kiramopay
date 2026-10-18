import type {
  IServicesRepository,
  PayBillRequest,
  RechargeRequest,
} from '../../repositories/services.repository';
import type { ConMarcaDeRepeticion } from '../../repositories/crypto.repository';
import type { ApiResponse } from '../../types';
import type { SavedService, Bill, Recharge } from '@/types';
import { apiSuccess } from '../../types';
import { falla } from './falla';
import { HttpClient } from './client';

/**
 * La marca de la repeticion: el servidor contesto con un pago que YA estaba
 * hecho bajo esa llave, y esta llamada no cobro nada. Sin la marca, el campo ni
 * aparece, y lo que se guarda en el historial no la lleva.
 */
function conMarca<T>(dato: T, repetido?: boolean): ConMarcaDeRepeticion<T> {
  return repetido === true ? { ...dato, repetida: true } : (dato as ConMarcaDeRepeticion<T>);
}

export class HttpServicesRepository implements IServicesRepository {
  constructor(private client: HttpClient) {}

  async getSavedServices(): Promise<ApiResponse<SavedService[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        provider_code: string;
        provider_name: string;
        client_id: string;
        nickname: string;
        auto_pay_enabled: boolean;
      }>
    >('/api/v1/services/saved');

    if (!res.success) {
      return falla(res, 'FETCH_FAILED');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    const services: SavedService[] = res.data.map((s) => ({
      id: s.id,
      providerId: s.provider_code,
      clientId: s.client_id,
      nickname: s.nickname,
      autoPay: s.auto_pay_enabled,
    }));

    return apiSuccess(services);
  }

  async addSavedService(service: SavedService): Promise<ApiResponse<SavedService>> {
    const res = await this.client.post('/api/v1/services/saved', {
      provider_code: service.providerId,
      client_id: service.clientId,
      nickname: service.nickname || '',
    });

    if (!res.success) {
      return falla(res, 'ADD_FAILED');
    }

    return apiSuccess(service);
  }

  async getBillHistory(): Promise<ApiResponse<Bill[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        type?: string;
        provider_code: string;
        provider_name: string;
        client_id: string;
        amount: number;
        status: string;
        created_at: string;
      }>
    >('/api/v1/services/history');

    if (!res.success) {
      return falla(res, 'FETCH_FAILED');
    }
    if (!Array.isArray(res.data)) return apiSuccess([]);

    const bills: Bill[] = res.data
      .filter((h) => h.type === 'bill' || !h.type)
      .map((h) => ({
        id: h.id,
        providerId: h.provider_code,
        providerName: h.provider_name,
        clientId: h.client_id,
        amount: h.amount / 100,
        dueDate: h.created_at,
        period: '',
        status: h.status as 'pending' | 'paid' | 'overdue',
      }));

    return apiSuccess(bills);
  }

  async payBill(request: PayBillRequest): Promise<ApiResponse<ConMarcaDeRepeticion<Bill>>> {
    const res = await this.client.post<{
      transaction_id: string;
      receipt_number: string;
      provider_name: string;
      amount: number;
      status: string;
      replayed?: boolean;
    }>('/api/v1/services/pay-bill', {
      provider_code: request.providerId,
      client_id: request.clientId,
      amount: Math.round(request.amount * 100),
      period: request.period,
      idempotency_key: request.idempotencyKey || undefined,
    });

    if (!res.success || !res.data) {
      // Preserve the backend error code (MFA_REQUIRED, insufficient funds, daily
      // limit, fraud block, …) so the UI can react; only fall back when absent.
      return falla(res, 'PAYMENT_FAILED');
    }

    const bill: Bill = {
      id: res.data.transaction_id,
      providerId: request.providerId,
      providerName: res.data.provider_name,
      clientId: request.clientId,
      amount: request.amount,
      dueDate: new Date().toISOString(),
      period: request.period,
      status: 'paid',
    };

    return apiSuccess(conMarca(bill, res.data.replayed));
  }

  async getRechargeHistory(): Promise<ApiResponse<Recharge[]>> {
    const res = await this.client.get<
      Array<{
        id: string;
        type: string;
        provider_code: string;
        client_id: string;
        amount: number;
        status: string;
        created_at: string;
      }>
    >('/api/v1/services/history');

    if (!res.success || !res.data) {
      return falla(res, 'FETCH_FAILED');
    }

    const recharges: Recharge[] = res.data
      .filter((h) => h.type === 'recharge')
      .map((h) => ({
        id: h.id,
        operatorId: h.provider_code,
        phone: h.client_id,
        amount: h.amount / 100,
        date: h.created_at,
        // La pantalla escribe esta en el idioma de la app; `date` tal cual se
        // pintaba crudo ("2026-09-04T15:30:00Z").
        dateISO: h.created_at,
        status: h.status as 'completed' | 'pending' | 'failed',
      }));

    return apiSuccess(recharges);
  }

  async recharge(request: RechargeRequest): Promise<ApiResponse<ConMarcaDeRepeticion<Recharge>>> {
    const res = await this.client.post<{
      transaction_id: string;
      operator: string;
      phone: string;
      amount: number;
      status: string;
      replayed?: boolean;
    }>('/api/v1/services/recharge', {
      operator: request.operatorId,
      phone: request.phone,
      amount: Math.round(request.amount * 100),
      idempotency_key: request.idempotencyKey || undefined,
    });

    if (!res.success || !res.data) {
      // Preserve the backend error code (MFA_REQUIRED, insufficient funds, daily
      // limit, fraud block, …) so the UI can react; only fall back when absent.
      return falla(res, 'RECHARGE_FAILED');
    }

    const ahora = new Date().toISOString();
    const recharge: Recharge = {
      id: res.data.transaction_id,
      operatorId: request.operatorId,
      phone: request.phone,
      amount: request.amount,
      date: ahora,
      dateISO: ahora,
      status: 'completed',
    };

    return apiSuccess(conMarca(recharge, res.data.replayed));
  }
}
