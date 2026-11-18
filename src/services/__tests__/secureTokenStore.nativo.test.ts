import { describe, expect, it, vi } from 'vitest';

// En el telefono el plugin del almacen seguro NO es un objeto comun: es el Proxy
// que devuelve registerPlugin de Capacitor, que responde a CUALQUIER propiedad,
// "then" incluida (@capacitor/core, createPluginMethodWrapper). Hacerle await,
// o devolverlo desde una funcion async, lo trata como una promesa: llama a
// SecureStorage.then(resolve, reject), esa llamada nunca resuelve y la
// operacion queda colgada para siempre. Este doble se comporta igual.
const almacen = vi.hoisted(() => {
  const datos = new Map<string, string>();
  const metodos: Record<string, (...args: string[]) => Promise<unknown>> = {
    getItem: async llave => datos.get(llave) ?? null,
    setItem: async (llave, valor) => { datos.set(llave, valor); },
    removeItem: async llave => { datos.delete(llave); },
  };
  const proxy = new Proxy({}, {
    get: (_blanco, propiedad) => (propiedad === 'then' ? (_resolver: unknown, _rechazar: unknown) => undefined : metodos[String(propiedad)]),
  });
  return { datos, proxy };
});
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: almacen.proxy }));

import { secureTokenStore } from '../secureTokenStore';

/** Una operacion colgada no lanza nada: sin este limite la prueba esperaria hasta el tiempo maximo. */
function conLimite<T>(operacion: Promise<T>): Promise<T> {
  return Promise.race([
    operacion,
    new Promise<never>((_resolver, rechazar) => setTimeout(() => rechazar(new Error('se colgo esperando al plugin')), 400)),
  ]);
}

describe('secureTokenStore en el telefono, con el plugin como Proxy de Capacitor', () => {
  it('guarda, lee y borra el token sin colgarse', async () => {
    await conLimite(secureTokenStore.setRefreshToken('token-de-prueba'));
    expect(almacen.datos.get('kp_refresh')).toBe('token-de-prueba');

    expect(await conLimite(secureTokenStore.getRefreshToken())).toBe('token-de-prueba');

    await conLimite(secureTokenStore.setRefreshToken(null));
    expect(almacen.datos.has('kp_refresh')).toBe(false);
    expect(await conLimite(secureTokenStore.getRefreshToken())).toBeNull();
  });

  it('clear() borra el token sin colgarse', async () => {
    almacen.datos.set('kp_refresh', 'otro-token');
    await conLimite(secureTokenStore.clear());
    expect(almacen.datos.has('kp_refresh')).toBe(false);
  });
});
