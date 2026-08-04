import type { Transaction } from '@/types';

/**
 * Nombre visible de un movimiento.
 *
 * El título sale del nombre de la contraparte o, si no hay, de la descripción
 * que escribió la persona. Las dos pueden venir vacías: una transferencia SINPE
 * interna sin nota y un pago QR sin comentario no traen ninguna de las dos, y la
 * fila quedaba impresa sin texto — un hueco en el historial.
 *
 * Este respaldo nombra el movimiento por su tipo. Cubre además las transacciones
 * ya guardadas, que nunca van a tener contraparte por más que el backend empiece
 * a poblarla de ahora en adelante.
 */
export function txTitle(tx: Transaction, t: (key: string) => string): string {
  const propio = (tx.title || '').trim() || (tx.description || '').trim();
  if (propio) return propio;

  const kind = (tx.kind || '').trim();
  if (kind) {
    const traducido = t(`tx_title_${kind}`);
    // t() devuelve la clave cuando no existe: en ese caso no sirve como título.
    if (traducido && traducido !== `tx_title_${kind}`) return traducido;
  }

  // Último recurso: entrada o salida de dinero, que siempre es cierto.
  return t(tx.type === 'credit' ? 'tx_title_generic_in' : 'tx_title_generic_out');
}
