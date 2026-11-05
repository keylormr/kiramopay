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

/**
 * ¿Lo que se leyo PUEDE ser un codigo de KiramoPay? Solo mira la forma: que
 * exista, siga vigente y a quien pague lo sabe el servidor. Sirve para rechazar
 * en el escaner un QR de otra cosa (una URL, un QR de otra app) en vez de abrir
 * "Pago detectado" para que el servidor lo rechace despues.
 *
 * En modo demostracion (sin servidor) el adaptador local emite sus codigos como
 * JSON con un `id`; con servidor esos NO son de KiramoPay. `demostracion` es
 * true cuando no hay URL de servidor (VITE_API_URL vacia), igual que la
 * decision del propio adaptador de la app.
 */
export function esCodigoDeKiramoPay(
  raw: string,
  { demostracion = !import.meta.env.VITE_API_URL }: { demostracion?: boolean } = {},
): boolean {
  if (parsearQrKiramo(raw)) return true;
  if (!demostracion) return false;
  try {
    const o = JSON.parse(raw) as unknown;
    return (
      typeof o === 'object' &&
      o !== null &&
      !Array.isArray(o) &&
      typeof (o as { id?: unknown }).id === 'string'
    );
  } catch {
    return false;
  }
}
