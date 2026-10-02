/**
 * El intento pendiente de una operacion de dinero: lo que se envia (su firma)
 * y la llave de idempotencia con que viajo.
 *
 * La llave se conserva mientras no se sabe que paso. Si la red se corta sin
 * traer la respuesta, el envio pudo haber salido, y el reintento con los mismos
 * datos tiene que llevar la MISMA llave para que el servidor conteste con aquel
 * envio en vez de hacer otro. Guardada en la pantalla se perdia al cambiar de
 * pestana (la app monta una sola vista por pestana), al bloquearse la app o al
 * recargarla, y el reintento mandaba la plata dos veces justo despues de que la
 * pantalla prometiera que no. Aqui sobrevive a las tres: vive en localStorage,
 * y en memoria cuando el almacenamiento no esta disponible.
 *
 * Uno por persona y por ambito (el envio SINPE, el retiro de cada comercio):
 * empezar otra operacion en el mismo ambito lo reemplaza. Se suelta cuando la
 * operacion salio, cuando el servidor contesta que ya estaba hecha o que la
 * llave es de otra, y al cerrar sesion. Que una llave vieja no se trague una
 * operacion nueva identica lo resuelve el servidor, que marca la repeticion:
 * la pantalla lo dice y suelta la llave.
 *
 * La firma va tal cual (en SINPE, el telefono y el monto): es lo mismo que el
 * historial SINPE ya guarda en este aparato, y se borra con el al cerrar
 * sesion.
 *
 * No importa ningun store: `limpiarDatosDeUsuario` lo llama, y el store de la
 * sesion llama a esa limpieza. Quien lo usa le pasa la persona.
 */

const CLAVE = 'kiramopay-intentos-pendientes';

interface Intento {
  firma: string;
  llave: string;
}
type Intentos = Record<string, Intento>;

// El espejo en memoria: es lo que se lee cuando el almacenamiento falla, y
// siempre tiene la ultima escritura de esta carga de la app.
let enMemoria: Intentos = {};
let soloEnMemoria = false;

function leer(): Intentos {
  if (soloEnMemoria) return enMemoria;
  let crudo: string | null;
  try {
    crudo = localStorage.getItem(CLAVE);
  } catch {
    soloEnMemoria = true;
    return enMemoria;
  }
  if (!crudo) return {};
  try {
    const datos: unknown = JSON.parse(crudo);
    return datos && typeof datos === 'object' && !Array.isArray(datos) ? (datos as Intentos) : {};
  } catch {
    // Un valor ilegible no es de nadie: la siguiente escritura lo pisa.
    return {};
  }
}

function escribir(intentos: Intentos): void {
  enMemoria = intentos;
  if (soloEnMemoria) return;
  try {
    if (Object.keys(intentos).length === 0) localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, JSON.stringify(intentos));
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): sigue en memoria, que
    // igual sobrevive a cambiar de pestana y al bloqueo.
    soloEnMemoria = true;
  }
}

const idDe = (persona: string, ambito: string) => `${persona}|${ambito}`;

/**
 * La llave del intento: la misma mientras se reintente lo mismo (la misma
 * firma), y una nueva —que reemplaza a la anterior— si cambio.
 */
export function llaveDelIntento(persona: string, ambito: string, firma: string, nueva: () => string): string {
  const intentos = leer();
  const id = idDe(persona, ambito);
  const actual = intentos[id];
  if (actual && actual.firma === firma && typeof actual.llave === 'string' && actual.llave) {
    return actual.llave;
  }
  const llave = nueva();
  escribir({ ...intentos, [id]: { firma, llave } });
  return llave;
}

/**
 * Suelta el intento: lo siguiente es otra operacion y lleva otra llave. Con
 * `llave`, solo si el intento sigue siendo el de esa llave: la respuesta tardia
 * de un intento no suelta el que vino despues.
 */
export function soltarIntento(persona: string, ambito: string, llave?: string): void {
  const intentos = leer();
  const id = idDe(persona, ambito);
  const actual = intentos[id];
  if (!actual || (llave !== undefined && actual.llave !== llave)) return;
  const resto = { ...intentos };
  delete resto[id];
  escribir(resto);
}

/** Al cerrar sesion: ningun intento sobrevive a la sesion de quien lo hizo. */
export function olvidarIntentos(): void {
  enMemoria = {};
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // Sin almacenamiento no hay nada escrito que borrar.
  }
}
