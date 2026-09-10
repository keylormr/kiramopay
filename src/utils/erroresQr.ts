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
