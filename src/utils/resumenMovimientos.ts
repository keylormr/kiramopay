import type { Transaction } from '@/types';
import type { SummaryGroup, TransactionSummary } from '@/api/repositories/transaction.repository';
import { getTxTime } from './fechasTx';
import { fechaCivilCR, type Rango } from './periodos';

/**
 * Cuantos movimientos grandes se conservan por direccion y moneda. Es el mismo
 * tope que usa el servidor por tipo (PrincipalesPorTipo) y el maximo que la
 * pantalla muestra en cualquier filtro: asi los N mas grandes siempre estan.
 */
export const PRINCIPALES_POR_GRUPO = 8;

/** Centimos enteros de un monto en unidades mayores. */
const aCentimos = (monto: number) => Math.round(Math.abs(monto) * 100);

/**
 * Arma, sobre movimientos que ya estan en el telefono, el mismo resumen que
 * devuelve el servidor. Lo usan el modo de datos simulados y la pantalla de
 * analisis cuando el servidor no responde; en ese segundo caso los movimientos
 * son solo los recientes y la pantalla lo dice.
 *
 * Aqui no hay tipo de movimiento que clasificar: la direccion sale del signo del
 * monto, que el adaptador ya puso, y la categoria del propio movimiento.
 */
export function resumirMovimientos(txs: Transaction[], rango: Rango): TransactionSummary {
  const grupos = new Map<string, SummaryGroup>();
  const dentro: Transaction[] = [];
  let primera: string | null = null;

  for (const tx of txs) {
    if (tx.status && tx.status !== 'completed') continue;
    if (!tx.amount) continue;
    const t = getTxTime(tx);
    if (t === null) continue;
    const fecha = fechaCivilCR(t);
    if (primera === null || fecha < primera) primera = fecha;
    if (fecha < rango.desde || fecha >= rango.hasta) continue;

    const direction = tx.amount > 0 ? 'in' : 'out';
    const ccy = tx.ccy || 'CRC';
    const category = tx.category || 'other';
    const clave = `${fecha}|${ccy}|${category}|${direction}`;
    const g = grupos.get(clave);
    if (g) {
      g.count += 1;
      g.amountMinor += aCentimos(tx.amount);
    } else {
      grupos.set(clave, { date: fecha, ccy, category, direction, count: 1, amountMinor: aCentimos(tx.amount) });
    }
    dentro.push(tx);
  }

  const porLlave = new Map<string, Transaction[]>();
  for (const tx of dentro) {
    const llave = `${tx.amount > 0 ? 'in' : 'out'}|${tx.ccy || 'CRC'}`;
    const lista = porLlave.get(llave) ?? [];
    lista.push(tx);
    porLlave.set(llave, lista);
  }
  const top = [...porLlave.values()]
    .flatMap((lista) =>
      [...lista].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, PRINCIPALES_POR_GRUPO),
    )
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return {
    from: rango.desde,
    to: rango.hasta,
    groups: [...grupos.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    top,
    // Sobre movimientos guardados en el telefono es solo el mas viejo de ESOS.
    firstDate: primera,
  };
}
