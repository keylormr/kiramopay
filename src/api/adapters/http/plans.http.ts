import type {
  IPlansRepository,
  PaidPlanId,
  PlanInterest,
} from '../../repositories/plans.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

interface PlanInterestDTO {
  plan?: string;
  registered_at?: string;
}

const PLANES_DE_PAGO: readonly PaidPlanId[] = ['negocio', 'cima'];

// El stub de E2E contesta `data: []` a cualquier ruta, asi que un endpoint de
// un solo objeto puede devolver un arreglo: solo mapea un objeto de verdad.
function esInteresDTO(v: unknown): v is PlanInterestDTO {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class HttpPlansRepository implements IPlansRepository {
  constructor(private client: HttpClient) {}

  async registrarInteres(plan: PaidPlanId): Promise<ApiResponse<PlanInterest>> {
    const res = await this.client.post<unknown>('/api/v1/plans/interest', { plan });
    if (!res.success || !esInteresDTO(res.data)) {
      // El codigo del servidor se conserva tal cual: sin el, PLAN_INVALID y una
      // caida del servicio quedarian indistinguibles para quien llame.
      return apiError(
        res.error?.code || 'INTEREST_FAILED',
        res.error?.message || 'plan interest failed',
      );
    }
    const devuelto = res.data.plan as PaidPlanId;
    return apiSuccess({
      plan: PLANES_DE_PAGO.includes(devuelto) ? devuelto : plan,
      registeredAt: String(res.data.registered_at ?? ''),
    });
  }
}
