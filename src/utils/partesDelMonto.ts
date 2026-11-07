// Un monto partido para dibujarlo como en la tarjeta de saldo: el simbolo y los
// decimales mas chicos y tenues que la cifra entera. Usa el mismo formato que
// formatMoney (MONEY_LOCALE, simbolo angosto, dos decimales) para que el numero
// grande diga exactamente lo mismo que el resto de la app.

import { formatMoney, MONEY_LOCALE, type CurrencyCode } from './money';

export interface PartesDelMonto {
  /** '-' o '' (el signo va antes del simbolo, como en formatMoney). */
  signo: string;
  simbolo: string;
  /** La parte entera con sus separadores de miles. */
  entero: string;
  /** El separador decimal y los decimales ('.95'), o '' si no hay. */
  decimales: string;
}

export function partesDelMonto(valor: number, moneda: string): PartesDelMonto {
  try {
    const partes = new Intl.NumberFormat(MONEY_LOCALE, {
      style: 'currency',
      currencyDisplay: 'narrowSymbol',
      currency: moneda,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).formatToParts(valor);
    let signo = '';
    let simbolo = '';
    let entero = '';
    let decimales = '';
    for (const p of partes) {
      if (p.type === 'minusSign') signo = '-';
      else if (p.type === 'currency') simbolo = p.value;
      else if (p.type === 'integer' || p.type === 'group') entero += p.value;
      else if (p.type === 'decimal' || p.type === 'fraction') decimales += p.value;
    }
    return { signo, simbolo, entero, decimales };
  } catch {
    // Una moneda que Intl no conoce: el texto de formatMoney entero, sin partir.
    return { signo: '', simbolo: '', entero: formatMoney(valor, moneda as CurrencyCode, { decimals: 2 }), decimales: '' };
  }
}
