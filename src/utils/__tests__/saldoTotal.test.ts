import { describe, it, expect } from 'vitest';
import type { Account } from '@/types';
import { saldoTotal, formatearSaldoTotal } from '../saldoTotal';

// El saldo total de Inicio y de Perfil sale de aqui. Antes cada pantalla lo
// armaba por su cuenta: Inicio mostraba solo la cuenta base con el rotulo
// "total", Perfil sumaba en dolares con otro formato, y una tasa faltante se
// contaba como 1 (colones como si fueran dolares: unas 455 veces de mas).

const cuenta = (ccy: string, balance: number, rateToUsd?: number, extra: Partial<Account> = {}): Account => ({
  ccy,
  balance,
  symbol: ccy === 'USD' ? '$' : '₡',
  flag: '',
  iban: '',
  name: ccy,
  type: 'fiat',
  rateToUsd,
  ...extra,
});

describe('saldoTotal', () => {
  it('suma todas las cuentas y las lleva a la moneda base con la tasa de cada una', () => {
    // 500.000 colones a 0,002 USD por colon son 1.000 dolares; mas 445 dolares:
    // 1.445 dolares, que en colones son 722.500.
    const total = saldoTotal([cuenta('CRC', 500_000, 0.002), cuenta('USD', 445, 1)], 'CRC');

    expect(total.enBase).toBeCloseTo(722_500, 6);
    expect(total.enUsd).toBeCloseTo(1_445, 6);
  });

  it('con moneda base USD el total en base y el total en dolares coinciden', () => {
    const total = saldoTotal([cuenta('CRC', 500_000, 0.002), cuenta('USD', 445, 1)], 'USD');

    expect(total.enBase).toBeCloseTo(1_445, 6);
    expect(total.enUsd).toBeCloseTo(1_445, 6);
  });

  it('una cuenta con saldo y sin tasa deja el total sin dato, no lo cuenta 1 a 1', () => {
    const total = saldoTotal([cuenta('CRC', 500_000, undefined), cuenta('USD', 445, 1)], 'CRC');

    expect(total.enBase).toBeNull();
    expect(total.enUsd).toBeNull();
  });

  it('una tasa en cero tampoco sirve para convertir', () => {
    const total = saldoTotal([cuenta('CRC', 500_000, 0), cuenta('USD', 445, 1)], 'CRC');

    expect(total.enBase).toBeNull();
  });

  it('una cuenta sin saldo no necesita tasa', () => {
    const total = saldoTotal([cuenta('CRC', 500_000, 0.002), cuenta('USD', 0, undefined)], 'CRC');

    expect(total.enBase).toBeCloseTo(500_000, 6);
  });

  it('las cuentas de cripto no entran en el saldo en moneda', () => {
    const total = saldoTotal(
      [cuenta('CRC', 500_000, 0.002), cuenta('BTC', 2, 60_000, { type: 'crypto' })],
      'CRC',
    );

    expect(total.enBase).toBeCloseTo(500_000, 6);
  });

  it('si solo hay cuentas en la moneda base no hace falta ninguna tasa', () => {
    const total = saldoTotal([cuenta('CRC', 384_500, undefined)], 'CRC');

    expect(total.enBase).toBe(384_500);
    // En dolares si hace falta, y no la hay.
    expect(total.enUsd).toBeNull();
  });

  it('sin cuentas el total es cero, no un dato faltante', () => {
    expect(saldoTotal([], 'CRC')).toEqual({ enBase: 0, enUsd: 0 });
  });
});

describe('formatearSaldoTotal', () => {
  it('da miles con coma y dos decimales, como el resto de los montos', () => {
    expect(formatearSaldoTotal(722_500, 'CRC')).toBe('₡722,500.00');
    expect(formatearSaldoTotal(1_445, 'USD')).toBe('$1,445.00');
  });

  it('sin dato escribe el guion, nunca un cero', () => {
    expect(formatearSaldoTotal(null, 'CRC')).toBe('—');
  });
});
