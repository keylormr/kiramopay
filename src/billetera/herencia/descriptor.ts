// El descriptor de la boveda de herencia: el texto que describe todas sus
// direcciones y con el que cualquier billetera compatible la encuentra.
//
//   tr(TITULAR,and_v(v:pk(HEREDERO),older(N)))
//
// - TITULAR es la llave interna de taproot: gasta cuando quiera, por la ruta de
//   la llave (key path), y ese gasto no revela que existe un heredero.
// - HEREDERO solo gasta por la hoja del arbol, y solo si la moneda paso N
//   bloques sin moverse (older(N): BIP-68 y BIP-112, relativo a cada moneda).
//
// Es exactamente lo que arma Liana con un titular y un heredero en taproot
// (liana/src/descriptors/mod.rs), por eso el heredero puede cobrar con Liana o
// con Bitcoin Core 26 o posterior aunque no tenga KiramoPay.
import { textoDeLaLlave, type LlaveConOrigen, type Red } from './llaves';

/** Lo minimo para describir una boveda. Todo es publico: no hay nada secreto aqui. */
export interface DatosDeLaBoveda {
  red: Red;
  titular: LlaveConOrigen;
  heredero: LlaveConOrigen;
  /** Bloques sin moverse para que el heredero pueda gastar (1 a 65.535). */
  plazoBloques: number;
}

/** El maximo de older(N) por bloques: 16 bits (BIP-68), unos 455 dias. */
export const PLAZO_MAXIMO_BLOQUES = 0xffff;

export function plazoValido(bloques: number): boolean {
  return Number.isInteger(bloques) && bloques >= 1 && bloques <= PLAZO_MAXIMO_BLOQUES;
}

// ---------------------------------------------------------------- Checksum (BIP-380)

const CARACTERES_DE_ENTRADA =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CARACTERES_DEL_CHECKSUM = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERADOR = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function polimodulo(simbolos: number[]): bigint {
  let chk = 1n;
  for (const valor of simbolos) {
    const arriba = chk >> 35n;
    chk = ((chk & 0x7ffffffffn) << 5n) ^ BigInt(valor);
    for (let i = 0; i < 5; i++) {
      if ((arriba >> BigInt(i)) & 1n) chk ^= GENERADOR[i];
    }
  }
  return chk;
}

/** Las 8 letras de control de un descriptor (lo que va despues del #). */
export function checksumDeDescriptor(descriptor: string): string {
  const simbolos: number[] = [];
  let grupos: number[] = [];
  for (const c of descriptor) {
    const v = CARACTERES_DE_ENTRADA.indexOf(c);
    if (v < 0) throw new Error(`caracter no permitido en un descriptor: ${c}`);
    simbolos.push(v & 31);
    grupos.push(v >> 5);
    if (grupos.length === 3) {
      simbolos.push(grupos[0] * 9 + grupos[1] * 3 + grupos[2]);
      grupos = [];
    }
  }
  if (grupos.length === 1) simbolos.push(grupos[0]);
  else if (grupos.length === 2) simbolos.push(grupos[0] * 3 + grupos[1]);
  const chk = polimodulo([...simbolos, 0, 0, 0, 0, 0, 0, 0, 0]) ^ 1n;
  let salida = '';
  for (let i = 0; i < 8; i++) {
    salida += CARACTERES_DEL_CHECKSUM[Number((chk >> BigInt(5 * (7 - i))) & 31n)];
  }
  return salida;
}

export function conChecksum(descriptor: string): string {
  return `${descriptor}#${checksumDeDescriptor(descriptor)}`;
}

/** Si un descriptor con #checksum esta bien copiado. */
export function checksumCorrecto(conSuma: string): boolean {
  const i = conSuma.lastIndexOf('#');
  if (i < 0) return false;
  try {
    return checksumDeDescriptor(conSuma.slice(0, i)) === conSuma.slice(i + 1);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Descriptores

function cuerpo(d: DatosDeLaBoveda, sufijo: string): string {
  if (!plazoValido(d.plazoBloques)) throw new Error('plazo fuera de rango');
  const a = `${textoDeLaLlave(d.titular)}${sufijo}`;
  const b = `${textoDeLaLlave(d.heredero)}${sufijo}`;
  return `tr(${a},and_v(v:pk(${b}),older(${d.plazoBloques})))`;
}

/**
 * El descriptor de dos ramas (recibir y cambio) en una sola linea, con su
 * checksum: el que piden Liana y Bitcoin Core 29 o posterior.
 */
export function descriptorDeLaBoveda(d: DatosDeLaBoveda): string {
  return conChecksum(cuerpo(d, '/<0;1>/*'));
}

/**
 * Los dos descriptores de una rama cada uno (recibir = 0, cambio = 1), para
 * Bitcoin Core 26 a 28, que todavia no leen `<0;1>`.
 */
export function descriptoresPorRama(d: DatosDeLaBoveda): { recibir: string; cambio: string } {
  return { recibir: conChecksum(cuerpo(d, '/0/*')), cambio: conChecksum(cuerpo(d, '/1/*')) };
}
