import type { ApiResponse } from '../types';

/**
 * Los dos planes que se pueden contratar. El gratuito NO esta aqui a
 * proposito: el servidor responde PLAN_INVALID a cualquier otro valor porque
 * en el plan sin cuota no hay nada que contratar.
 */
export type PaidPlanId = 'negocio' | 'cima';

export interface PlanInterest {
  plan: PaidPlanId;
  /** ISO-8601. Fecha en que quedo anotado; repetirlo solo la refresca. */
  registeredAt: string;
}

/**
 * Registro de interes en un plan de pago.
 *
 * Hoy la aplicacion no puede cobrar: esto NO otorga el plan, no crea una
 * suscripcion y no mueve dinero. Solo deja anotado quien lo quiere y desde
 * cuando. Como escribe en la base y va autenticado, siempre habla con el
 * backend real (igual que auth, kyc y admin): no tiene adaptador mock.
 */
export interface IPlansRepository {
  registrarInteres(plan: PaidPlanId): Promise<ApiResponse<PlanInterest>>;
}
