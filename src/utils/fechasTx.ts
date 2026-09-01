import type { Transaction } from '@/types';

// Timestamp de maquina de una transaccion, o null cuando no trae fecha
// parseable. dateISO es el campo confiable; el `date` localizado solo parsea
// cuando de casualidad es ISO — antes que inventar una fecha, se descarta.
export function getTxTime(tx: Transaction): number | null {
  if (tx.dateISO) {
    const t = Date.parse(tx.dateISO);
    if (!Number.isNaN(t)) return t;
  }
  const t2 = Date.parse(tx.date);
  return Number.isNaN(t2) ? null : t2;
}
