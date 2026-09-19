/**
 * Que se le dice a la persona cuando una operacion de cripto falla.
 *
 * Se decide SIEMPRE por el codigo. La pantalla mostraba `res.error.message`,
 * que para los rechazos del servidor es un texto en ingles pensado para el
 * log ("insufficient asset balance", "staking position not found"). Un codigo
 * que este mapa no conoce cae al generico traducido, nunca al texto crudo.
 */
export function mensajeDeErrorCripto(
  err: { code?: string } | undefined,
  t: (clave: string) => string,
): string {
  switch (err?.code) {
    // Precio: el servidor no cobra contra un numero que ya no vale.
    case 'PRICE_STALE':
      return t('crypto_price_stale');
    case 'PRICE_UNAVAILABLE':
      return t('crypto_err_price_unavailable');
    case 'PRICE_MOVED':
      return t('crypto_err_price_moved');
    case 'UNSUPPORTED_CURRENCY':
      return t('crypto_err_unsupported_currency');
    // Saldo y montos.
    case 'CRYPTO_INSUFFICIENT_BALANCE':
      return t('crypto_err_insufficient_asset');
    case 'CRYPTO_INVALID_AMOUNT':
      return t('crypto_err_invalid_amount');
    case 'INSUFFICIENT_BALANCE':
      return t('crypto_err_insufficient_funds');
    case 'DAILY_LIMIT_EXCEEDED':
      return t('crypto_err_daily_limit');
    case 'MONTHLY_LIMIT_EXCEEDED':
      return t('crypto_err_monthly_limit');
    // La llave de idempotencia ya se uso para un movimiento distinto: en la
    // venta pasa cuando el reintento llega con el precio ya movido.
    case 'LLAVE_REUTILIZADA':
      return t('crypto_err_repeated_request');
    // Staking.
    case 'STAKING_NOT_AVAILABLE':
      return t('crypto_err_staking_not_available');
    case 'STAKING_POSITION_NOT_FOUND':
    case 'STAKING_POSITION_INACTIVE':
      return t('crypto_err_position_gone');
    case 'STAKING_POSITION_LOCKED':
      return t('crypto_err_position_locked');
    case 'CLAIM_NOT_AVAILABLE':
      return t('crypto_claim_unavailable');
    // Envio entre personas. El QR dice a quien le llega, asi que cada motivo
    // por el que un codigo no sirve se explica aparte: "no se pudo" no le dice
    // a nadie que tiene que pedirle a la otra persona su codigo personal.
    case 'QR_INVALIDO':
      return t('crypto_err_qr_invalido');
    case 'QR_REVOCADO':
      return t('crypto_err_qr_revocado');
    case 'QR_DE_COMERCIO':
      return t('crypto_err_qr_de_comercio');
    case 'QR_DE_COBRO':
      return t('crypto_err_qr_de_cobro');
    case 'CRYPTO_SEND_SELF':
      return t('crypto_err_envio_a_si_mismo');
    case 'CRYPTO_SEND_UNAVAILABLE':
      return t('crypto_err_envio_no_disponible');
    // Los que nacen en el propio cliente.
    case 'NETWORK_ERROR':
      return t('err_network');
    case 'RATE_LIMITED':
      return t('err_rate_limited');
    case 'SESSION_EXPIRED':
      return t('err_session_expired');
    // El 5xx (BUY_FAILED, SELL_FAILED...) y cualquier codigo desconocido.
    default:
      return t('crypto_err_generic');
  }
}

/** La posicion que se quiso retirar ya no esta activa en el servidor. */
export function posicionYaNoEsta(code: string | undefined): boolean {
  return code === 'STAKING_POSITION_NOT_FOUND' || code === 'STAKING_POSITION_INACTIVE';
}
