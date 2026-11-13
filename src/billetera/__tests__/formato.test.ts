import { describe, expect, it } from 'vitest';
import { direccionCorta, recortarDecimales, satsABtc, valorEnUsd } from '../formato';

describe('las cantidades de la billetera propia', () => {
  it('corta hacia abajo, nunca redondea hacia arriba', () => {
    expect(recortarDecimales('1.999999999999999999', 8)).toBe('1.99999999');
    expect(recortarDecimales('0.120000000', 8)).toBe('0.12');
    expect(recortarDecimales('5.000', 8)).toBe('5');
    expect(recortarDecimales('7', 8)).toBe('7');
  });

  it('pasa satoshis a bitcoin sin float', () => {
    expect(satsABtc(0)).toBe('0');
    expect(satsABtc(1)).toBe('0.00000001');
    expect(satsABtc(123456789)).toBe('1.23456789');
    expect(satsABtc(100000000)).toBe('1');
    expect(satsABtc(-5)).toBe('0');
  });

  it('valora solo con precio', () => {
    expect(valorEnUsd('0.5', 100)).toBe(50);
    expect(valorEnUsd('0.5', 0)).toBeNull();
    expect(valorEnUsd('0.5', undefined)).toBeNull();
  });

  it('recorta una direccion larga al centro', () => {
    expect(direccionCorta('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe('0xf39Fd6…fFb92266');
    expect(direccionCorta('corta')).toBe('corta');
  });
});
