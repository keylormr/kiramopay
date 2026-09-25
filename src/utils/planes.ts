/**
 * Planes personales y del comercio: lo que la aplicacion sabe de ellos sin
 * preguntarle al servidor, y los ayudantes que comparten sus pantallas.
 *
 * Decision del dueno (2026-09-13): Gratis $0, Plus $11.99 y Pro $34.99 al mes.
 * Topes: metas de ahorro activas 3 / 10 / sin tope; tarjetas virtuales activas
 * o congeladas 1 / 3 / 5; consultas al asistente por dia 2 / 15 / 50. Comercio:
 * 0.5% por cobro con QR, 0.25% los primeros 3 meses para comercios nuevos y
 * Analitica opcional a $9.99 al mes. Nada de esto se puede cobrar todavia.
 *
 * Estos valores son el RESPALDO. La fuente es /transparency/fees, que publica
 * los topes que el servidor aplica de verdad (son configurables): las pantallas
 * leen de ahi con useTarifas y caen aqui solo mientras carga o si falla.
 */
import type { ApiError } from '../api/types';
import type { PlanComercio, PlanPersonal, Tarifas } from '../api/repositories/plans.repository';
import { localeDe } from './periodos';

export const PLANES_PERSONALES: readonly PlanPersonal[] = ['free', 'plus', 'pro'];

export const TARIFAS_POR_DEFECTO: Tarifas = {
  comisionBps: 50,
  promo: { bps: 25, meses: 3 },
  planes: {
    free: { precio: 0, topes: { metas: 3, tarjetas: 1, asistente: 2 } },
    plus: { precio: 11.99, topes: { metas: 10, tarjetas: 3, asistente: 15 } },
    pro: { precio: 34.99, topes: { metas: null, tarjetas: 5, asistente: 50 } },
  },
  analitica: { precio: 9.99 },
};

/** Un backend anterior a los planes no manda el campo: se lee como free. */
export function normalizarPlan(valor: unknown): PlanPersonal {
  return valor === 'plus' || valor === 'pro' ? valor : 'free';
}

export function normalizarPlanComercio(valor: unknown): PlanComercio {
  return valor === 'analitica' ? 'analitica' : 'base';
}

/** El plan que sigue en la escalera; null en el mas alto. */
export function siguientePlan(plan: PlanPersonal): PlanPersonal | null {
  if (plan === 'free') return 'plus';
  if (plan === 'plus') return 'pro';
  return null;
}

/**
 * Puntos basicos a porcentaje con punto decimal, la misma convencion que los
 * montos (utils/money): 50 -> 0.5%, 25 -> 0.25%, 100 -> 1%.
 */
export function porcentajeDeBps(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** Reemplaza cada {clave} del texto traducido por su valor. */
export function rellenar(texto: string, datos: Record<string, string | number>): string {
  return Object.entries(datos).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), texto);
}

/**
 * Un dia YYYY-MM-DD (ya en la zona del cliente, como los manda el reporte) en
 * formato corto. Se arma como fecha LOCAL: new Date('2026-08-14') es medianoche
 * UTC y en Costa Rica se mostraria el 13.
 */
export function diaCorto(ymd: string | undefined, idioma: string): string {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat(localeDe(idioma), { day: 'numeric', month: 'short' }).format(d);
}

/** "13 de diciembre de 2026" en el idioma de la aplicacion; vacio si no es fecha. */
export function fechaLarga(iso: string | null | undefined, idioma: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(localeDe(idioma), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/** Lo que el servidor manda en un 409 SAVINGS_GOAL_LIMIT o CARD_LIMIT. */
export interface TopeAlcanzado {
  plan: PlanPersonal;
  /** 0 si el detalle no llego: se sabe que es el tope, no cuanto vale. */
  limite: number;
  actuales: number;
}

export function topeDelError(
  error: ApiError | undefined,
  codigo: 'SAVINGS_GOAL_LIMIT' | 'CARD_LIMIT',
): TopeAlcanzado | null {
  if (!error || error.code !== codigo) return null;
  const d = error.details ?? {};
  const limite = Number(d.limite);
  const actuales = Number(d.actuales);
  return {
    plan: normalizarPlan(d.plan),
    limite: Number.isInteger(limite) && limite >= 1 ? limite : 0,
    actuales: Number.isInteger(actuales) && actuales >= 0 ? actuales : 0,
  };
}

type Traducir = (clave: string) => string;

/**
 * "Tu plan Gratis permite 3 metas activas. Plus permitira hasta 10, muy
 * pronto." La segunda frase sale de las tarifas del plan que sigue, asi que no
 * promete un numero que el servidor no aplica.
 */
export function mensajeDeTope(
  t: Traducir,
  tipo: 'goals' | 'cards',
  plan: PlanPersonal,
  limite: number,
  tarifas: Tarifas,
): string {
  if (limite <= 0) return t('plans_limit_generic');
  const primera = rellenar(t(limite === 1 ? `plans_limit_${tipo}_one` : `plans_limit_${tipo}_many`), {
    plan: t(`plans_name_${plan}`),
    limite,
  });
  const siguiente = siguientePlan(plan);
  if (!siguiente) return `${primera} ${t('plans_limit_top')}`;
  const topeSiguiente = tarifas.planes[siguiente].topes[tipo === 'goals' ? 'metas' : 'tarjetas'];
  if (topeSiguiente === null) {
    return `${primera} ${rellenar(t('plans_limit_next_unlimited'), { plan: t(`plans_name_${siguiente}`) })}`;
  }
  // Un tope siguiente que no supera al actual no es una mejora: no se anuncia.
  if (topeSiguiente <= limite) return primera;
  return `${primera} ${rellenar(t('plans_limit_next'), { plan: t(`plans_name_${siguiente}`), limite: topeSiguiente })}`;
}
