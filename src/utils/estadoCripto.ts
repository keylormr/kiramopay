import type { LucideIcon } from 'lucide-react';
import { Icons } from '@/components/Icons';
import type { CryptoTransaction, EstadoCripto } from '@/types/crypto.types';

/**
 * El estado de un movimiento de cripto: su nombre en pantalla, su color y su
 * icono.
 *
 * El servidor anota hoy todo movimiento como 'completed' (crypto/service.go,
 * envio.go y repository.go; la columna vale 'completed' por defecto y no tiene
 * CHECK). El adaptador convertia en 'completed' cualquier otro estado, y
 * tambien la falta de uno: la pantalla habria dicho que algo se completo sin
 * que el servidor lo dijera. Este modulo es el unico lugar donde ese estado se
 * vuelve palabras.
 */

const DEL_SERVIDOR: ReadonlySet<string> = new Set(['completed', 'pending', 'failed']);

/**
 * El estado que manda el servidor, tal cual si la app lo conoce. Uno que no
 * conoce, o ninguno, llega como 'unknown': decirlo completado seria inventar
 * un dato.
 */
export function estadoCriptoDelServidor(status: string | undefined): EstadoCripto {
  return status && DEL_SERVIDOR.has(status) ? (status as EstadoCripto) : 'unknown';
}

export interface EstiloEstadoCripto {
  /** Clave del texto en el diccionario. */
  clave: string;
  /** Clases del rotulo. */
  chip: string;
  icon: LucideIcon;
}

const NEUTRO = 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-secondary';

const ESTILOS: Record<EstadoCripto, EstiloEstadoCripto> = {
  completed: { clave: 'tx_status_completed', chip: 'uv-chip-success', icon: Icons.Check },
  pending: { clave: 'pending', chip: 'uv-chip-warning', icon: Icons.Clock },
  failed: { clave: 'crypto_status_failed', chip: 'uv-chip-danger', icon: Icons.XCircle },
  unknown: { clave: 'crypto_status_unknown', chip: NEUTRO, icon: Icons.HelpCircle },
};

export function estiloDeEstadoCripto(tx: Pick<CryptoTransaction, 'status'>): EstiloEstadoCripto {
  return ESTILOS[tx.status] ?? ESTILOS.unknown;
}

/** Lo fallido no movio nada: sus montos van tachados y la cripto no va en verde. */
export function criptoNoSeMovio(tx: Pick<CryptoTransaction, 'status'>): boolean {
  return tx.status === 'failed';
}
