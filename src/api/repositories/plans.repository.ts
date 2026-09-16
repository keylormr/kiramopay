import type { ApiResponse } from '../types';

/** Plan personal. Todo registro nace en free; hoy solo un administrador lo cambia. */
export type PlanPersonal = 'free' | 'plus' | 'pro';

/** Plan de un comercio: analitica suma la comparacion del reporte y el CSV. */
export type PlanComercio = 'base' | 'analitica';

/**
 * Los planes en los que se puede anotar interes. El gratuito NO esta: no hay
 * nada que contratar. Negocio y Cima se retiraron y el servidor los rechaza con
 * PLAN_INVALID.
 */
export type PlanDeInteres = 'plus' | 'pro' | 'analitica';

export interface PlanInterest {
  plan: PlanDeInteres;
  /** ISO-8601. Fecha en que quedo anotado; repetirlo solo la refresca. */
  registeredAt: string;
}

/**
 * Topes de un plan personal. null es "sin tope". `asistente` falta cuando el
 * servidor no tiene asistente configurado: en ese caso no se publica y la
 * pantalla no lo ofrece.
 */
export interface TopesDePlan {
  metas: number | null;
  tarjetas: number | null;
  asistente?: number | null;
}

/**
 * Lo que publica /transparency/fees y las pantallas de planes necesitan. Los
 * precios van en dolares al mes y todavia no se pueden cobrar.
 */
export interface Tarifas {
  /** Comision estandar por cobro con QR, en puntos basicos (50 = 0.5%). */
  comisionBps: number;
  /** Promocion de entrada para comercios nuevos; null si el servidor no la publica. */
  promo: { bps: number; meses: number } | null;
  planes: Record<PlanPersonal, { precio: number; topes: TopesDePlan }>;
  /** Analitica del comercio; null si el servidor no la publica. */
  analitica: { precio: number } | null;
}

/**
 * Planes: registrar interes y leer las tarifas publicas.
 *
 * Hoy la aplicacion no puede cobrar: registrar interes NO otorga el plan, no
 * crea una suscripcion y no mueve dinero. Solo deja anotado quien lo quiere y
 * desde cuando. Como escribe en la base y va autenticado, siempre habla con el
 * backend real (igual que auth, kyc y admin): no tiene adaptador mock.
 */
export interface IPlansRepository {
  registrarInteres(plan: PlanDeInteres): Promise<ApiResponse<PlanInterest>>;
  /** Tarifas y topes vigentes, del endpoint publico de transparencia. */
  getTarifas(): Promise<ApiResponse<Tarifas>>;
}
