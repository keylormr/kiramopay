/**
 * Lo que la pantalla del cobro con Lightning necesita y no depende de React:
 * el texto del QR, la cuenta regresiva de la cotizacion, los numeros de SINPE
 * Movil y que decir ante cada rechazo. El servidor es el que valida; esto solo
 * evita mandarle lo que de seguro va a rechazar y escribe lo que contesta.
 */

/**
 * El texto del QR de una factura BOLT11. BOLT 11 pide mayusculas en un QR:
 * asi entra en el modo alfanumerico, que ocupa menos modulos y se lee mejor
 * desde una pantalla. `lightning:` es el esquema que abre cualquier billetera.
 */
export function textoDelQrLightning(factura: string): string {
  const limpia = factura.trim().replace(/^lightning:/i, '');
  return `LIGHTNING:${limpia.toUpperCase()}`;
}

/** Segundos que le quedan a un plazo; 0 si ya paso o la fecha no sirve. */
export function segundosRestantes(vence: string | undefined, ahora: number): number {
  if (!vence) return 0;
  const fin = Date.parse(vence);
  if (!Number.isFinite(fin)) return 0;
  return Math.max(0, Math.floor((fin - ahora) / 1000));
}

/** 582 -> "9:42". Una cuenta regresiva que se lee de un vistazo. */
export function relojDeCuentaRegresiva(segundos: number): string {
  const total = Number.isFinite(segundos) && segundos > 0 ? Math.floor(segundos) : 0;
  const minutos = Math.floor(total / 60);
  return `${minutos}:${String(total % 60).padStart(2, '0')}`;
}

/** "8888-7777" para mostrar un numero que el servidor guarda con 8 digitos. */
export function sinpeMovilLegible(numero: string): string {
  return /^\d{8}$/.test(numero) ? `${numero.slice(0, 4)}-${numero.slice(4)}` : numero;
}

/**
 * Los 8 digitos de un celular de Costa Rica, o null. Acepta espacios, guiones
 * y el prefijo +506, como lo escribe la gente; un fijo (2 o 4) no recibe
 * SINPE Movil. Es la misma regla que aplica el servidor.
 */
export function normalizarSinpeMovil(texto: string): string | null {
  let digitos = texto.replace(/\D/g, '');
  if (digitos.length === 11 && digitos.startsWith('506')) digitos = digitos.slice(3);
  return /^[5-8]\d{7}$/.test(digitos) ? digitos : null;
}

/** Una direccion con forma de nombre@dominio. Si responde lo decide el servidor. */
export function pareceDireccionLightning(texto: string): boolean {
  return /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(texto.trim());
}

/** Los rechazos de pedir la factura, por codigo, con su texto. */
export const CLAVES_DEL_RECHAZO_LIGHTNING: Readonly<Record<string, string>> = {
  LIGHTNING_UNAVAILABLE: 'ln_err_no_disponible',
  LIGHTNING_NO_ADDRESS: 'ln_err_sin_direccion',
  PRICE_STALE: 'ln_err_precio',
  PRICE_UNAVAILABLE: 'ln_err_precio',
  LIGHTNING_PROVIDER_FAILED: 'ln_err_proveedor',
  LIGHTNING_AMOUNT_OUT_OF_RANGE: 'ln_err_rango',
  // Sin respuesta no hay factura: se puede volver a pedir sin riesgo, porque
  // pedir una factura no mueve dinero.
  NETWORK_ERROR: 'ln_err_proveedor',
};

/** Los rechazos de guardar los medios de cobro, por codigo. */
export const CLAVES_DEL_RECHAZO_DE_MEDIOS: Readonly<Record<string, string>> = {
  LIGHTNING_ADDRESS_INVALID: 'mc_err_direccion',
  SINPE_MOVIL_INVALID: 'mc_err_sinpe',
  LIGHTNING_UNAVAILABLE: 'ln_err_no_disponible',
};

/**
 * Los rechazos que dicen que el cobro ya no esta pendiente: la factura no se
 * vuelve a pedir y la pantalla tiene que leer el cobro otra vez.
 */
export const RECHAZOS_DEL_COBRO = new Set(['COBRO_YA_PAGADO', 'COBRO_CANCELADO', 'COBRO_VENCIDO', 'COBRO_REEMPLAZADO']);
