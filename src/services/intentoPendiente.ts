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
 * Y sobrevive a cerrar sesion. El servidor corta la sesion a los 30 minutos
 * sin uso, y el corte que deja un envio sin respuesta es justo lo que puede
 * dejar la app quieta ese rato: olvidar la llave al salir hacia que volver a
 * entrar y reintentar lo mandara otra vez. Dura un dia desde su ultimo uso. Un
 * reintento al dia siguiente cuenta para el tope de ese dia: el servidor no
 * completa la fila sin asiento de un intento de otro dia, abre una de hoy.
 *
 * Uno por envio: por persona, por ambito (el envio SINPE, el retiro de cada
 * comercio) y por firma. Era uno por ambito, y otro envio en medio —otra
 * tarjeta del asistente, un SINPE desde otra pantalla— reemplazaba la llave
 * del que se corto: reintentarlo con los mismos datos lo mandaba dos veces.
 * Cada ambito guarda los TOPE usados mas recientemente: reintentar uno lo
 * renueva, y pasado el tope se olvida el que lleva mas sin usarse.
 * Se suelta cuando la operacion salio, cuando el servidor contesta que ya
 * estaba hecha o que la llave es de otra, y cuando se cancela el segundo
 * factor (el servidor lo pide antes de crear nada). Que una llave vieja no se
 * trague una operacion nueva identica lo resuelve el servidor, que marca la
 * repeticion: la pantalla lo dice y suelta la llave.
 *
 * Como queda en el aparato despues de salir, lo guardado no dice de quien es,
 * a que numero ni cuanto: la persona, el ambito y la firma (en SINPE, el
 * telefono y el monto) van como un resumen. La llave va tal cual: es al azar,
 * aunque algunas pantallas le ponen un prefijo con el tipo de operacion (el
 * retiro del comercio, `mwd:`). El resumen no es cifrado —se calcula en la app
 * y cualquiera puede repetirlo—: alcanza para que no se lea a simple vista, y
 * como la persona va adentro, probar numeros y montos exige conocer su id. Al
 * cerrar sesion se poda lo vencido y la forma de antes (ver podarIntentos).
 *
 * No importa ningun store. Quien lo usa le pasa la persona.
 */

const CLAVE = 'kiramopay-intentos-pendientes';

// Los pendientes que guarda cada ambito. Ademas de lo que se corto quedan las
// llaves de los rechazos (saldo, tope diario, un numero que no es de
// KiramoPay): no se sueltan porque la pantalla no sabe si el servidor llego a
// hacer algo. Se van al salir bien, al dia sin usarse (VIGENCIA) o, pasado el
// tope, la que lleva mas sin usarse.
const TOPE = 10;

// Un dia desde el ultimo uso. Alcanza para reintentar despues de volver a
// entrar, y lo que nadie reintento no se queda para siempre en el aparato.
const VIGENCIA = 24 * 60 * 60 * 1000;

interface Intento {
  // El resumen de persona, ambito y firma.
  f: string;
  // La llave, tal cual.
  k: string;
  // Su ultimo uso, en milisegundos (Date.now()).
  t: number;
}
// Por resumen de persona y ambito, del que lleva mas sin usarse al ultimo usado.
type Intentos = Record<string, Intento[]>;

// cyrb53, de bryc (dominio publico): un resumen de 53 bits, sincronico, como
// lo pide quien arma la llave en el momento de enviar.
function resumen(...partes: string[]): string {
  const texto = partes.join('\u0000');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// Lo que se lee del almacenamiento puede venir de otra version de la app o
// estar tocado: se queda solo lo que tiene la forma de ahora. La de antes, con
// la persona y la firma legibles, no la tiene, y la siguiente escritura la
// borra.
function sanear(datos: unknown): Intentos {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return {};
  const limpios: Intentos = {};
  for (const [id, lista] of Object.entries(datos as Record<string, unknown>)) {
    if (!Array.isArray(lista)) continue;
    const validos = lista.filter(
      (i): i is Intento =>
        !!i &&
        typeof i === 'object' &&
        typeof (i as Intento).f === 'string' &&
        typeof (i as Intento).k === 'string' &&
        (i as Intento).k !== '' &&
        Number.isFinite((i as Intento).t),
    );
    if (validos.length) limpios[id] = validos;
  }
  return limpios;
}

// Sin los vencidos. Uno fechado en el futuro —el reloj del aparato se atraso
// despues— se fecha de nuevo en el ahora: descartarlo perdia la llave de un
// envio cortado, y con su fecha vieja no venceria nunca.
function vigentes(intentos: Intentos, ahora: number): Intentos {
  const quedan: Intentos = {};
  for (const [id, lista] of Object.entries(intentos)) {
    const validos = lista
      .filter((i) => ahora - i.t <= VIGENCIA)
      .map((i) => (i.t > ahora ? { ...i, t: ahora } : i));
    if (validos.length) quedan[id] = validos;
  }
  return quedan;
}

// El espejo en memoria: es lo que se lee cuando el almacenamiento falla, y
// siempre tiene la ultima escritura de esta carga de la app.
let enMemoria: Intentos = {};
let soloEnMemoria = false;

function leerGuardado(): Intentos {
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

// Lo vigente de todas las personas: lo que se escriba a partir de aqui ya no
// lleva los vencidos de nadie.
const leer = (ahora: number) => vigentes(leerGuardado(), ahora);

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

/**
 * La llave del intento: la misma mientras se reintente lo mismo (la misma
 * firma), aunque en medio haya habido otros; una nueva si no hay pendiente
 * vigente con esa firma.
 */
export function llaveDelIntento(
  persona: string,
  ambito: string,
  firma: string,
  nueva: () => string,
): string {
  const ahora = Date.now();
  const intentos = leer(ahora);
  const id = resumen(persona, ambito);
  const f = resumen(persona, ambito, firma);
  const lista = intentos[id] ?? [];
  const actual = lista.find((i) => i.f === f);
  // Reintentarlo lo renueva: el plazo vuelve a contar desde ahora, y el tope
  // olvida el que lleva mas sin usarse, no el mas viejo. Si no, diez intentos
  // distintos despues se llevaban la llave del envio cortado aunque se acabara
  // de reintentar.
  const llave = actual ? actual.k : nueva();
  const otros = lista.filter((i) => i !== actual);
  escribir({ ...intentos, [id]: [...otros, { f, k: llave, t: ahora }].slice(-TOPE) });
  return llave;
}

/**
 * Deja en el aparato solo lo vigente, con la forma de ahora. Lo vencido y la
 * forma de antes, con la persona y la firma legibles, se iban recien con la
 * siguiente escritura; al cerrar sesion no tienen por que esperar a que alguien
 * vuelva a enviar algo.
 */
export function podarIntentos(): void {
  escribir(leer(Date.now()));
}

/**
 * Suelta el intento de esa llave: lo siguiente con su firma es otra operacion
 * y lleva otra llave. Los demas pendientes del ambito se quedan, y la
 * respuesta tardia de un intento no suelta el que vino despues.
 */
export function soltarIntento(persona: string, ambito: string, llave: string): void {
  const intentos = leer(Date.now());
  const id = resumen(persona, ambito);
  const lista = intentos[id];
  if (!lista || !lista.some((i) => i.k === llave)) return;
  const quedan = lista.filter((i) => i.k !== llave);
  const resto = { ...intentos };
  if (quedan.length) resto[id] = quedan;
  else delete resto[id];
  escribir(resto);
}
