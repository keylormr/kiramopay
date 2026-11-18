// Acceso al almacen seguro del telefono (Keystore en Android, Keychain en iOS,
// via @aparajita/capacitor-secure-storage). Lo usan la sesion
// (secureTokenStore.ts) y la semilla de la billetera propia (billetera/boveda.ts).
//
// El plugin se importa de forma dinamica y solo en el telefono: la capa web nunca
// lo carga y un modulo nativo que falte no puede romper su compilacion.
import type { SecureStoragePlugin } from '@aparajita/capacitor-secure-storage';

/**
 * Usa el plugin adentro y devuelve lo que este contesta, NUNCA el plugin.
 *
 * El plugin es el Proxy que devuelve registerPlugin de Capacitor: responde a
 * CUALQUIER propiedad, "then" incluida. Devolverlo desde una funcion async (o
 * hacerle await) lo trata como una promesa: llama a SecureStorage.then(), esa
 * llamada nunca resuelve y la operacion queda colgada para siempre.
 */
export async function conAlmacen<T>(uso: (almacen: SecureStoragePlugin) => Promise<T>): Promise<T> {
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
  return uso(SecureStorage);
}
