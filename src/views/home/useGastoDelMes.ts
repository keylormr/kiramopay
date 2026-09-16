import { useEffect, useMemo, useRef, useState } from 'react';
import { getApiLayer } from '@/api';
import type { TransactionSummary } from '@/api/repositories/transaction.repository';
import type { Transaction } from '@/types';
import { analizar, totalesEn, variacion } from '@/views/analytics/calculosAnalitica';
import { resumirMovimientos } from '@/utils/resumenMovimientos';
import { hoyCR, periodoAnterior, rangoPreset, type FechaCivil, type Rango } from '@/utils/periodos';

/**
 * El gasto del mes de la tarjeta del Inicio, con el MISMO criterio que la
 * pantalla de analisis (que es a donde lleva la tarjeta al tocarla).
 *
 * Antes la tarjeta sumaba los ultimos 50 movimientos guardados en el telefono,
 * con la hora del telefono y contando los pendientes: con mas de 50 movimientos
 * en el mes el total se quedaba corto, un gasto de las 11 p. m. del ultimo dia
 * caia en otro mes segun la zona del dispositivo, y comparaba unos dias de este
 * mes contra el mes pasado ENTERO. Ahora:
 *
 * - Los totales salen del resumen del servidor (GET /transactions/summary):
 *   solo movimientos completados, en dias civiles de Costa Rica.
 * - La comparacion es contra los mismos dias del mes anterior
 *   (periodoAnterior), y se omite si ese periodo empieza antes del primer
 *   movimiento de la persona: seria un porcentaje sin base.
 * - Si el servidor no responde, se resume lo guardado en el telefono con las
 *   mismas reglas y la tarjeta lo dice; nunca pinta un cero como dato.
 */
export type EstadoGastoDelMes = 'cargando' | 'listo' | 'respaldo' | 'sin_datos';

export interface GastoDelMes {
  estado: EstadoGastoDelMes;
  /** Moneda de las cifras: la base de la persona, o la que tenga movimientos. */
  moneda: string;
  /** Gastado del mes en curso, en unidades mayores. */
  gastado: number;
  /** Gasto acumulado al cierre de cada dia, del 1 a hoy. */
  acumulado: number[];
  /** Dia civil de Costa Rica de cada punto de `acumulado`. */
  dias: FechaCivil[];
  /** Movimientos del mes en otras monedas, fuera del total. */
  otrasMonedas: number;
  /** Variacion porcentual contra los mismos dias del mes anterior, o null. */
  variacion: number | null;
}

interface Carga {
  hoy: FechaCivil;
  rango: Rango;
  anterior: Rango | null;
  /** null: el servidor no respondio. */
  resumen: TransactionSummary | null;
  resumenAnterior: TransactionSummary | null;
}

const claveDe = (r: Rango) => `${r.desde}|${r.hasta}`;

async function pedirResumen(r: Rango): Promise<TransactionSummary | null> {
  try {
    const res = await getApiLayer().transactions.getSummary({ from: r.desde, to: r.hasta });
    return res.success && res.data ? res.data : null;
  } catch {
    return null;
  }
}

export function useGastoDelMes(transacciones: Transaction[], monedaBase: string): GastoDelMes {
  // Se vuelve a pedir cuando la lista cambia: llego un movimiento o uno
  // pendiente se completo, y el total del servidor ya no es el mismo.
  const firma = useMemo(() => transacciones.map((tx) => `${tx.id}:${tx.status ?? ''}`).join('|'), [transacciones]);
  const [carga, setCarga] = useState<Carga | null>(null);
  // El periodo anterior solo cambia de un dia para otro: no se repide por cada
  // movimiento nuevo.
  const anteriorGuardado = useRef<{ clave: string; resumen: TransactionSummary } | null>(null);

  useEffect(() => {
    let cancelado = false;
    const hoy = hoyCR();
    const rango = rangoPreset('este_mes', hoy);
    const anterior = periodoAnterior(rango, hoy);

    const pedirAnterior = async (): Promise<TransactionSummary | null> => {
      if (!anterior) return null;
      const clave = claveDe(anterior);
      const guardado = anteriorGuardado.current;
      if (guardado?.clave === clave) return guardado.resumen;
      const resumen = await pedirResumen(anterior);
      if (resumen) anteriorGuardado.current = { clave, resumen };
      return resumen;
    };

    (async () => {
      const [resumen, resumenAnterior] = await Promise.all([pedirResumen(rango), pedirAnterior()]);
      if (!cancelado) setCarga({ hoy, rango, anterior, resumen, resumenAnterior });
    })();

    return () => {
      cancelado = true;
    };
  }, [firma]);

  return useMemo<GastoDelMes>(() => {
    const vacio: GastoDelMes = {
      estado: 'cargando',
      moneda: monedaBase,
      gastado: 0,
      acumulado: [],
      dias: [],
      otrasMonedas: 0,
      variacion: null,
    };
    if (!carga) return vacio;

    const { hoy, rango } = carga;
    const deRespaldo = carga.resumen === null;
    // Sin servidor: lo guardado en el telefono, con las mismas reglas (solo
    // completados, dias de Costa Rica).
    const resumen = carga.resumen ?? resumirMovimientos(transacciones, rango);
    const analisis = analizar(resumen, rango, hoy, monedaBase);
    if (deRespaldo && analisis.vacio) {
      return { ...vacio, estado: 'sin_datos', moneda: analisis.moneda };
    }

    const dias: FechaCivil[] = [];
    const acumulado: number[] = [];
    let centimos = 0;
    for (const tramo of analisis.tramos) {
      if (tramo.desde > hoy) break;
      centimos += Math.round(tramo.gastos * 100);
      dias.push(tramo.desde);
      acumulado.push(centimos / 100);
    }

    let pct: number | null = null;
    if (!deRespaldo && carga.anterior && carga.resumenAnterior) {
      const primera = carga.resumenAnterior.firstDate;
      const incompleto = primera !== null && primera > carga.anterior.desde;
      if (!incompleto) {
        pct = variacion(analisis.gastos, totalesEn(carga.resumenAnterior.groups, analisis.moneda).gastos);
      }
    }

    return {
      estado: deRespaldo ? 'respaldo' : 'listo',
      moneda: analisis.moneda,
      gastado: analisis.gastos,
      acumulado,
      dias,
      otrasMonedas: analisis.otrasMonedas,
      variacion: pct,
    };
  }, [carga, transacciones, monedaBase]);
}
