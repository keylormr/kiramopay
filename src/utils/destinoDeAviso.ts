/**
 * A que pantalla lleva tocar un aviso.
 *
 * Tocar un aviso, en la campana o en el telefono, solo lo marcaba como leido:
 * el servidor no mandaba con que abrir nada. Ahora el aviso trae en `data` lo
 * que hace falta (migracion 092): el activo de una alerta de precio y el
 * movimiento de un SINPE recibido. Los dos caminos, la campana y el toque del
 * push, deciden aqui, con la misma regla.
 *
 * Un aviso de antes no trae datos: va a la pantalla general de su tipo (Cripto,
 * la actividad). Uno de un tipo sin pantalla no lleva a ningun lado y se queda
 * en solo marcarlo leido, como siempre.
 */

export type DestinoDeAviso =
  | { pantalla: 'cripto'; simbolo?: string }
  | { pantalla: 'movimiento'; id: string }
  | { pantalla: 'actividad' }
  | { pantalla: 'seguridad' };

// Los datos vienen del servidor, pero pasan por el push y por el telefono: se
// aceptan solo con la forma que pueden tener. Un simbolo es corto y
// alfanumerico ("BTC", "USDT"); un movimiento es un id (uuid).
const SIMBOLO = /^[A-Za-z0-9]{1,15}$/;
const ID_MOVIMIENTO = /^[A-Za-z0-9-]{1,64}$/;

function textoValido(valor: unknown, forma: RegExp): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return forma.test(limpio) ? limpio : null;
}

export function destinoDeAviso(
  tipo: string | undefined,
  datos?: Record<string, unknown> | null,
): DestinoDeAviso | null {
  switch (tipo) {
    case 'price_alert': {
      const simbolo = textoValido(datos?.activo, SIMBOLO);
      return simbolo ? { pantalla: 'cripto', simbolo: simbolo.toUpperCase() } : { pantalla: 'cripto' };
    }
    case 'transaction': {
      const id = textoValido(datos?.movimiento, ID_MOVIMIENTO);
      return id ? { pantalla: 'movimiento', id } : { pantalla: 'actividad' };
    }
    case 'security':
      return { pantalla: 'seguridad' };
    default:
      return null;
  }
}

/**
 * El toque de un push en el telefono. Llega por el plugin, con los datos del
 * mensaje de FCM (notification/fcm.go): el tipo en `tipo` y el id del aviso en
 * `aviso`. Devuelve null si el aviso no lleva a ninguna pantalla.
 */
export interface ToqueDeAviso {
  destino: DestinoDeAviso;
  /** El id del aviso guardado, para marcarlo leido. */
  aviso?: string;
}

export function toqueDeAviso(datos: Record<string, unknown> | null | undefined): ToqueDeAviso | null {
  const tipo = typeof datos?.tipo === 'string' ? datos.tipo : undefined;
  const destino = destinoDeAviso(tipo, datos);
  if (!destino) return null;
  const aviso = textoValido(datos?.aviso, ID_MOVIMIENTO) ?? undefined;
  return aviso ? { destino, aviso } : { destino };
}

// El toque puede llegar antes de que exista la pantalla que lo atiende: con la
// app cerrada, el plugin lo entrega al arrancar, a veces con la pantalla de
// ingreso arriba. Como los enlaces (useDeepLinks), queda guardado el ultimo y
// se entrega al primero que se suscribe.
let pendiente: ToqueDeAviso | null = null;
const suscriptores = new Set<(toque: ToqueDeAviso) => void>();

export function publicarToqueDeAviso(toque: ToqueDeAviso): void {
  if (suscriptores.size === 0) {
    pendiente = toque;
    return;
  }
  suscriptores.forEach((fn) => fn(toque));
}

export function suscribirToqueDeAviso(fn: (toque: ToqueDeAviso) => void): () => void {
  suscriptores.add(fn);
  if (pendiente) {
    const toque = pendiente;
    pendiente = null;
    fn(toque);
  }
  return () => {
    suscriptores.delete(fn);
  };
}

/** Solo para pruebas. */
export function reiniciarToquesParaPruebas(): void {
  pendiente = null;
  suscriptores.clear();
}
