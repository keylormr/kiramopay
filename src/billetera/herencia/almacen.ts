// Donde se guarda la boveda de herencia: en el almacen seguro del telefono,
// junto a la semilla (ver ../boveda.ts), con la llave de la cuenta. Nunca en el
// servidor de KiramoPay.
//
// Lo guardado es publico para gastar (dos llaves publicas y el plazo), pero
// dice quien es el heredero: por eso va en el almacen seguro y no en
// localStorage. Si el telefono se pierde, la boveda se rehace con el kit del
// heredero (el descriptor) y las 12 palabras del titular.
import { Capacitor } from '@capacitor/core';
import { conAlmacen } from '@/services/almacenSeguro';
import { plazoValido, type DatosDeLaBoveda } from './descriptor';
import { leerLlave, textoDeLaLlave, type LlaveConOrigen } from './llaves';
import type { MovimientoReciente } from './reglas';

const PREFIJO = 'kp_herencia_boveda:';

export interface BovedaGuardada extends DatosDeLaBoveda {
  /** Fecha de creacion (ISO). */
  creada: string;
  /** Como la persona llama a su heredero. Solo en este telefono. */
  nombreDelHeredero?: string;
  /** Lo ultimo que se movio desde este telefono (ver reglas.ts). */
  movimiento?: MovimientoReciente;
}

function llaveDe(userId: string): string {
  if (!userId) throw new Error('boveda de herencia sin cuenta');
  return PREFIJO + userId;
}

interface Guardado {
  v: 1;
  red: 'bitcoin';
  titular: string;
  heredero: string;
  plazo: number;
  creada: string;
  nombre?: string;
  mov?: MovimientoReciente;
}

export function aTexto(b: BovedaGuardada): string {
  if (b.red !== 'bitcoin') throw new Error('solo se guarda la red principal');
  const guardado: Guardado = {
    v: 1,
    red: 'bitcoin',
    titular: textoDeLaLlave(b.titular),
    heredero: textoDeLaLlave(b.heredero),
    plazo: b.plazoBloques,
    creada: b.creada,
    ...(b.nombreDelHeredero ? { nombre: b.nombreDelHeredero } : {}),
    ...(b.movimiento ? { mov: b.movimiento } : {}),
  };
  return JSON.stringify(guardado);
}

/** Lee lo guardado. Algo que no se entiende es un error, nunca una boveda vacia. */
export function deTexto(texto: string): BovedaGuardada {
  const g = JSON.parse(texto) as Partial<Guardado>;
  if (g.v !== 1 || g.red !== 'bitcoin' || typeof g.titular !== 'string' || typeof g.heredero !== 'string') {
    throw new Error('boveda guardada ilegible');
  }
  if (typeof g.plazo !== 'number' || !plazoValido(g.plazo) || typeof g.creada !== 'string') {
    throw new Error('boveda guardada ilegible');
  }
  const titular: LlaveConOrigen = leerLlave(g.titular, 'bitcoin');
  const heredero: LlaveConOrigen = leerLlave(g.heredero, 'bitcoin');
  return {
    red: 'bitcoin',
    titular,
    heredero,
    plazoBloques: g.plazo,
    creada: g.creada,
    ...(typeof g.nombre === 'string' && g.nombre ? { nombreDelHeredero: g.nombre } : {}),
    ...(g.mov !== undefined ? { movimiento: movimientoDe(g.mov) } : {}),
  };
}

// Un movimiento ilegible no se descarta: queda vigente (fecha invalida, ver
// movimientoVigente), que deja la boveda sin quitar en vez de soltarla.
function movimientoDe(m: unknown): MovimientoReciente {
  const x = (m ?? {}) as Partial<MovimientoReciente>;
  const en = typeof x.en === 'string' ? x.en : '';
  const l = x.llenado;
  const llenado = l && Number.isInteger(l.indice) && l.indice >= 0 && Number.isInteger(l.sats) && l.sats > 0
    ? { indice: l.indice, sats: l.sats }
    : undefined;
  return llenado ? { en, llenado } : { en };
}

export type BovedaLeida = { estado: 'hay'; boveda: BovedaGuardada } | { estado: 'no-hay' } | { estado: 'error' };

export async function leerBovedaGuardada(userId: string): Promise<BovedaLeida> {
  if (!Capacitor.isNativePlatform()) return { estado: 'no-hay' };
  try {
    const texto = await conAlmacen(a => a.getItem(llaveDe(userId)));
    if (typeof texto !== 'string' || !texto) return { estado: 'no-hay' };
    return { estado: 'hay', boveda: deTexto(texto) };
  } catch {
    return { estado: 'error' };
  }
}

/** Guarda la boveda. No pisa otra: la que ya existe se borra primero, a proposito. */
export async function guardarBoveda(userId: string, b: BovedaGuardada): Promise<void> {
  if (!Capacitor.isNativePlatform()) throw new Error('la boveda de herencia solo existe en la app');
  const ya = await conAlmacen(a => a.getItem(llaveDe(userId)));
  if (typeof ya === 'string' && ya) throw new Error('esta cuenta ya tiene una boveda de herencia');
  await conAlmacen(a => a.setItem(llaveDe(userId), aTexto(b)));
}

/**
 * Anota lo que se esta por mover. Se llama ANTES de mandar: si la respuesta del
 * envio se pierde, la marca ya esta y la boveda no se puede quitar a ciegas.
 */
export async function anotarMovimiento(
  userId: string,
  nuevo: (previo: MovimientoReciente | undefined) => MovimientoReciente,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) throw new Error('la boveda de herencia solo existe en la app');
  const texto = await conAlmacen(a => a.getItem(llaveDe(userId)));
  if (typeof texto !== 'string' || !texto) throw new Error('no hay boveda que anotar');
  const b = deTexto(texto);
  await conAlmacen(a => a.setItem(llaveDe(userId), aTexto({ ...b, movimiento: nuevo(b.movimiento) })));
}

export async function borrarBovedaGuardada(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await conAlmacen(a => a.removeItem(llaveDe(userId)));
}
