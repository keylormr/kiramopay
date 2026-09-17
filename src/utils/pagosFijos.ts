/**
 * Fechas de los pagos fijos (recordatorios de pagos que se repiten).
 *
 * Las fechas son civiles, "YYYY-MM-DD", igual que la columna DATE del
 * servidor. Se opera en UTC sobre esa fecha para que ninguna zona horaria la
 * corra un dia (new Date('2026-10-05') es medianoche UTC: en Costa Rica se
 * mostraria el 4).
 */
import type { RecurringPayment } from '@/types';
import { localeDeIdioma } from './planes';

type Frecuencia = RecurringPayment['frequency'];

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

function partes(fecha: string): [number, number, number] | null {
  const m = FECHA.exec(fecha);
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(a, mes - 1, d));
  // "2026-02-30" no es una fecha: Date la correria al 2 de marzo.
  if (utc.getUTCFullYear() !== a || utc.getUTCMonth() !== mes - 1 || utc.getUTCDate() !== d) return null;
  return [a, mes, d];
}

const dosCifras = (n: number) => String(n).padStart(2, '0');
const aTexto = (a: number, mes: number, d: number) => `${a}-${dosCifras(mes)}-${dosCifras(d)}`;

export function esFechaValida(fecha: string): boolean {
  return partes(fecha) !== null;
}

/** Hoy, en el calendario del dispositivo. */
export function hoyLocal(ahora: Date = new Date()): string {
  return aTexto(ahora.getFullYear(), ahora.getMonth() + 1, ahora.getDate());
}

/**
 * La fecha que queda despues de "Ya lo pague", con la MISMA regla del
 * servidor (recurring.MarkPaid): 7 o 14 dias, o un mes. Postgres suma el mes
 * y, si el dia no existe, se queda en el ultimo del mes (31 de enero -> 28 de
 * febrero). setMonth de JS saltaria al 3 de marzo, y la hoja prometeria una
 * fecha distinta de la que el servidor guarda.
 */
export function siguienteFecha(fecha: string, frecuencia: Frecuencia): string {
  const p = partes(fecha);
  if (!p) return fecha;
  const [a, mes, d] = p;
  if (frecuencia === 'weekly' || frecuencia === 'biweekly') {
    const dias = frecuencia === 'weekly' ? 7 : 14;
    const utc = new Date(Date.UTC(a, mes - 1, d + dias));
    return aTexto(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
  }
  const destino = new Date(Date.UTC(a, mes, 1)); // primer dia del mes siguiente
  const ultimoDia = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  return aTexto(destino.getUTCFullYear(), destino.getUTCMonth() + 1, Math.min(d, ultimoDia));
}

/** "5 oct 2026" en el idioma de la app. Una fecha que no se entiende sale tal cual. */
export function fechaCorta(fecha: string, idioma: string): string {
  const p = partes(fecha);
  if (!p) return fecha;
  const [a, mes, d] = p;
  try {
    return new Intl.DateTimeFormat(localeDeIdioma(idioma), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(a, mes - 1, d)));
  } catch {
    return fecha;
  }
}
