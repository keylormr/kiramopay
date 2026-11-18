// Como esta la boveda: cuanto tiene, cuanto falta para que el heredero pueda
// gastar y a que direcciones van el proximo llenado y la proxima renovacion.
import type { DatosDeLaBoveda } from './descriptor';
import { direccionDeLaBoveda, type Rama } from './direcciones';
import type { FuenteDeLaRed } from './esplora';
import type { MonedaDeLaBoveda } from './transacciones';

/** Direcciones seguidas sin usar para dejar de buscar en una rama. */
export const HUECO = 5;
/** Tope de direcciones por rama: nadie renueva cientos de veces. */
const MAXIMO_POR_RAMA = 500;

/** Los avisos: a la mitad del plazo, al 80 % y cuando el heredero ya puede gastar. */
export type NivelDelPlazo = 'tranquilo' | 'renovar-pronto' | 'urgente' | 'vencido';

export interface PlazoDeLaBoveda {
  /** Altura del bloque de la moneda confirmada mas vieja: la primera que vence. */
  alturaDeLaMasVieja: number;
  bloquesTranscurridos: number;
  /**
   * Bloques que faltan minar para que una transaccion del heredero pueda entrar
   * en el bloque siguiente. 0 o menos: ya puede.
   */
  bloquesQueFaltan: number;
  /** Lo transcurrido del plazo, de 0 a 1 (o mas, si ya vencio). */
  fraccion: number;
  nivel: NivelDelPlazo;
}

/**
 * BIP-68: una entrada con nSequence = N entra en un bloque de altura H si
 * H >= altura de la moneda + N. La mempool lo mide contra el bloque siguiente
 * (altura actual + 1).
 */
export function plazoDe(alturaDeLaMoneda: number, alturaActual: number, plazoBloques: number): PlazoDeLaBoveda {
  const bloquesTranscurridos = Math.max(0, alturaActual - alturaDeLaMoneda + 1);
  const bloquesQueFaltan = alturaDeLaMoneda + plazoBloques - (alturaActual + 1);
  const fraccion = bloquesTranscurridos / plazoBloques;
  const nivel: NivelDelPlazo =
    bloquesQueFaltan <= 0 ? 'vencido' : fraccion >= 0.8 ? 'urgente' : fraccion >= 0.5 ? 'renovar-pronto' : 'tranquilo';
  return { alturaDeLaMasVieja: alturaDeLaMoneda, bloquesTranscurridos, bloquesQueFaltan, fraccion, nivel };
}

/** Un bloque cada 10 minutos en promedio: 144 por dia. */
export const BLOQUES_POR_DIA = 144;

export function diasAproximados(bloques: number): number {
  return Math.max(0, Math.ceil(bloques / BLOQUES_POR_DIA));
}

export interface EstadoDeLaBoveda {
  monedas: MonedaDeLaBoveda[];
  confirmadoSats: number;
  /** Lo que esta en camino (en la mempool): su plazo empieza al confirmarse. */
  pendienteSats: number;
  altura: number;
  /** Indice de la proxima direccion para llenar (rama 0). */
  siguienteRecibir: number;
  /** Indice de la proxima direccion para renovar (rama 1). */
  siguienteCambio: number;
  /** null si no hay monedas confirmadas. */
  plazo: PlazoDeLaBoveda | null;
}

async function recorrerRama(datos: DatosDeLaBoveda, rama: Rama, red: FuenteDeLaRed) {
  const monedas: MonedaDeLaBoveda[] = [];
  let ultimaUsada = -1;
  for (let desde = 0; desde < MAXIMO_POR_RAMA && desde <= ultimaUsada + HUECO; desde += HUECO) {
    const indices = Array.from({ length: HUECO }, (_, k) => desde + k);
    const usos = await Promise.all(indices.map(i => red.usoDeDireccion(direccionDeLaBoveda(datos, rama, i).direccion)));
    usos.forEach((uso, k) => {
      if (!uso.usada) return;
      ultimaUsada = Math.max(ultimaUsada, indices[k]);
      for (const m of uso.monedas) monedas.push({ ...m, rama, indice: indices[k] });
    });
  }
  return { monedas, siguiente: ultimaUsada + 1 };
}

/** Lee la boveda en la red. Falla entera si una consulta falla: nunca muestra un saldo a medias. */
export async function leerEstado(datos: DatosDeLaBoveda, red: FuenteDeLaRed): Promise<EstadoDeLaBoveda> {
  const [recibir, cambio, altura] = await Promise.all([
    recorrerRama(datos, 0, red),
    recorrerRama(datos, 1, red),
    red.altura(),
  ]);
  const monedas = [...recibir.monedas, ...cambio.monedas];
  const confirmadas = monedas.filter((m): m is MonedaDeLaBoveda & { altura: number } => m.altura !== null);
  const confirmadoSats = confirmadas.reduce((s, m) => s + m.sats, 0);
  const pendienteSats = monedas.filter(m => m.altura === null).reduce((s, m) => s + m.sats, 0);
  const masVieja = confirmadas.length ? Math.min(...confirmadas.map(m => m.altura)) : null;
  return {
    monedas,
    confirmadoSats,
    pendienteSats,
    altura,
    siguienteRecibir: recibir.siguiente,
    siguienteCambio: cambio.siguiente,
    plazo: masVieja === null ? null : plazoDe(masVieja, altura, datos.plazoBloques),
  };
}
