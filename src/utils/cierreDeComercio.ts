import { mensajeDeRechazo } from '@/i18n/mensajesDeError';
import { formatMoney, type CurrencyCode } from './money';

/**
 * Los rechazos del cierre de un comercio, por codigo. Los usan la configuracion
 * del comercio (el dueno) y la vista de administracion: el servidor responde lo
 * mismo a los dos, y los dos tienen que decirlo igual.
 */
const CLAVES_DEL_CIERRE: Readonly<Record<string, string>> = {
  MERCHANT_HAS_BALANCE: 'business_close_err_balance',
  MERCHANT_HAS_PENDING_CHARGES: 'business_close_err_pending',
  CURRENT_PASSWORD_INVALID: 'business_close_err_password',
  CREDENTIALS_INVALID: 'business_close_err_credentials',
  MERCHANT_CLOSE_LOCKED: 'business_close_err_locked',
  DEMO_ACCOUNT: 'business_close_err_demo',
  MERCHANT_CLOSED: 'business_close_err_closed',
  CLOSURE_REASON_REQUIRED: 'merchant_admin_close_err_reason',
};

export interface RechazoDelCierre {
  /** El texto que lee la persona; nunca el del servidor. */
  mensaje: string;
  /** Con MERCHANT_HAS_BALANCE, lo que queda en cada moneda, ya formateado. */
  saldos: string[];
}

export function rechazoDelCierre(
  t: (clave: string) => string,
  error: { code?: string; message?: string; details?: Record<string, unknown> } | undefined,
): RechazoDelCierre {
  return {
    mensaje: mensajeDeRechazo(error, CLAVES_DEL_CIERRE, 'business_close_err_failed', t),
    saldos: error?.code === 'MERCHANT_HAS_BALANCE' ? saldosDelDetalle(error.details) : [],
  };
}

// El detalle trae cada moneda con su monto en unidades menores (centimos). Lo
// que no tenga esa forma se descarta: el texto ya dice que hay saldo.
function saldosDelDetalle(details: Record<string, unknown> | undefined): string[] {
  const lista = Array.isArray(details?.balances) ? (details.balances as unknown[]) : [];
  return lista.flatMap((b) => {
    const saldo = b as { currency?: unknown; amount?: unknown } | null;
    if (!saldo || typeof saldo.currency !== 'string' || typeof saldo.amount !== 'number') return [];
    return [formatMoney(saldo.amount / 100, saldo.currency as CurrencyCode, { decimals: 2 })];
  });
}

/**
 * El rechazo de una hoja de gestion del comercio (locales, catalogo). Si el
 * comercio se cerro con la hoja abierta (desde otro telefono, o lo cerro un
 * administrador), se dice en el idioma de la app; lo demas sigue como estaba.
 */
export function mensajeDeGestion(
  t: (clave: string) => string,
  error: { code?: string; message?: string } | undefined,
): string {
  if (error?.code === 'MERCHANT_CLOSED') return t('business_err_cerrado');
  return error?.message || t('assistant_action_failed');
}
