/**
 * Money formatting — single source of truth.
 *
 * Costa Rica (CRC) is the primary market, so colón/fiat amounts are formatted
 * with the es-CR locale everywhere (₡1.234,56), matching SinpeView. Using en-US
 * for CRC produces the wrong grouping (₡1,234.56) and was the source of
 * screen-to-screen inconsistency.
 *
 * Backend amounts may arrive as decimal *strings* (Go decimal.Decimal
 * serializes to a string in JSON) or as numbers (mock mode); always coerce
 * with toAmount() before doing arithmetic or formatting.
 */

export type CurrencyCode = 'CRC' | 'USD' | 'PAB' | 'GTQ';

/** Locale used for all in-app money formatting (primary market: Costa Rica). */
export const MONEY_LOCALE = 'es-CR';

/** Coerce a backend amount (number | decimal-string | nullish) to a finite number. */
export function toAmount(value: number | string | null | undefined): number {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}

interface FormatOpts {
  /** Force a fixed number of decimals. Default: min 0, max 2 (colón convention). */
  decimals?: number;
  /** Prefix an explicit +/- sign (for ledger rows). */
  signed?: boolean;
}

/**
 * Format a monetary amount for display. Defaults to CRC in the es-CR locale.
 * Pass a currency for multi-country amounts (USD/PAB/GTQ); grouping stays
 * consistent with the app's home locale.
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency: CurrencyCode = 'CRC',
  opts: FormatOpts = {},
): string {
  const amount = toAmount(value);
  const nf = new Intl.NumberFormat(MONEY_LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: opts.decimals ?? 0,
    maximumFractionDigits: opts.decimals ?? 2,
  });
  if (opts.signed) {
    return `${amount < 0 ? '-' : '+'}${nf.format(Math.abs(amount))}`;
  }
  return nf.format(amount);
}

/** Costa Rica colones — the app default. */
export function formatCRC(
  value: number | string | null | undefined,
  opts: FormatOpts = {},
): string {
  return formatMoney(value, 'CRC', opts);
}
