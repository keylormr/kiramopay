import type { Transaction } from '@/types';
import { arteDelMovimiento, iniciales } from '../arteDelMovimiento';
import { partesDelMonto } from '../partesDelMonto';

const tx = (extra: Partial<Transaction>): Transaction => ({
  id: '1', title: '', amount: -1000, ccy: 'CRC', date: '', type: 'debit', ...extra,
});

describe('iniciales', () => {
  it('dos palabras: la primera letra de cada una', () => {
    expect(iniciales('Diego Rojas')).toBe('DR');
    expect(iniciales('  ána   solís ')).toBe('ÁS');
  });
  it('una palabra: sus dos primeras letras', () => {
    expect(iniciales('Automercado')).toBe('AU');
  });
  it('nada, o un identificador, no da iniciales', () => {
    expect(iniciales('')).toBe('');
    expect(iniciales(undefined)).toBe('');
    expect(iniciales('0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d')).toBe('');
  });
  it('un telefono no es una cara', () => {
    expect(iniciales('8812 4471')).toBe('');
    expect(iniciales('+506 8812-4471')).toBe('');
    expect(arteDelMovimiento(tx({ kind: 'sinpe_send', counterparty: '88124471' }))).toEqual({ tipo: 'icono', nombre: 'moneda' });
  });
});

describe('arteDelMovimiento', () => {
  it('un SINPE con contraparte lleva la cara de la persona', () => {
    expect(arteDelMovimiento(tx({ kind: 'sinpe_receive', counterparty: 'Diego Rojas' }))).toEqual({ tipo: 'iniciales', texto: 'DR' });
  });

  it('sin contraparte no arma iniciales del titulo de respaldo', () => {
    expect(arteDelMovimiento(tx({ kind: 'sinpe_send', title: 'Transferencia SINPE enviada' }))).toEqual({ tipo: 'icono', nombre: 'moneda' });
  });

  it('el tipo del servidor manda el icono', () => {
    expect(arteDelMovimiento(tx({ kind: 'recharge' }))).toEqual({ tipo: 'icono', nombre: 'recarga' });
    expect(arteDelMovimiento(tx({ kind: 'savings_deposit' }))).toEqual({ tipo: 'icono', nombre: 'metas' });
    expect(arteDelMovimiento(tx({ kind: 'crypto_buy', counterparty: 'Alguien' }))).toEqual({ tipo: 'icono', nombre: 'cripto' });
  });

  it('la categoria escrita, con o sin tildes, elige el icono', () => {
    expect(arteDelMovimiento(tx({ category: 'Comida' }))).toEqual({ tipo: 'icono', nombre: 'comida' });
    expect(arteDelMovimiento(tx({ category: 'Súper' }))).toEqual({ tipo: 'icono', nombre: 'supermercado' });
    expect(arteDelMovimiento(tx({ category: 'electricity' }))).toEqual({ tipo: 'icono', nombre: 'luz' });
  });

  it('un pago a un comercio sin categoria lleva sus iniciales', () => {
    expect(arteDelMovimiento(tx({ kind: 'qr_payment', counterparty: 'Café Alma' }))).toEqual({ tipo: 'iniciales', texto: 'CA' });
  });
});

describe('partesDelMonto', () => {
  it('parte el monto como lo escribe formatMoney', () => {
    expect(partesDelMonto(572078.95, 'CRC')).toEqual({ signo: '', simbolo: '₡', entero: '572,078', decimales: '.95' });
    expect(partesDelMonto(-12, 'USD')).toEqual({ signo: '-', simbolo: '$', entero: '12', decimales: '.00' });
  });
  it('una moneda que Intl no conoce no tumba la pantalla', () => {
    const p = partesDelMonto(5, 'XXXX');
    expect(p.simbolo).toBe('');
    expect(p.entero).toMatch(/5/);
  });
});
