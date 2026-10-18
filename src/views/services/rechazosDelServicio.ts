/**
 * Los rechazos de pagar un recibo y de una recarga, por codigo. Los usan la
 * pantalla de Servicios y el asistente, que confirma por las mismas rutas: el
 * mismo rechazo se dice igual en los dos lados. Con mensajeDeRechazo, un codigo
 * que no este aqui cae al generico, nunca al texto del servidor, que es para
 * quien integra la API y mezclaba ingles y espanol fijo ("process payment:
 * insufficient balance", "el pago no se puede entregar todavia").
 *
 * Los del motor de transferencias llevan el mismo codigo que en SINPE y en el
 * pago por QR. TRANSFER_BLOCKED cae al generico, como en el pago por QR,
 * mientras no se decida que decir ante el bloqueo del motor de riesgo.
 */
const RECHAZOS_DEL_MOTOR: Readonly<Record<string, string>> = {
  INSUFFICIENT_BALANCE: 'insufficient_funds',
  DAILY_LIMIT_EXCEEDED: 'pago_err_tope_diario',
  MONTHLY_LIMIT_EXCEEDED: 'pago_err_tope_mensual',
  // La llave ya es de otro pago (otro cliente, otro telefono u otro monto).
  LLAVE_REUTILIZADA: 'err_llave_reutilizada',
};

export const CLAVES_DEL_RECHAZO_DEL_RECIBO: Readonly<Record<string, string>> = {
  // Sin convenio con la empresa: no hay a quien entregarle el pago y no se
  // cobra nada.
  SIN_CONVENIO: 'bill_no_agreement',
  ...RECHAZOS_DEL_MOTOR,
  // Sin respuesta o con el 500, el pago pudo haber salido. La llave se
  // conserva (ver llaveDelServicio), y eso es lo que permite decir que
  // reintentar ahora no cobra dos veces.
  NETWORK_ERROR: 'bill_err_sin_confirmar',
  TIMEOUT: 'bill_err_sin_confirmar',
  PAYMENT_FAILED: 'bill_err_sin_confirmar',
};

export const CLAVES_DEL_RECHAZO_DE_LA_RECARGA: Readonly<Record<string, string>> = {
  SIN_CONVENIO: 'recharge_no_agreement',
  ...RECHAZOS_DEL_MOTOR,
  NETWORK_ERROR: 'recharge_err_sin_confirmar',
  TIMEOUT: 'recharge_err_sin_confirmar',
  RECHARGE_FAILED: 'recharge_err_sin_confirmar',
};

export const CLAVE_GENERICA_DEL_SERVICIO = 'assistant_action_failed';
