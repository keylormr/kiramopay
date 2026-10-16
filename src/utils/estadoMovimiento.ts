import type { LucideIcon } from 'lucide-react';
import { Icons } from '@/components/Icons';
import type { EstadoMovimiento, Transaction } from '@/types/transaction.types';

/**
 * El estado de un movimiento: su nombre en pantalla, su color y su icono.
 *
 * El servidor guarda cinco estados (transaction/model.go: pending, processing,
 * completed, failed, reversed) y la app conocia dos: el detalle, la lista y el
 * CSV decian "Pendiente" de todo lo que no estaba completado, asi que un SINPE
 * que fallo se le contaba a la persona como uno que todavia podia salir. Este
 * modulo es el unico lugar donde un estado se convierte en palabras, para que
 * las pantallas y lo exportado no vuelvan a separarse.
 */

const DEL_SERVIDOR: ReadonlySet<string> = new Set(['completed', 'pending', 'processing', 'failed', 'reversed']);

/**
 * El estado que manda el servidor, tal cual si la app lo conoce. Uno que no
 * conoce (la columna admite 'disputed', que nada escribe hoy) llega como
 * 'unknown': decirlo completado o pendiente seria inventar un dato.
 */
export function estadoDelServidor(status: string | undefined): EstadoMovimiento {
  return status && DEL_SERVIDOR.has(status) ? (status as EstadoMovimiento) : 'unknown';
}

/** Sin estado es un movimiento completado: asi se anotan los locales y los de la demo. */
function estadoDe(tx: Pick<Transaction, 'status'>): EstadoMovimiento {
  return tx.status ?? 'completed';
}

export interface EstiloEstado {
  /** Clave del texto en el diccionario. */
  clave: string;
  /** Clases del rotulo. */
  chip: string;
  icon: LucideIcon;
}

const NEUTRO = 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-secondary';

const ESTILOS: Record<EstadoMovimiento, EstiloEstado> = {
  completed: { clave: 'tx_status_completed', chip: 'uv-chip-success', icon: Icons.Check },
  pending: { clave: 'tx_status_pending', chip: 'uv-chip-warning', icon: Icons.Clock },
  processing: { clave: 'tx_status_processing', chip: 'uv-chip-info', icon: Icons.Clock },
  failed: { clave: 'tx_status_failed', chip: 'uv-chip-danger', icon: Icons.XCircle },
  reversed: { clave: 'tx_status_reversed', chip: NEUTRO, icon: Icons.History },
  unknown: { clave: 'tx_status_unknown', chip: NEUTRO, icon: Icons.HelpCircle },
};

export function estiloDeEstado(tx: Pick<Transaction, 'status'>): EstiloEstado {
  return ESTILOS[estadoDe(tx)] ?? ESTILOS.unknown;
}

export function etiquetaDeEstado(tx: Pick<Transaction, 'status'>, t: (clave: string) => string): string {
  return t(estiloDeEstado(tx).clave);
}

export function estaCompletado(tx: Pick<Transaction, 'status'>): boolean {
  return estadoDe(tx) === 'completed';
}

/**
 * Lo que no movio dinero (fallido) o se deshizo (revertido). Va tachado en
 * pantalla y no se suma en los totales: contaba como un gasto o un ingreso
 * hecho. Lo pendiente o en proceso si se suma, como hasta ahora, porque todavia
 * puede salir.
 */
export function noMovioDinero(tx: Pick<Transaction, 'status'>): boolean {
  const estado = estadoDe(tx);
  return estado === 'failed' || estado === 'reversed';
}
