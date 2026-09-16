import type { SummaryGroup, TransactionSummary } from '@/api/repositories/transaction.repository';
import type { Transaction } from '@/types';
import {
  claveDeTramo,
  diaSemana,
  diasEntre,
  granularidadDe,
  parteTranscurrida,
  tramosDe,
  type FechaCivil,
  type Granularidad,
  type Rango,
  type Tramo,
} from '@/utils/periodos';
import { CATEGORIAS_CONOCIDAS } from '@/components/graficos/tokens';

/**
 * Todas las cifras de la pantalla de analisis salen de aqui, sobre el resumen
 * del periodo. Una sola moneda por pantalla: sumar colones con dolares daria un
 * numero que no existe.
 *
 * Los grupos llegan en centimos y se suman en centimos; cada cifra de salida ya
 * esta en unidades mayores (colones, dolares), lista para mostrar.
 */

export interface TramoConMontos extends Tramo {
  ingresos: number;
  gastos: number;
}

export interface CategoriaGasto {
  categoria: string;
  monto: number;
  porcentaje: number;
}

export interface Analisis {
  moneda: string;
  /** Las monedas con movimientos en el periodo, la mas usada primero. */
  monedas: string[];
  /** Movimientos del periodo en otras monedas: quedan fuera de los totales. */
  otrasMonedas: number;
  ingresos: number;
  gastos: number;
  neto: number;
  cantidadIngresos: number;
  cantidadGastos: number;
  granularidad: Granularidad;
  tramos: TramoConMontos[];
  categorias: CategoriaGasto[];
  /** Gasto dividido entre los dias que ya pasaron del periodo. */
  promedioDiario: number;
  /** Dia de la semana (0 = domingo) con mas gasto, si hubo gastos. */
  diaPico: { dia: number; monto: number } | null;
  principales: Transaction[];
  vacio: boolean;
}

const aUnidades = (centimos: number) => centimos / 100;

/** Las monedas del periodo, de la mas usada a la menos usada. */
export function monedasDe(grupos: SummaryGroup[]): string[] {
  const cuentas = new Map<string, number>();
  for (const g of grupos) cuentas.set(g.ccy, (cuentas.get(g.ccy) ?? 0) + g.count);
  return [...cuentas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => m);
}

/**
 * La moneda de la pantalla: la que la persona eligio, si el periodo la tiene;
 * si no, la base del usuario; y si el periodo no tiene ni un movimiento en
 * ella, la mas usada, para no pintar ceros habiendo datos.
 */
export function elegirMoneda(grupos: SummaryGroup[], monedaBase: string, elegida?: string | null): string {
  const monedas = monedasDe(grupos);
  if (elegida && monedas.includes(elegida)) return elegida;
  if (monedas.length === 0 || monedas.includes(monedaBase)) return monedaBase;
  return monedas[0];
}

/** Ingresos y gastos de una moneda, en unidades mayores. */
export function totalesEn(grupos: SummaryGroup[], moneda: string) {
  let ingresos = 0;
  let gastos = 0;
  for (const g of grupos) {
    if (g.ccy !== moneda) continue;
    if (g.direction === 'in') ingresos += g.amountMinor;
    else gastos += g.amountMinor;
  }
  return { ingresos: aUnidades(ingresos), gastos: aUnidades(gastos) };
}

export function analizar(
  resumen: TransactionSummary,
  rango: Rango,
  hoy: FechaCivil,
  monedaBase: string,
  monedaElegida?: string | null,
): Analisis {
  const monedas = monedasDe(resumen.groups);
  const moneda = elegirMoneda(resumen.groups, monedaBase, monedaElegida);
  const granularidad = granularidadDe(rango);
  const tramosCentimos = tramosDe(rango, granularidad).map((t) => ({ ...t, ingresos: 0, gastos: 0 }));
  const porClave = new Map(tramosCentimos.map((t) => [t.clave, t]));
  const porCategoria = new Map<string, number>();
  const porDia = [0, 0, 0, 0, 0, 0, 0];

  let ingresos = 0;
  let gastos = 0;
  let cantidadIngresos = 0;
  let cantidadGastos = 0;
  let otrasMonedas = 0;
  let huboGastos = false;

  for (const g of resumen.groups) {
    if (g.date < rango.desde || g.date >= rango.hasta) continue;
    if (g.ccy !== moneda) {
      otrasMonedas += g.count;
      continue;
    }
    const tramo = porClave.get(claveDeTramo(g.date, rango, granularidad));
    if (g.direction === 'in') {
      ingresos += g.amountMinor;
      cantidadIngresos += g.count;
      if (tramo) tramo.ingresos += g.amountMinor;
    } else {
      gastos += g.amountMinor;
      cantidadGastos += g.count;
      huboGastos = true;
      if (tramo) tramo.gastos += g.amountMinor;
      // Una categoria que la app no conoce cae en 'other': nunca un color sin nombre.
      const categoria = CATEGORIAS_CONOCIDAS.includes(g.category) ? g.category : 'other';
      porCategoria.set(categoria, (porCategoria.get(categoria) ?? 0) + g.amountMinor);
      porDia[diaSemana(g.date)] += g.amountMinor;
    }
  }

  const categorias = [...porCategoria.entries()]
    .map(([categoria, centimos]) => ({
      categoria,
      monto: aUnidades(centimos),
      porcentaje: gastos > 0 ? (centimos / gastos) * 100 : 0,
    }))
    .sort((a, b) => b.monto - a.monto);

  const transcurrido = parteTranscurrida(rango, hoy);
  const dias = transcurrido ? diasEntre(transcurrido.desde, transcurrido.hasta) : 0;

  let diaPico: Analisis['diaPico'] = null;
  if (huboGastos) {
    const max = Math.max(...porDia);
    diaPico = { dia: porDia.indexOf(max), monto: aUnidades(max) };
  }

  const principales = resumen.top
    .filter((tx) => (tx.ccy || 'CRC') === moneda)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return {
    moneda,
    monedas,
    otrasMonedas,
    ingresos: aUnidades(ingresos),
    gastos: aUnidades(gastos),
    neto: aUnidades(ingresos - gastos),
    cantidadIngresos,
    cantidadGastos,
    granularidad,
    tramos: tramosCentimos.map((t) => ({ ...t, ingresos: aUnidades(t.ingresos), gastos: aUnidades(t.gastos) })),
    categorias,
    promedioDiario: dias > 0 ? aUnidades(gastos) / dias : 0,
    diaPico,
    principales,
    vacio: cantidadIngresos + cantidadGastos === 0,
  };
}

/** Variacion porcentual contra el periodo anterior, o null sin base. */
export function variacion(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}
