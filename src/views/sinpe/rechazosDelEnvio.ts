/**
 * Los rechazos del envio SINPE, por codigo. Los usan las tres pantallas que
 * envian por POST /sinpe/send (SINPE, el contacto escaneado de Inicio y el
 * asistente) con mensajeDeRechazo: un codigo que no este aqui cae al generico,
 * nunca al texto del servidor, que es para quien integra la API, esta en
 * ingles y arrastra los prefijos internos.
 */
export const CLAVES_DEL_RECHAZO_SINPE: Readonly<Record<string, string>> = {
  RECIPIENT_NOT_USER: 'sinpe_recipient_not_user',
  SELF_SEND: 'sinpe_self_send_error',
  // El numero mal formado tras la validacion del servidor. Sin este codigo se
  // filtraba el "invalid SINPE Móvil phone number" del servidor tal cual.
  INVALID_PHONE: 'sinpe_phone_invalid',
  // Sin respuesta, el envio pudo haber salido. La llave se conserva, y eso es
  // lo que permite decir que reintentar ahora no lo manda dos veces.
  NETWORK_ERROR: 'sinpe_err_sin_confirmar',
  // El 500 es lo mismo: el servidor fallo y el envio pudo haber salido (un
  // commit que se corta termina aqui). Un rechazo tiene su propio codigo.
  SINPE_FAILED: 'sinpe_err_sin_confirmar',
  LLAVE_REUTILIZADA: 'err_llave_reutilizada',
  INSUFFICIENT_BALANCE: 'insufficient_funds',
  SINGLE_PAYMENT_LIMIT_EXCEEDED: 'sinpe_err_maximo_por_envio',
  // El cupo SINPE del dia; el tope diario de la billetera es el siguiente.
  SINPE_DAILY_LIMIT_EXCEEDED: 'sinpe_err_cupo_diario',
  DAILY_LIMIT_EXCEEDED: 'sinpe_err_tope_diario',
  MONTHLY_LIMIT_EXCEEDED: 'sinpe_err_tope_mensual',
};

export const CLAVE_GENERICA_DEL_ENVIO = 'sinpe_err_no_salio';
