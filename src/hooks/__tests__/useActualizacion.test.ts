import { describe, it, expect } from 'vitest';
import { esVersionMasNueva } from '../useActualizacion';

describe('esVersionMasNueva', () => {
  it('detecta versiones mayores en cada posicion', () => {
    expect(esVersionMasNueva('2.2.1', '2.2.0')).toBe(true);
    expect(esVersionMasNueva('2.3.0', '2.2.9')).toBe(true);
    expect(esVersionMasNueva('3.0.0', '2.9.9')).toBe(true);
  });

  it('no ofrece la misma version ni una menor', () => {
    expect(esVersionMasNueva('2.2.0', '2.2.0')).toBe(false);
    expect(esVersionMasNueva('2.1.9', '2.2.0')).toBe(false);
    expect(esVersionMasNueva('1.9.9', '2.0.0')).toBe(false);
  });

  it('tolera versiones cortas y basura sin ofrecer de mas', () => {
    expect(esVersionMasNueva('2.3', '2.2.0')).toBe(true);
    expect(esVersionMasNueva('abc', '2.2.0')).toBe(false);
    expect(esVersionMasNueva('2.2.1', 'abc')).toBe(false);
  });
});
