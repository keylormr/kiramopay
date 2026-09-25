// Fecha y hora de un plazo, en el idioma de la app.
//
// Los plazos del escrow deciden a quien se le paga, asi que la hora importa
// tanto como el dia: "hasta el 20/09" no dice si es a las 00:01 o a las 23:59.

// El locale de cada idioma vive en un solo lugar (utils/periodos.ts): aqui
// habia una copia de la misma tabla.
import { localeDe } from './periodos';

export function fechaYHora(iso: string | undefined, idioma: string): string {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(localeDe(idioma), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(fecha);
  } catch {
    return fecha.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * Solo el dia, en el idioma de la app. Para las filas de una lista, donde la
 * fecha comparte linea con la categoria o el telefono: con la hora, a 390 px
 * se partia en dos ("04:16 p." arriba, "m." abajo). La hora va en el detalle.
 */
export function fechaCorta(iso: string | undefined, idioma: string): string {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(localeDe(idioma), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(fecha);
  } catch {
    return fecha.toISOString().slice(0, 10);
  }
}

/** Si un plazo ya paso segun el reloj del dispositivo. Sin plazo, no vencio. */
export function plazoVencido(iso: string | undefined, ahora: number = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t <= ahora;
}
