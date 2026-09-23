import type { CryptoTransaction } from '@/types';

/** Una pata del movimiento: cuanto y de que. */
export interface Pata {
  monto: number;
  activo: string;
}

/**
 * Como se lee un movimiento en pantalla.
 *
 * `principal` es la cripto que entra o sale —lo que va en grande—, y
 * `contraparte` lo que se movio del otro lado: el fiat de una compra o una
 * venta, o el activo de origen de una conversion.
 *
 * La fila asumia que `fromAsset`/`fromAmount` eran siempre la cripto, y en una
 * compra son el fiat pagado: una compra de US$1 decia "+1 USD" en verde, y el
 * subtitulo multiplicaba ese dolar por el precio del ETH ("$2,505.24").
 */
export interface LecturaMovimiento {
  principal: Pata & { entra: boolean };
  contraparte: (Pata & { entra: boolean }) | null;
  /** Lo que la persona entrego, cuando el movimiento es un intercambio. */
  entrega: Pata | null;
  /** Lo que la persona recibio, cuando el movimiento es un intercambio. */
  recibe: Pata | null;
}

const ENTRAN: ReadonlyArray<CryptoTransaction['type']> = ['receive', 'yield', 'unstake'];

export function leerMovimiento(tx: CryptoTransaction): LecturaMovimiento {
  const origen: Pata = { monto: tx.fromAmount, activo: tx.fromAsset };
  const destino: Pata | null =
    tx.toAsset && tx.toAmount !== undefined ? { monto: tx.toAmount, activo: tx.toAsset } : null;

  switch (tx.type) {
    case 'buy': {
      // Un movimiento local viejo podia no traer la cantidad recibida: se
      // deduce del precio antes que mostrar el fiat como si fuera la cripto.
      const recibe: Pata = destino ?? {
        monto: tx.price > 0 ? tx.fromAmount / tx.price : 0,
        activo: tx.toAsset ?? '',
      };
      return {
        principal: { ...recibe, entra: true },
        contraparte: { ...origen, entra: false },
        entrega: origen,
        recibe,
      };
    }
    case 'sell':
      return {
        principal: { ...origen, entra: false },
        contraparte: destino ? { ...destino, entra: true } : null,
        entrega: origen,
        recibe: destino,
      };
    case 'convert':
      if (destino) {
        return {
          principal: { ...destino, entra: true },
          contraparte: { ...origen, entra: false },
          entrega: origen,
          recibe: destino,
        };
      }
      return { principal: { ...origen, entra: false }, contraparte: null, entrega: origen, recibe: null };
    default:
      return {
        principal: { ...origen, entra: ENTRAN.includes(tx.type) },
        contraparte: null,
        entrega: null,
        recibe: null,
      };
  }
}

/** Las monedas del monedero: sus montos van con simbolo de moneda. */
export const MONEDAS_FIAT: ReadonlySet<string> = new Set(['USD', 'CRC', 'PAB', 'GTQ']);

/**
 * La fecha de un movimiento, en el idioma de la pantalla.
 *
 * Solo se formatea una fecha de maquina (ISO), que es lo que manda el servidor
 * y lo que anota la pantalla. Una fecha ya escrita para leer se muestra tal
 * cual: la demo las traia asi ("Hoy, 10:30 AM") y el navegador que ya la abrio
 * las conserva guardadas. `recien` es el texto para lo ocurrido hace menos de
 * un minuto; vacio, se muestra la fecha.
 */
export function fechaLegible(
  valor: string,
  idioma: string,
  recien: string,
  ahora: number = Date.now(),
): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(valor)) return valor;
  const ms = Date.parse(valor);
  if (Number.isNaN(ms)) return valor;
  if (recien && Math.abs(ahora - ms) < 60_000) return recien;
  const locale = idioma === 'zh-cn' ? 'zh-CN' : idioma;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ms);
  } catch {
    return new Date(ms).toLocaleString();
  }
}
