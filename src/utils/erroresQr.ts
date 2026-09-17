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
    default:
      return '';
  }
}

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
