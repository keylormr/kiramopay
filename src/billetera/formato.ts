// Como se muestran las cantidades de la billetera propia. Todo es texto exacto:
// los saldos de las redes no caben en un float sin perder decimales.

/**
 * Corta (no redondea) los decimales de un numero en texto y quita los ceros de
 * la cola. Cortar hacia abajo es a proposito: un saldo mostrado nunca es mayor
 * que el real.
 */
export function recortarDecimales(texto: string, maximo: number): string {
  const [entero, decimales = ''] = texto.split('.');
  const cortados = decimales.slice(0, maximo).replace(/0+$/, '');
  return cortados ? `${entero}.${cortados}` : entero;
}

/** Satoshis a bitcoin en texto exacto (1 BTC = 100.000.000 sats). */
export function satsABtc(sats: number): string {
  if (!Number.isSafeInteger(sats) || sats < 0) return '0';
  const entero = Math.floor(sats / 1e8);
  const resto = String(sats % 1e8).padStart(8, '0');
  return recortarDecimales(`${entero}.${resto}`, 8);
}

/** Lo que vale `cantidad` (texto decimal) a `precioUsd`, o null si no hay precio. */
export function valorEnUsd(cantidad: string, precioUsd: number | undefined): number | null {
  if (!precioUsd || !(precioUsd > 0)) return null;
  const n = Number(cantidad);
  return Number.isFinite(n) ? n * precioUsd : null;
}

/** Una direccion larga, recortada al centro para que quepa en una linea. */
export function direccionCorta(direccion: string, lado = 8): string {
  return direccion.length <= lado * 2 + 1 ? direccion : `${direccion.slice(0, lado)}…${direccion.slice(-lado)}`;
}
