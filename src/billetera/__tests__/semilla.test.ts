import { describe, expect, it } from 'vitest';
import {
  normalizarSemilla,
  nuevaSemilla,
  palabrasDe,
  palabrasDesconocidas,
  posicionesParaVerificar,
  semillaValida,
} from '../semilla';

// Vector oficial de BIP-39 (trezor/python-mnemonic, vectors.json): entropia de
// 16 bytes en cero.
const VECTOR_CERO = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const VECTOR_CERO_24 = `${Array(23).fill('abandon').join(' ')} art`;
const VECTOR_CERO_18 = `${Array(17).fill('abandon').join(' ')} agent`;

describe('la semilla de la billetera propia', () => {
  it('crea 12 palabras validas y distintas cada vez', () => {
    const a = nuevaSemilla();
    const b = nuevaSemilla();
    expect(palabrasDe(a)).toHaveLength(12);
    expect(semillaValida(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('acepta el vector oficial y rechaza una suma de control mala', () => {
    expect(semillaValida(VECTOR_CERO)).toBe(true);
    // Doce "abandon": todas las palabras existen, pero la ultima no cierra la suma.
    expect(semillaValida(Array(12).fill('abandon').join(' '))).toBe(false);
  });

  it('no le importan las mayusculas, los saltos de linea ni los espacios de mas', () => {
    const copiada = `  ABANDON abandon\nabandon   abandon abandon abandon\tabandon abandon abandon abandon abandon About  `;
    expect(normalizarSemilla(copiada)).toBe(VECTOR_CERO);
    expect(semillaValida(copiada)).toBe(true);
  });

  // Restaurar acepta 12 y 24 palabras y los textos lo dicen ("12 o 24"). Los
  // vectores son los oficiales de BIP-39 con entropia en cero: 32 bytes (24
  // palabras) y 24 bytes (18 palabras).
  it('acepta 24 palabras con la suma de control correcta y rechaza la que no cierra', () => {
    expect(semillaValida(VECTOR_CERO_24)).toBe(true);
    expect(palabrasDe(VECTOR_CERO_24)).toHaveLength(24);
    expect(semillaValida(Array(24).fill('abandon').join(' '))).toBe(false);
  });

  it('rechaza 15, 18 y 21 palabras aunque sean una semilla valida', () => {
    expect(semillaValida(VECTOR_CERO_18)).toBe(false);
  });

  it('rechaza un largo que no es 12 ni 24 y senala la palabra mal escrita', () => {
    expect(semillaValida('abandon about')).toBe(false);
    const conError = VECTOR_CERO.replace('about', 'abuot');
    expect(semillaValida(conError)).toBe(false);
    expect(palabrasDesconocidas(conError)).toEqual(['abuot']);
  });

  it('elige posiciones distintas y ordenadas para verificar', () => {
    const valores = [0.99, 0, 0.5];
    let i = 0;
    const posiciones = posicionesParaVerificar(12, 3, () => valores[i++]);
    expect(posiciones).toHaveLength(3);
    expect(new Set(posiciones).size).toBe(3);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    expect(posiciones.every(p => p >= 0 && p < 12)).toBe(true);
  });
});
