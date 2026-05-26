import type { IServicesRepository, PayBillRequest, RechargeRequest } from '../../repositories/services.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess } from '../../types';
import type { SavedService, Bill, Recharge } from '@/types';
import { initialSavedServices, initialRechargeHistory } from './mock-data';

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

export class MockServicesRepository implements IServicesRepository {
  async getSavedServices(): Promise<ApiResponse<SavedService[]>> {
    const state = getState();
    return apiSuccess(state?.savedServices ?? initialSavedServices);
  }

  async addSavedService(service: SavedService): Promise<ApiResponse<SavedService>> {
    const state = getState();
    const services: SavedService[] = state?.savedServices ?? [...initialSavedServices];
    services.push(service);
    saveField('savedServices', services);
    return apiSuccess(service);
  }

  async getBillHistory(): Promise<ApiResponse<Bill[]>> {
    const state = getState();
    return apiSuccess(state?.billHistory ?? []);
  }

  async payBill(request: PayBillRequest): Promise<ApiResponse<Bill>> {
    const bill: Bill = {
      id: `bill-${Date.now()}`,
      providerId: request.providerId,
      providerName: request.providerName,
      clientId: request.clientId,
      amount: request.amount,
      dueDate: new Date().toISOString(),
      period: request.period,
      status: 'paid',
    };
    const state = getState();
    const history: Bill[] = state?.billHistory ?? [];
    history.unshift(bill);
    saveField('billHistory', history);
    return apiSuccess(bill);
  }

  async getRechargeHistory(): Promise<ApiResponse<Recharge[]>> {
    const state = getState();
    return apiSuccess(state?.rechargeHistory ?? initialRechargeHistory);
  }

  async recharge(request: RechargeRequest): Promise<ApiResponse<Recharge>> {
    const recharge: Recharge = {
      id: `recharge-${Date.now()}`,
      operatorId: request.operatorId,
      phone: request.phone,
      amount: request.amount,
      date: 'Ahora',
      status: 'completed',
    };
    const state = getState();
    const history: Recharge[] = state?.rechargeHistory ?? [...initialRechargeHistory];
    history.unshift(recharge);
    saveField('rechargeHistory', history);
    return apiSuccess(recharge);
  }
}
