import { describe, it, expect } from 'vitest';
import { normalizarTelefonoCR, formatearTelefonoCR } from '../telefono';

describe('normalizarTelefonoCR', () => {
  it('antepone +506 a los 8 digitos de la entrada manual', () => {
    expect(normalizarTelefonoCR('60000001')).toBe('+50660000001');
  });

  it('tolera guiones y espacios', () => {
    expect(normalizarTelefonoCR('6000-0001')).toBe('+50660000001');
    expect(normalizarTelefonoCR('8888 0001')).toBe('+50688880001');
  });

  it('deja pasar la forma de contacto sin duplicar el prefijo', () => {
    expect(normalizarTelefonoCR('+50688880001')).toBe('+50688880001');
    expect(normalizarTelefonoCR('50688880001')).toBe('+50688880001');
  });

  it('rechaza lo que no alcanza para un numero', () => {
    expect(normalizarTelefonoCR('')).toBeNull();
    expect(normalizarTelefonoCR('8888')).toBeNull();
    expect(normalizarTelefonoCR('123456789')).toBeNull();
  });
});

describe('formatearTelefonoCR', () => {
  it('muestra +506 y el guion local', () => {
    expect(formatearTelefonoCR('+50688880001')).toBe('+506 8888-0001');
    expect(formatearTelefonoCR('60000001')).toBe('+506 6000-0001');
  });

  it('devuelve la entrada intacta cuando no la puede interpretar', () => {
    expect(formatearTelefonoCR('abc')).toBe('abc');
  });
});
