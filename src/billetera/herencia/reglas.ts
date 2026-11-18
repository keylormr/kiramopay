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

/**
 * Lo ultimo que la persona movio desde este telefono. Un envio tarda en verse
 * en la red: un llenado sale del saldo bitcoin y puede tardar en llegar, y un
 * "sacar" en la mempool hace que la boveda se vea vacia aunque la transaccion
 * todavia pueda caerse. Mientras tanto la boveda no se puede quitar y lo que va
 * en camino cuenta para el tope.
 */
export interface MovimientoReciente {
  /** Cuando empezo (ISO). */
  en: string;
  /** Si fue un llenado: a que indice de recibir se mando y cuanto. */
  llenado?: { indice: number; sats: number };
}

/** Cuanto se espera despues de mover antes de dar por visto lo que no aparece. */
export const ESPERA_TRAS_MOVER_MS = 24 * 60 * 60 * 1000;

export function movimientoVigente(m: MovimientoReciente | undefined, ahora: number): boolean {
  if (!m) return false;
  const en = Date.parse(m.en);
  // Una fecha ilegible o del futuro no libera nada.
  if (!Number.isFinite(en) || en > ahora) return true;
  return ahora - en < ESPERA_TRAS_MOVER_MS;
}

/**
 * Lo llenado que la red todavia no muestra. Un llenado se ve cuando su
 * direccion ya figura como usada (siguienteRecibir paso de su indice).
 */
export function llenadoSinVer(m: MovimientoReciente | undefined, siguienteRecibir: number, ahora: number): number {
  if (!m?.llenado || !movimientoVigente(m, ahora)) return 0;
  return siguienteRecibir <= m.llenado.indice ? m.llenado.sats : 0;
}

/** El movimiento que queda anotado al empezar un llenado: suma lo que aun no se ve. */
export function anotarLlenado(
  previo: MovimientoReciente | undefined,
  indice: number,
  sats: number,
  ahora: number,
): MovimientoReciente {
  const sinVer = previo?.llenado?.indice === indice ? llenadoSinVer(previo, indice, ahora) : 0;
  return { en: new Date(ahora).toISOString(), llenado: { indice, sats: sinVer + sats } };
}

/** Solo se quita una boveda vacia que nadie movio hace poco. */
export function sePuedeQuitar(totalSats: number, m: MovimientoReciente | undefined, ahora: number): boolean {
  return totalSats === 0 && !movimientoVigente(m, ahora);
}
