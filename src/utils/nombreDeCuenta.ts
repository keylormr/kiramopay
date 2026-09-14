import type { Account } from '@/types';

/**
 * Nombre visible de una cuenta de la billetera.
 *
 * El adaptador HTTP arma las cuentas con `name: 'Cuenta Colones'` y
 * `'Cuenta Dólares'`: una capa de datos no conoce el idioma de la persona, y con
 * la app en ingles las tarjetas de Inicio seguian diciendo "Cuenta Colones".
 * El nombre se resuelve aqui, por moneda, con el diccionario activo. Una moneda
 * sin traduccion propia conserva el nombre que trae la cuenta.
 */
export function nombreDeCuenta(cuenta: Pick<Account, 'ccy' | 'name'>, t: (clave: string) => string): string {
  if (cuenta.ccy === 'CRC') return t('account_name_crc');
  if (cuenta.ccy === 'USD') return t('account_name_usd');
  return cuenta.name;
}
