import type {
  IPlansRepository,
  PlanDeInteres,
  PlanInterest,
  PlanPersonal,
  Tarifas,
  TopesDePlan,
} from '../../repositories/plans.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { TARIFAS_POR_DEFECTO } from '../../../utils/planes';
import { HttpClient } from './client';

const PLANES_DE_INTERES: readonly PlanDeInteres[] = ['plus', 'pro', 'analitica'];

// El stub de E2E contesta `data: []` a cualquier ruta, asi que un endpoint de
// un solo objeto puede devolver un arreglo: solo mapea un objeto de verdad.
function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numero(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// El servidor publica "sin tope" como null.
function tope(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Lee /transparency/fees. Cada dato que falta cae al valor decidido por el
 * dueno, salvo dos: una promocion o una analitica que el servidor NO publica
 * quedan en null, porque mostrarlas seria anunciar algo que ese servidor no
 * aplica.
 */
export function leerTarifas(d: Record<string, unknown>): Tarifas {
  const base = TARIFAS_POR_DEFECTO;
  const comision = esObjeto(d.merchant_commission) ? numero(d.merchant_commission.bps) : undefined;
  const promo = esObjeto(d.entry_promotion)
    ? {
        bps: numero(d.entry_promotion.bps) ?? base.promo!.bps,
        meses: numero(d.entry_promotion.months) ?? base.promo!.meses,
      }
    : null;

  const planes: Tarifas['planes'] = {
    free: { ...base.planes.free, topes: { ...base.planes.free.topes } },
    plus: { ...base.planes.plus, topes: { ...base.planes.plus.topes } },
    pro: { ...base.planes.pro, topes: { ...base.planes.pro.topes } },
  };
  const anunciados = esObjeto(d.plans) ? d.plans.announced : undefined;
  if (Array.isArray(anunciados)) {
    for (const fila of anunciados) {
      if (!esObjeto(fila)) continue;
      const codigo = fila.code;
      if (codigo !== 'free' && codigo !== 'plus' && codigo !== 'pro') continue;
      const plan = codigo as PlanPersonal;
      const limites = esObjeto(fila.limits) ? fila.limits : {};
      const topes: TopesDePlan = {
        metas: 'savings_goals_active' in limites ? tope(limites.savings_goals_active) : base.planes[plan].topes.metas,
        tarjetas: 'virtual_cards_active' in limites ? tope(limites.virtual_cards_active) : base.planes[plan].topes.tarjetas,
      };
      // Sin la clave, el servidor no tiene asistente: no se ofrece.
      if ('assistant_daily_questions' in limites) topes.asistente = tope(limites.assistant_daily_questions);
      planes[plan] = { precio: numero(fila.price) ?? base.planes[plan].precio, topes };
    }
  }

  const analitica = esObjeto(d.merchant_analytics)
    ? { precio: numero(d.merchant_analytics.price) ?? base.analitica!.precio }
    : null;

  return { comisionBps: comision ?? base.comisionBps, promo, planes, analitica };
}

export class HttpPlansRepository implements IPlansRepository {
  constructor(private client: HttpClient) {}

  async registrarInteres(plan: PlanDeInteres): Promise<ApiResponse<PlanInterest>> {
    const res = await this.client.post<unknown>('/api/v1/plans/interest', { plan });
    if (!res.success || !esObjeto(res.data)) {
      // El codigo del servidor se conserva tal cual: sin el, PLAN_INVALID y una
      // caida del servicio quedarian indistinguibles para quien llame.
      return apiError(
        res.error?.code || 'INTEREST_FAILED',
        res.error?.message || 'plan interest failed',
      );
    }
    const devuelto = res.data.plan as PlanDeInteres;
    return apiSuccess({
      plan: PLANES_DE_INTERES.includes(devuelto) ? devuelto : plan,
      registeredAt: String(res.data.registered_at ?? ''),
    });
  }

  async getTarifas(): Promise<ApiResponse<Tarifas>> {
    // Endpoint publico: va sin sesion.
    const res = await this.client.get<unknown>('/api/v1/transparency/fees', false);
    if (!res.success || !esObjeto(res.data)) {
      return apiError(res.error?.code || 'FEES_FAILED', res.error?.message || 'fees unavailable');
    }
    return apiSuccess(leerTarifas(res.data));
  }
}
