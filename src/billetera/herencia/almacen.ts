// Donde se guarda la boveda de herencia: en el almacen seguro del telefono,
// junto a la semilla (ver ../boveda.ts), con la llave de la cuenta. Nunca en el
// servidor de KiramoPay.
//
// Lo guardado es publico para gastar (dos llaves publicas y el plazo), pero
// dice quien es el heredero: por eso va en el almacen seguro y no en
// localStorage. Si el telefono se pierde, la boveda se rehace con el kit del
// heredero (el descriptor) y las 12 palabras del titular.
import { Capacitor } from '@capacitor/core';
import type { SecureStoragePlugin } from '@aparajita/capacitor-secure-storage';
import { plazoValido, type DatosDeLaBoveda } from './descriptor';
import { leerLlave, textoDeLaLlave, type LlaveConOrigen } from './llaves';

const PREFIJO = 'kp_herencia_boveda:';

export interface BovedaGuardada extends DatosDeLaBoveda {
  /** Fecha de creacion (ISO). */
  creada: string;
  /** Como la persona llama a su heredero. Solo en este telefono. */
  nombreDelHeredero?: string;
}

function llaveDe(userId: string): string {
  if (!userId) throw new Error('boveda de herencia sin cuenta');
  return PREFIJO + userId;
}

// El plugin es un Proxy de Capacitor que responde a cualquier propiedad, "then"
// incluida: nunca se devuelve ni se espera el plugin mismo (ver ../boveda.ts).
async function conAlmacen<T>(uso: (almacen: SecureStoragePlugin) => Promise<T>): Promise<T> {
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
  return uso(SecureStorage);
}

interface Guardado {
  v: 1;
  red: 'bitcoin';
  titular: string;
  heredero: string;
  plazo: number;
  creada: string;
  nombre?: string;
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
  };
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

export async function borrarBovedaGuardada(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await conAlmacen(a => a.removeItem(llaveDe(userId)));
}
