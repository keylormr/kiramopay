// La semilla de la billetera propia: 12 palabras (BIP-39) que son la billetera.
//
// De ellas salen las llaves de todas las redes. Se crean en el telefono, se
// guardan en el telefono (ver boveda.ts) y nunca viajan al servidor de
// KiramoPay: quien tiene las palabras tiene el dinero, y quien las pierde lo
// pierde. Por eso la creacion obliga a anotarlas y a demostrarlo.
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/** 128 bits de entropia: 12 palabras, el estandar de las billeteras moviles. */
const BITS_DE_ENTROPIA = 128;

/** Una semilla nueva, con el generador seguro del sistema (crypto.getRandomValues). */
export function nuevaSemilla(): string {
  return generateMnemonic(wordlist, BITS_DE_ENTROPIA);
}

/**
 * Deja la semilla como la escribe el estandar: minusculas, palabras separadas
 * por un espacio. Quien restaura copia de un papel o de otra app y trae
 * mayusculas, saltos de linea o espacios dobles; nada de eso cambia la semilla.
 */
export function normalizarSemilla(texto: string): string {
  return texto.normalize('NFKD').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** Las palabras de la semilla, en orden. */
export function palabrasDe(semilla: string): string[] {
  return normalizarSemilla(semilla).split(' ').filter(Boolean);
}

/**
 * Si el texto es una semilla que se puede restaurar: 12 o 24 palabras de la
 * lista inglesa con la suma de control correcta. Una palabra mal copiada se
 * rechaza aqui, antes de abrir una billetera vacia que parezca la suya.
 */
export function semillaValida(texto: string): boolean {
  const palabras = palabrasDe(texto);
  if (palabras.length !== 12 && palabras.length !== 24) return false;
  return validateMnemonic(palabras.join(' '), wordlist);
}

/** Las palabras que no estan en la lista: sirven para marcar la que se escribio mal. */
export function palabrasDesconocidas(texto: string): string[] {
  const lista = new Set(wordlist);
  return palabrasDe(texto).filter(p => !lista.has(p));
}

/**
 * Elige `cuantas` posiciones distintas (base 0) para preguntar y comprobar que
 * la persona anoto las palabras. `azar` se inyecta en las pruebas.
 */
export function posicionesParaVerificar(
  total: number,
  cuantas = 3,
  azar: () => number = aleatorioSeguro,
): number[] {
  const disponibles = Array.from({ length: total }, (_, i) => i);
  const elegidas: number[] = [];
  while (elegidas.length < Math.min(cuantas, total)) {
    const i = Math.floor(azar() * disponibles.length);
    elegidas.push(disponibles.splice(i, 1)[0]);
  }
  return elegidas.sort((a, b) => a - b);
}

function aleatorioSeguro(): number {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return u[0] / 2 ** 32;
}
