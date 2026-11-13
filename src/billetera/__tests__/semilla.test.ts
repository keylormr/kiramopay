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
