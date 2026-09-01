// Lector del payload de los QR propios de KiramoPay. El backend los emite
// como "KP:<tipo>:<usuario8>:<centimos>:<moneda>:<token>" (qrpayment/service).
// Parsearlo del lado del cliente permite mostrar el monto solicitado en
// grande y pagar en un toque, en vez de ensenar el payload tecnico.

export interface QrKiramo {
  tipo: string;
  /** Monto en unidades de la moneda (el payload viaja en centimos). 0 = abierto. */
  monto: number;
  moneda: string;
}

export function parsearQrKiramo(raw: string): QrKiramo | null {
  const partes = raw.trim().split(':');
  if (partes.length < 6 || partes[0] !== 'KP') return null;
  const centimos = Number(partes[3]);
  return {
    tipo: partes[1],
    monto: Number.isFinite(centimos) && centimos > 0 ? centimos / 100 : 0,
    moneda: partes[4] || 'CRC',
  };
}
