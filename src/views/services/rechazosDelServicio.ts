/**
 * Los rechazos de pagar un recibo y de una recarga, por codigo. Los usan la
 * pantalla de Servicios y el asistente, que confirma por las mismas rutas: el
 * mismo rechazo se dice igual en los dos lados. Con mensajeDeRechazo, un codigo
 * que no este aqui cae al generico, nunca al texto del servidor, que es para
 * quien integra la API y mezclaba ingles y espanol fijo ("process payment:
 * insufficient balance", "el pago no se puede entregar todavia").
 */
export const CLAVES_DEL_RECHAZO_DEL_RECIBO: Readonly<Record<string, string>> = {
  // Sin convenio con la empresa: no hay a quien entregarle el pago y no se
  // cobra nada.
  SIN_CONVENIO: 'bill_no_agreement',
};

export const CLAVES_DEL_RECHAZO_DE_LA_RECARGA: Readonly<Record<string, string>> = {
  SIN_CONVENIO: 'recharge_no_agreement',
};

export const CLAVE_GENERICA_DEL_SERVICIO = 'assistant_action_failed';
