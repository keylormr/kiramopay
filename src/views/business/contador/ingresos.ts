import { leerFecha } from './fechas';
import { inferirSeparador, leerMonto } from './montos';
import { normalizar } from './texto';
import type { Ingreso, MapaDeColumnas, ResultadoDeIngresos, Tabla } from './tipos';

/** "₡", "colones", "crc" -> CRC; "$", "dolares", "usd" -> USD; lo demas, en mayusculas. */
export function normalizarMoneda(texto: string): string {
  const n = normalizar(texto);
  if (!n) return '';
  if (/₡|colon|^crc$/.test(n)) return 'CRC';
  if (/\$|dolar|^usd$/.test(n)) return 'USD';
  return texto.trim().toUpperCase().slice(0, 8);
}

/**
 * Solo ingresos: columna de credito mayor que cero, o monto con signo
 * positivo. Los decimales se infieren por la columna completa y todo se suma
 * despues en centimos enteros.
 */
export function extraerIngresos(
  tabla: Tabla,
  columnas: MapaDeColumnas,
  filaEncabezado: number,
): ResultadoDeIngresos {
  const colIngreso = columnas.credito ?? columnas.monto;
  const filas = tabla.slice(filaEncabezado + 1);
  if (colIngreso === null || columnas.fecha === null) return { ingresos: [], omitidas: 0 };
  const decimal = inferirSeparador(filas.map((f) => f[colIngreso] ?? ''));
  const ingresos: Ingreso[] = [];
  let omitidas = 0;
  filas.forEach((fila, i) => {
    const crudo = fila[colIngreso];
    if (crudo === undefined || String(crudo).trim() === '') return;
    const monto = leerMonto(crudo, decimal);
    if (!monto) {
      // Texto en la columna de montos: un total, un pie de pagina. Si ademas
      // trae una fecha valida es un renglon perdido y se cuenta.
      if (leerFecha(fila[columnas.fecha!]) !== null) omitidas += 1;
      return;
    }
    if (monto.centimos <= 0) return;
    const fecha = leerFecha(fila[columnas.fecha!]);
    if (!fecha) { omitidas += 1; return; }
    const descripcion = columnas.descripcion !== null ? String(fila[columnas.descripcion] ?? '').trim() : '';
    const deColumna = columnas.moneda !== null ? normalizarMoneda(String(fila[columnas.moneda] ?? '')) : '';
    ingresos.push({
      id: `f${filaEncabezado + 1 + i}`,
      fecha,
      mes: fecha.slice(0, 7),
      descripcion,
      centimos: monto.centimos,
      moneda: monto.moneda ?? (deColumna || 'CRC'),
      esSinpe: normalizar(descripcion).includes('sinpe'),
    });
  });
  return { ingresos, omitidas };
}

export function mesesDe(ingresos: Ingreso[]): string[] {
  return [...new Set(ingresos.map((x) => x.mes))].sort();
}

export function monedasDe(ingresos: Ingreso[]): string[] {
  return [...new Set(ingresos.map((x) => x.moneda))].sort();
}

/** Suma exacta en centimos enteros. */
export function sumar(ingresos: Ingreso[]): number {
  let total = 0;
  for (const x of ingresos) total += x.centimos;
  return total;
}
