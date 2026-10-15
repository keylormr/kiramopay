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
 * Uno por envio: por persona, por ambito (el envio SINPE, el retiro de cada
 * comercio) y por firma. Era uno por ambito, y otro envio en medio —otra
 * tarjeta del asistente, un SINPE desde otra pantalla— reemplazaba la llave
 * del que se corto: reintentarlo con los mismos datos lo mandaba dos veces.
 * Cada ambito guarda los TOPE usados mas recientemente: reintentar uno lo
 * renueva, y pasado el tope se olvida el que lleva mas sin usarse.
 * Se suelta cuando la operacion salio, cuando el servidor contesta que ya
 * estaba hecha o que la llave es de otra, cuando se cancela el segundo factor
 * (el servidor lo pide antes de crear nada), y al cerrar sesion. Que una llave
 * vieja no se trague una operacion nueva identica lo resuelve el servidor, que
 * marca la repeticion: la pantalla lo dice y suelta la llave.
 *
 * La firma va tal cual (en SINPE, el telefono y el monto): es lo mismo que el
 * historial SINPE ya guarda en este aparato, y se borra con el al cerrar
 * sesion.
 *
 * No importa ningun store: `limpiarDatosDeUsuario` lo llama, y el store de la
 * sesion llama a esa limpieza. Quien lo usa le pasa la persona.
 */

const CLAVE = 'kiramopay-intentos-pendientes';

// Los pendientes que guarda cada ambito. Ademas de lo que se corto quedan las
// llaves de los rechazos (saldo, tope diario, un numero que no es de
// KiramoPay): no se sueltan porque la pantalla no sabe si el servidor llego a
// hacer algo. Se van al salir bien, al cerrar sesion o, pasado el tope, la que
// lleva mas sin usarse.
const TOPE = 10;

interface Intento {
  firma: string;
  llave: string;
}
// Por ambito, del que lleva mas sin usarse al ultimo usado.
type Intentos = Record<string, Intento[]>;

// Lo que se lee del almacenamiento puede venir de otra version de la app o
// estar tocado: se queda solo lo que tiene la forma de ahora.
function sanear(datos: unknown): Intentos {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return {};
  const limpios: Intentos = {};
  for (const [id, lista] of Object.entries(datos as Record<string, unknown>)) {
    if (!Array.isArray(lista)) continue;
    const validos = lista.filter(
      (i): i is Intento =>
        !!i &&
        typeof i === 'object' &&
        typeof (i as Intento).firma === 'string' &&
        typeof (i as Intento).llave === 'string' &&
        (i as Intento).llave !== '',
    );
    if (validos.length) limpios[id] = validos;
  }
  return limpios;
}

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
    return sanear(JSON.parse(crudo));
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
 * firma), aunque en medio haya habido otros; una nueva si no hay pendiente
 * con esa firma.
 */
export function llaveDelIntento(
  persona: string,
  ambito: string,
  firma: string,
  nueva: () => string,
): string {
  const intentos = leer();
  const id = idDe(persona, ambito);
  const lista = intentos[id] ?? [];
  const actual = lista.find((i) => i.firma === firma);
  if (actual) {
    // Reintentarlo lo renueva: el tope olvida el que lleva mas sin usarse, no
    // el mas viejo. Si no, diez intentos distintos despues se llevaban la
    // llave del envio cortado aunque se acabara de reintentar.
    if (lista[lista.length - 1] !== actual) {
      escribir({ ...intentos, [id]: [...lista.filter((i) => i !== actual), actual] });
    }
    return actual.llave;
  }
  const llave = nueva();
  escribir({ ...intentos, [id]: [...lista, { firma, llave }].slice(-TOPE) });
  return llave;
}

/**
 * Suelta el intento de esa llave: lo siguiente con su firma es otra operacion
 * y lleva otra llave. Los demas pendientes del ambito se quedan, y la
 * respuesta tardia de un intento no suelta el que vino despues.
 */
export function soltarIntento(persona: string, ambito: string, llave: string): void {
  const intentos = leer();
  const id = idDe(persona, ambito);
  const lista = intentos[id];
  if (!lista || !lista.some((i) => i.llave === llave)) return;
  const quedan = lista.filter((i) => i.llave !== llave);
  const resto = { ...intentos };
  if (quedan.length) resto[id] = quedan;
  else delete resto[id];
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
