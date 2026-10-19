import { mensajeDeRechazo } from '@/i18n/mensajesDeError';

/**
 * Traduce el codigo de error que manda el servidor en el riel de QR.
 *
 * Existe porque hasta ahora ese motivo no llegaba nunca a la pantalla: el
 * handler respondia siempre PAYMENT_FAILED y el adaptador encima lo pisaba con
 * otro generico. El usuario veia "no se pudo pagar" sin poder distinguir "el
 * cajero cambio el monto" de "ese cobro ya lo pagaron" o "ese codigo fue
 * retirado" — que son tres cosas con tres salidas distintas.
 *
 * Devuelve cadena vacia para un codigo que no conocemos, para que quien llama
 * caiga a su mensaje generico en vez de mostrar uno equivocado.
 */
export function mensajeDeCobro(t: (k: string) => string, codigo?: string): string {
  switch (codigo) {
    case 'QR_REVOCADO':
      return t('qr_err_revocado');
    case 'COBRO_REEMPLAZADO':
      return t('qr_err_reemplazado');
    case 'COBRO_YA_PAGADO':
      return t('qr_err_ya_pagado');
    case 'COBRO_VENCIDO':
      return t('qr_err_vencido');
    case 'COBRO_CANCELADO':
      return t('qr_err_cancelado');
    case 'COBRO_DUPLICADO_APP_VIEJA':
      return t('qr_err_actualiza_app');
    // Los de forma y de seguridad. Sin estos, la vista caia al texto del
    // servidor, que esta solo en espanol y en voseo ("no podes pagarte a vos
    // mismo"): con la app en otro idioma el motivo salia sin traducir.
    case 'QR_INVALIDO':
      return t('qr_err_invalido');
    case 'NO_PODES_PAGARTE':
      return t('qr_err_pago_propio');
    case 'MONTO_REQUERIDO':
      return t('qr_err_monto_requerido');
    case 'LLAVE_REUTILIZADA':
      return t('qr_err_llave_reutilizada');
    case 'LLAVE_INVALIDA':
      return t('qr_err_llave_invalida');
    case 'PAGO_NO_REGISTRADO':
      return t('qr_err_pago_no_registrado');
    case 'MFA_REQUIRED':
      return t('qr_err_mfa');
    // El comercio se cerro: su codigo ya no cobra. Sin este caso caia al aviso
    // generico, como si el problema fuera de quien paga.
    case 'MERCHANT_CLOSED':
      return t('qr_err_comercio_cerrado');
    default:
      return '';
  }
}

/**
 * Los rechazos del pago (POST /qr/pay) que no son del cobro en si, por codigo:
 * los del motor de transferencias, que comparte con SINPE, y los del comercio.
 * Van despues de mensajeDeCobro, con mensajeDeRechazo: un codigo que no este en
 * ninguno de los dos cae al generico, nunca al texto del servidor, que es para
 * quien integra la API, esta en ingles y arrastraba los prefijos internos
 * ("qr payment transfer: insufficient balance").
 */
export const CLAVES_DEL_RECHAZO_DEL_PAGO: Readonly<Record<string, string>> = {
  INSUFFICIENT_BALANCE: 'insufficient_funds',
  DAILY_LIMIT_EXCEEDED: 'pago_err_tope_diario',
  MONTHLY_LIMIT_EXCEEDED: 'pago_err_tope_mensual',
  MERCHANT_UNAVAILABLE: 'qr_err_comercio_no_disponible',
  // El comercio del codigo ya no existe: para quien paga, el codigo no sirve.
  MERCHANT_NOT_FOUND: 'qr_err_invalido',
  // Un codigo en una moneda que la billetera no maneja: no se movio nada.
  UNSUPPORTED_CURRENCY: 'qr_err_moneda',
  // Sin respuesta o con el 500 el pago pudo haber salido. La llave se
  // conserva (ver PAGO_SIN_CONFIRMAR), y eso es lo que permite decir que
  // reintentar ahora no cobra dos veces.
  NETWORK_ERROR: 'qr_err_sin_confirmar',
  TIMEOUT: 'qr_err_sin_confirmar',
  SERVER_ERROR: 'qr_err_sin_confirmar',
  PAYMENT_FAILED: 'qr_err_sin_confirmar',
};

/**
 * Los codigos con los que el pago pudo haber salido: la llave del pago se
 * CONSERVA, para que el reintento sea el mismo pago y no uno nuevo. Desde que
 * el servidor responde cada rechazo con su codigo, PAYMENT_FAILED es solo el
 * 500. PAGO_NO_REGISTRADO va aunque el servidor si respondio: dice que el libro
 * ya tiene este pago, asi que el dinero se movio y el reintento no puede ser
 * otro pago.
 */
export const PAGO_SIN_CONFIRMAR: ReadonlySet<string> = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVER_ERROR',
  'PAYMENT_FAILED',
  'PAGO_NO_REGISTRADO',
]);

/**
 * El estado que /qr/resolve informa de un cobro, traducido al mismo codigo con
 * el que el servidor rechazaria el pago. Sirve para avisar ANTES de ofrecer el
 * boton de pagar: hasta ahora la hoja pintaba un cobro ya pagado o cancelado
 * como vigente y el motivo aparecia solo despues del intento.
 *
 * Devuelve cadena vacia para 'pending' y para un estado que no conocemos: en
 * ese caso decide el servidor al pagar.
 */
export function codigoDeCobroCerrado(estado?: string): string {
  switch (estado) {
    case 'paid':
      return 'COBRO_YA_PAGADO';
    case 'cancelled':
      return 'COBRO_CANCELADO';
    case 'expired':
      return 'COBRO_VENCIDO';
    case 'superseded':
      return 'COBRO_REEMPLAZADO';
    default:
      return '';
  }
}

/** Minutos que le quedan a un cobro, para el rotulo "vence en N min". */
export function minutosParaVencer(expiresAt?: string): number {
  if (!expiresAt) return 0;
  const restante = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(restante) || restante <= 0) return 0;
  return Math.max(1, Math.round(restante / 60000));
}

/**
 * Los rechazos de pedir el codigo propio o el rotulo, emitir un cobro y
 * quitarle el monto, por codigo. Las tres hojas que cobran (inicio, solicitar
 * en SINPE y el negocio) pintaban `res.error.message` cuando el codigo no era
 * de los del cobro: el texto del servidor en ingles ("merchant is pending
 * verification") y, cuando fallaba la base, la frase del driver.
 */
export const CLAVES_DEL_RECHAZO_DEL_COBRO: Readonly<Record<string, string>> = {
  MONTO_INVALIDO: 'qr_err_monto_invalido',
  UNSUPPORTED_CURRENCY: 'qr_err_moneda',
  MERCHANT_UNAVAILABLE: 'qr_err_comercio_no_disponible',
};

/**
 * El texto de un rechazo del cobro: primero los del cobro en si (ya pagado,
 * vencido...), despues los de la tabla de arriba, y lo demas al aviso de la
 * hoja. Nunca el texto del servidor.
 */
export function mensajeDelRechazoDelCobro(
  t: (k: string) => string,
  error: { code?: string; message?: string } | undefined,
  claveGenerica: string,
): string {
  return mensajeDeCobro(t, error?.code) || mensajeDeRechazo(error, CLAVES_DEL_RECHAZO_DEL_COBRO, claveGenerica, t);
}
