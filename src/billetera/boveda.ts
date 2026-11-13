// Donde vive la semilla de la billetera propia: el almacen seguro del telefono
// (Keystore en Android, Keychain en iOS, via @aparajita/capacitor-secure-storage,
// el mismo que guarda la sesion en secureTokenStore.ts).
//
// Reglas:
// - Solo en la app. En la web no hay almacen seguro: guardar las 12 palabras en
//   localStorage las dejaria a la vista de cualquier script. La web no ofrece
//   la billetera propia (ver BilleteraPropia.tsx).
// - Una semilla por cuenta de KiramoPay. El mismo telefono puede entrar con
//   varias cuentas; la llave del almacen lleva el id de la cuenta para que
//   ninguna vea la billetera de otra.
// - Leerla pide la huella o el rostro cuando el telefono los tiene. Es una
//   barrera de la app, no del cifrado: el almacen ya esta cifrado por el
//   sistema y abre con el telefono desbloqueado.
import { Capacitor } from '@capacitor/core';
import type { SecureStoragePlugin } from '@aparajita/capacitor-secure-storage';
import { biometricService } from '@/services/biometric';
import { normalizarSemilla, semillaValida } from './semilla';

const PREFIJO = 'kp_billetera_semilla:';

/** Si este dispositivo puede tener billetera propia. */
export function bovedaDisponible(): boolean {
  return Capacitor.isNativePlatform();
}

function llaveDe(userId: string): string {
  if (!userId) throw new Error('billetera propia sin cuenta');
  return PREFIJO + userId;
}

// El plugin es un Proxy de Capacitor que responde a CUALQUIER propiedad, "then"
// incluida: devolverlo desde una funcion async (o hacerle await) lo trata como
// promesa, llama a SecureStorage.then() y la operacion queda colgada. Por eso
// nunca se devuelve el plugin: se usa adentro y se devuelve lo que contesta.
async function conAlmacen<T>(uso: (almacen: SecureStoragePlugin) => Promise<T>): Promise<T> {
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
  return uso(SecureStorage);
}

export type EstadoDeLaBilletera = 'hay' | 'no-hay' | 'error';

/**
 * Si esta cuenta ya tiene billetera propia en este telefono. No pide la huella.
 * 'error' es que el almacen no contesto, y NO equivale a no tener billetera:
 * ofrecer crear una en ese caso podria tapar la que ya existe.
 */
export async function estadoDeLaBilletera(userId: string): Promise<EstadoDeLaBilletera> {
  if (!bovedaDisponible()) return 'no-hay';
  try {
    const guardada = await conAlmacen(a => a.getItem(llaveDe(userId)));
    return typeof guardada === 'string' && guardada.length > 0 ? 'hay' : 'no-hay';
  } catch {
    return 'error';
  }
}

/** Ya hay otra semilla guardada para esta cuenta: no se escribe encima. */
export class BilleteraYaGuardada extends Error {
  constructor() {
    super('esta cuenta ya tiene otra billetera en este telefono');
  }
}

/**
 * Guarda la semilla de esta cuenta. Rechaza una semilla que no es valida y
 * nunca reemplaza otra: perderia el unico acceso a ese dinero. Si el almacen
 * no se puede leer, tampoco escribe.
 */
export async function guardarSemilla(userId: string, semilla: string): Promise<void> {
  if (!bovedaDisponible()) throw new Error('la billetera propia solo existe en la app');
  const limpia = normalizarSemilla(semilla);
  if (!semillaValida(limpia)) throw new Error('semilla invalida');
  const guardada = await conAlmacen(a => a.getItem(llaveDe(userId)));
  if (typeof guardada === 'string' && guardada.length > 0) {
    if (guardada !== limpia) throw new BilleteraYaGuardada();
    return;
  }
  await conAlmacen(a => a.setItem(llaveDe(userId), limpia));
}

export type ResultadoApertura =
  | { estado: 'abierta'; semilla: string }
  | { estado: 'sin-billetera' }
  | { estado: 'cancelada' }
  /** El almacen no contesto: la billetera puede seguir ahi. */
  | { estado: 'error' };

/**
 * Devuelve la semilla despues de la huella o el rostro. `razon` es el texto
 * del dialogo del sistema, ya traducido. Si el telefono no tiene biometria
 * configurada, abre con el telefono desbloqueado y la sesion de la app.
 */
export async function abrirSemilla(userId: string, razon: string): Promise<ResultadoApertura> {
  if (!bovedaDisponible()) return { estado: 'sin-billetera' };
  const bio = await biometricService.checkAvailability();
  if (bio.isAvailable) {
    const r = await biometricService.authenticate(razon);
    if (!r.success) return { estado: 'cancelada' };
  }
  let guardada: string | null;
  try {
    guardada = await conAlmacen(a => a.getItem(llaveDe(userId)));
  } catch {
    return { estado: 'error' };
  }
  if (!guardada) return { estado: 'sin-billetera' };
  return { estado: 'abierta', semilla: guardada };
}

/** Confirma la identidad antes de mover dinero. Sin biometria, deja seguir. */
export async function confirmarConHuella(razon: string): Promise<boolean> {
  if (!bovedaDisponible()) return false;
  const bio = await biometricService.checkAvailability();
  if (!bio.isAvailable) return true;
  return (await biometricService.authenticate(razon)).success;
}

/**
 * Borra la semilla de esta cuenta de este telefono. El dinero sigue en la red:
 * se recupera restaurando con las 12 palabras. Sin ellas, se pierde.
 */
export async function borrarSemilla(userId: string): Promise<void> {
  if (!bovedaDisponible()) return;
  await conAlmacen(a => a.removeItem(llaveDe(userId)));
}
