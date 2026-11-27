// Respaldo cifrado de las palabras de la billetera propia.
//
// Las palabras viven en el telefono, protegidas con la huella. Si el telefono
// se pierde o se reinicia y la persona no las anoto, el dinero se pierde. El
// respaldo es un archivo que la persona guarda donde quiera (Archivos, Drive,
// su correo) con las palabras cifradas con una contrasena que elige ella: el
// archivo solo no sirve para nada.
//
// Cifrado: PBKDF2-SHA256 (600.000 vueltas, lo que pide OWASP para PBKDF2 con
// SHA-256) para sacar una llave AES-256-GCM de la contrasena, con sal e IV al
// azar en cada archivo. Todo con WebCrypto, que en el telefono corre nativo.
// GCM autentica: una contrasena equivocada o un archivo tocado no descifran a
// medias, fallan. Los datos adicionales atan el formato, la version y las
// vueltas al texto cifrado, asi que cambiarlos en el archivo tambien falla.
//
// El archivo no lleva nada que identifique a la persona ni la billetera.
import { normalizarSemilla, semillaValida } from './semilla';

export const FORMATO_DEL_RESPALDO = 'kiramopay-respaldo-billetera';
const VERSION = 1;
const VUELTAS = 600_000;
// Un archivo con menos vueltas no lo hizo esta app; con muchas mas colgaria el
// telefono al abrirlo.
const VUELTAS_MINIMAS = 100_000;
const VUELTAS_MAXIMAS = 2_000_000;
// Mas que esto no es un respaldo: se rechaza antes de leerlo entero.
export const TAMANO_MAXIMO_DEL_RESPALDO = 16 * 1024;
export const LARGO_MINIMO_DE_LA_CONTRASENA = 12;

export interface ArchivoDeRespaldo {
  formato: typeof FORMATO_DEL_RESPALDO;
  version: typeof VERSION;
  kdf: { nombre: 'PBKDF2-SHA256'; vueltas: number; sal: string };
  cifrado: { nombre: 'AES-256-GCM'; iv: string };
  datos: string;
  creado: string;
}

/** El archivo no es un respaldo de esta app (o es de una version que no se entiende). */
export class RespaldoInvalido extends Error {
  constructor() {
    super('no es un respaldo de la billetera');
    this.name = 'RespaldoInvalido';
  }
}

/** La contrasena no abre el archivo, o el archivo fue modificado. */
export class ContrasenaIncorrecta extends Error {
  constructor() {
    super('la contrasena no abre el respaldo');
    this.name = 'ContrasenaIncorrecta';
  }
}

function sutil(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('este dispositivo no tiene WebCrypto');
  return s;
}

function aBase64(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// La misma contrasena escrita con otro teclado (una tilde compuesta o
// precompuesta) tiene que dar la misma llave.
function bytesDeLaContrasena(contrasena: string): Uint8Array {
  return new TextEncoder().encode(contrasena.normalize('NFKC'));
}

function datosAdicionales(vueltas: number): Uint8Array {
  return new TextEncoder().encode(`${FORMATO_DEL_RESPALDO}:${VERSION}:${vueltas}`);
}

async function llaveDe(contrasena: string, sal: Uint8Array, vueltas: number): Promise<CryptoKey> {
  const base = await sutil().importKey('raw', bytesDeLaContrasena(contrasena), 'PBKDF2', false, ['deriveKey']);
  return sutil().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: vueltas },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Si la contrasena alcanza para cifrar un respaldo. */
export function contrasenaSuficiente(contrasena: string): boolean {
  return contrasena.normalize('NFKC').length >= LARGO_MINIMO_DE_LA_CONTRASENA;
}

/**
 * Cifra las palabras con la contrasena y devuelve el contenido del archivo
 * (JSON). `vueltas` existe para las pruebas; la app usa el valor por defecto.
 */
export async function cifrarRespaldo(
  semilla: string,
  contrasena: string,
  opciones: { vueltas?: number; ahora?: Date } = {},
): Promise<string> {
  const limpia = normalizarSemilla(semilla);
  if (!semillaValida(limpia)) throw new Error('semilla invalida');
  if (!contrasenaSuficiente(contrasena)) throw new Error('contrasena corta');
  const vueltas = opciones.vueltas ?? VUELTAS;
  const sal = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const llave = await llaveDe(contrasena, sal, vueltas);
  const cifrado = await sutil().encrypt(
    { name: 'AES-GCM', iv, additionalData: datosAdicionales(vueltas) },
    llave,
    new TextEncoder().encode(limpia),
  );
  const archivo: ArchivoDeRespaldo = {
    formato: FORMATO_DEL_RESPALDO,
    version: VERSION,
    kdf: { nombre: 'PBKDF2-SHA256', vueltas, sal: aBase64(sal) },
    cifrado: { nombre: 'AES-256-GCM', iv: aBase64(iv) },
    datos: aBase64(new Uint8Array(cifrado)),
    creado: (opciones.ahora ?? new Date()).toISOString(),
  };
  return JSON.stringify(archivo, null, 2);
}

/** Lee el archivo y comprueba que tenga la forma de un respaldo, sin descifrarlo. */
export function leerRespaldo(texto: string): ArchivoDeRespaldo {
  if (texto.length > TAMANO_MAXIMO_DEL_RESPALDO) throw new RespaldoInvalido();
  let a: unknown;
  try {
    a = JSON.parse(texto);
  } catch {
    throw new RespaldoInvalido();
  }
  const r = a as Partial<ArchivoDeRespaldo> | null;
  const esTexto = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (
    !r ||
    r.formato !== FORMATO_DEL_RESPALDO ||
    r.version !== VERSION ||
    r.kdf?.nombre !== 'PBKDF2-SHA256' ||
    !Number.isInteger(r.kdf.vueltas) ||
    r.kdf.vueltas < VUELTAS_MINIMAS ||
    r.kdf.vueltas > VUELTAS_MAXIMAS ||
    !esTexto(r.kdf.sal) ||
    r.cifrado?.nombre !== 'AES-256-GCM' ||
    !esTexto(r.cifrado.iv) ||
    !esTexto(r.datos)
  ) {
    throw new RespaldoInvalido();
  }
  return r as ArchivoDeRespaldo;
}

/**
 * Abre el respaldo con la contrasena y devuelve las palabras ya normalizadas.
 * Lanza RespaldoInvalido si el archivo no es un respaldo y
 * ContrasenaIncorrecta si la contrasena no lo abre o el archivo fue tocado.
 */
export async function descifrarRespaldo(texto: string, contrasena: string): Promise<string> {
  const r = leerRespaldo(texto);
  let sal: Uint8Array;
  let iv: Uint8Array;
  let datos: Uint8Array;
  try {
    sal = deBase64(r.kdf.sal);
    iv = deBase64(r.cifrado.iv);
    datos = deBase64(r.datos);
  } catch {
    throw new RespaldoInvalido();
  }
  if (sal.length < 16 || iv.length !== 12) throw new RespaldoInvalido();
  const llave = await llaveDe(contrasena, sal, r.kdf.vueltas);
  let claro: ArrayBuffer;
  try {
    claro = await sutil().decrypt({ name: 'AES-GCM', iv, additionalData: datosAdicionales(r.kdf.vueltas) }, llave, datos);
  } catch {
    throw new ContrasenaIncorrecta();
  }
  const semilla = normalizarSemilla(new TextDecoder().decode(claro));
  // Descifro bien pero no son palabras validas: no lo hizo esta app.
  if (!semillaValida(semilla)) throw new RespaldoInvalido();
  return semilla;
}

/** Nombre del archivo: la fecha ayuda a reconocerlo, nada mas. */
export function nombreDelRespaldo(fecha: Date = new Date()): string {
  const d = (n: number) => String(n).padStart(2, '0');
  return `kiramopay-respaldo-billetera-${fecha.getFullYear()}-${d(fecha.getMonth() + 1)}-${d(fecha.getDate())}.json`;
}
