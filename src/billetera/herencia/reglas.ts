// Las reglas de producto de la boveda de herencia.

/**
 * Tope por boveda mientras no se pruebe en un telefono real: 0,01 BTC.
 * Decision del dueno (2026-11-18). Se cuenta lo confirmado y lo que esta en
 * camino; llenar no deja pasarlo.
 */
export const TOPE_POR_BOVEDA_SATS = 1_000_000;

/** Los plazos que se ofrecen, en bloques (144 por dia). */
export const PLAZOS = [
  { meses: 6, bloques: 26_280 },
  { meses: 12, bloques: 52_560 },
  // El maximo de BIP-68: unos 455 dias.
  { meses: 15, bloques: 65_535 },
] as const;

export const PLAZO_POR_DEFECTO = 52_560;

/** Cuanto se puede poner todavia sin pasar el tope. */
export function cabeEnLaBoveda(confirmadoSats: number, pendienteSats: number): number {
  return Math.max(0, TOPE_POR_BOVEDA_SATS - confirmadoSats - pendienteSats);
}
