// Saldo total de la persona: UNA sola cuenta para Inicio y Perfil.
//
// Antes cada pantalla armaba el suyo. Inicio rotulaba "Balance total" pero el
// numero grande era solo la cuenta base; Perfil sumaba todo en dolares con otro
// formato; y las dos contaban una tasa faltante como 1 (`rateToUsd || 1`), es
// decir colones como si fueran dolares: unas 455 veces de mas. Un total que
// puede ser falso por un factor de cientos es peor que no tener total.

import type { Account } from '@/types';
import { formatMoney, type CurrencyCode } from './money';

/** Lo que se muestra cuando falta algun dato para convertir: no es un cero. */
export const SALDO_SIN_DATO = '—';

export interface SaldoTotal {
  /** Todas las cuentas en moneda, en la moneda base. null: falta una tasa. */
  enBase: number | null;
  /** Todas las cuentas en moneda, en dolares. null: falta una tasa. */
  enUsd: number | null;
}

const tasaValida = (tasa: number | undefined): tasa is number =>
  typeof tasa === 'number' && Number.isFinite(tasa) && tasa > 0;

/**
 * Suma las cuentas en moneda (las de cripto tienen su propia cartera) y las
 * lleva a la moneda base. `rateToUsd` es cuantos dolares vale UNA unidad de la
 * moneda de la cuenta.
 *
 * Una cuenta con saldo y sin tasa valida deja el total en null: no se adivina.
 * Una cuenta en cero no aporta nada, asi que tampoco necesita tasa.
 */
export function saldoTotal(cuentas: Account[], monedaBase: string): SaldoTotal {
  const enMoneda = cuentas.filter((c) => c.type !== 'crypto' && c.balance !== 0);

  const baseCuenta = cuentas.find((c) => c.ccy === monedaBase && c.type !== 'crypto');
  // Dolares por unidad de la moneda base. En dolares vale 1 sin mirar cuentas.
  const tasaBase = monedaBase === 'USD' ? 1 : baseCuenta?.rateToUsd;

  let usd: number | null = 0;
  let base: number | null = 0;
  for (const c of enMoneda) {
    const mismaMoneda = c.ccy === monedaBase;
    const tasa = c.ccy === 'USD' ? 1 : c.rateToUsd;

    if (tasaValida(tasa)) {
      if (usd !== null) usd += c.balance * tasa;
    } else {
      usd = null;
    }

    if (mismaMoneda) {
      // La moneda base no se convierte: su saldo cuenta tal cual.
      if (base !== null) base += c.balance;
    } else if (tasaValida(tasa) && tasaValida(tasaBase)) {
      if (base !== null) base += (c.balance * tasa) / tasaBase;
    } else {
      base = null;
    }
  }

  return { enBase: base, enUsd: usd };
}

/**
 * El total tal como se pinta: con el formato de montos de la app (miles con
 * coma, dos decimales) o el guion cuando no hay dato.
 */
export function formatearSaldoTotal(monto: number | null, moneda: string): string {
  if (monto === null) return SALDO_SIN_DATO;
  return formatMoney(monto, moneda as CurrencyCode, { decimals: 2 });
}
