import type { Celda } from './tipos';

export type SeparadorDecimal = ',' | '.' | null;

const PALABRAS_DE_MONEDA = /(colones?|dolares?|us\$|crc|usd|\$|₡|¢)/gi;

interface Limpio {
  digitos: string;
  negativo: boolean;
  moneda: string | null;
}

function limpiar(texto: string): Limpio | null {
  let s = texto.replace(/[\s\u00a0\u202f\u2007]+/g, '');
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negativo = !negativo;
    s = s.slice(1);
  }
  if (s.endsWith('-') || s.endsWith('−')) {
    negativo = !negativo;
    s = s.slice(0, -1);
  }
  let moneda: string | null = null;
  if (/₡|¢|crc|colon/i.test(s)) moneda = 'CRC';
  else if (/\$|usd|dolar/i.test(s)) moneda = 'USD';
  s = s.replace(PALABRAS_DE_MONEDA, '');
  if (s.startsWith('-')) {
    negativo = !negativo;
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;
  return { digitos: s, negativo, moneda };
}

/** Que dice este valor sobre el separador decimal: ',', '.' o nada concluyente. */
function evidencia(d: string): ',' | '.' | null {
  const ultimaComa = d.lastIndexOf(',');
  const ultimoPunto = d.lastIndexOf('.');
  if (ultimaComa >= 0 && ultimoPunto >= 0) return ultimaComa > ultimoPunto ? ',' : '.';
  const sep = ultimaComa >= 0 ? ',' : ultimoPunto >= 0 ? '.' : null;
  if (!sep) return null;
  if (d.split(sep).length - 1 > 1) return null; // 1.234.567: miles
  const [entera, decimales] = d.split(sep);
  if (decimales.length !== 3) return sep; // 12,5  1234,56
  if (/^0+$/.test(entera)) return sep; // 0,500
  return null; // 1,234 o 1.234: miles salvo evidencia en otra fila
}

/**
 * El separador decimal de una columna COMPLETA, no fila por fila: "1,234" solo
 * es ambiguo, pero con "1,234.56" al lado la columna usa punto decimal.
 */
export function inferirSeparador(valores: Celda[]): SeparadorDecimal {
  const votos = { ',': 0, '.': 0 };
  for (const v of valores) {
    if (typeof v !== 'string') continue;
    const l = limpiar(v);
    if (!l) continue;
    const e = evidencia(l.digitos);
    if (e) votos[e] += 1;
  }
  if (votos[','] === 0 && votos['.'] === 0) return null;
  return votos[','] >= votos['.'] ? ',' : '.';
}

function aCentimosDeTexto(digitos: string, decimal: SeparadorDecimal): number | null {
  let entera: string;
  let frac = '';
  if (decimal) {
    const otro = decimal === ',' ? '.' : ',';
    const partes = digitos.split(otro).join('').split(decimal);
    if (partes.length > 2) return null;
    entera = partes[0];
    frac = partes[1] ?? '';
  } else {
    entera = digitos.replace(/[.,]/g, '');
  }
  if (!/^\d*$/.test(entera) || !/^\d*$/.test(frac)) return null;
  let c = Number(entera || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) c += 1;
  return Number.isSafeInteger(c) ? c : null;
}

export interface MontoLeido {
  centimos: number;
  moneda: string | null;
}

/** Un monto en centimos enteros (con signo), o null si no es un monto. */
export function leerMonto(valor: Celda | undefined, decimal: SeparadorDecimal): MontoLeido | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null;
    const c = Math.round(valor * 100);
    return Number.isSafeInteger(c) ? { centimos: c, moneda: null } : null;
  }
  const l = limpiar(valor);
  if (!l) return null;
  const c = aCentimosDeTexto(l.digitos, decimal);
  if (c === null) return null;
  return { centimos: l.negativo ? -c : c, moneda: l.moneda };
}
