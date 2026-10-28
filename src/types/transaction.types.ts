/**
 * Los estados que guarda el servidor (transaction/model.go), mas 'unknown' para
 * uno que la app no conoce: ver utils/estadoMovimiento.ts.
 */
export type EstadoMovimiento = 'completed' | 'pending' | 'processing' | 'failed' | 'reversed' | 'unknown';

export interface Transaction {
  id: string;
  title: string;
  amount: number;
  ccy: string;
  date: string;
  // Machine-readable timestamp (ISO 8601) used for date filtering / charts.
  // `date` above is a localized display string and is NOT reliably parseable.
  dateISO?: string;
  type: 'credit' | 'debit';
  category?: string;
  // Sin estado es un movimiento completado (los anotados localmente).
  status?: EstadoMovimiento;
  icon?: string;
  description?: string;
  // Backend transaction type (sinpe_send, qr_payment, …). Kept apart from the
  // credit/debit `type` above so the UI can name a movement whose counterparty
  // and description are both empty, instead of leaving the row blank.
  kind?: string;
  // Con quien fue, y la nota que escribio la persona, cada una por separado:
  // `title` y `description` las juntan ("la contraparte o, si no hay, la nota")
  // y el detalle del movimiento necesita mostrarlas aparte.
  counterparty?: string;
  note?: string;
}
