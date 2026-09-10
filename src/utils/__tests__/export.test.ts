import { resumirPorMoneda, exportTransactionsCSV } from '../export';
import type { Transaction } from '@/types';

// El resumen del CSV sumaba TODAS las filas con un `reduce` sin mirar la moneda:
// colones y dolares uno junto a otro, y el total escrito sin simbolo. El usuario
// tomaba decisiones sobre un numero que no era el total en colones ni el total
// en dolares — era la suma de dos cosas distintas.

function tx(id: string, amount: number, ccy: string): Transaction {
  return {
    id,
    title: 'movimiento ' + id,
    amount,
    ccy,
    date: '2026-09-10',
    type: amount > 0 ? 'credit' : 'debit',
    category: 'General',
    status: 'completed',
  } as Transaction;
}

describe('resumirPorMoneda', () => {
  it('no mezcla monedas en un mismo total', () => {
    const r = resumirPorMoneda([
      tx('1', 1000, 'CRC'),
      tx('2', -400, 'CRC'),
      tx('3', 50, 'USD'),
      tx('4', -20, 'USD'),
    ]);

    expect(r).toHaveLength(2);
    const crc = r.find((x) => x.moneda === 'CRC')!;
    const usd = r.find((x) => x.moneda === 'USD')!;

    expect(crc.ingresos).toBe(1000);
    expect(crc.egresos).toBe(-400);
    expect(crc.neto).toBe(600);

    expect(usd.ingresos).toBe(50);
    expect(usd.egresos).toBe(-20);
    expect(usd.neto).toBe(30);

    // Lo que hacia antes: 1000 - 400 + 50 - 20 = 630, un numero que no
    // significa nada.
    expect(r.some((x) => x.neto === 630)).toBe(false);
  });

  it('una moneda sin declarar cuenta como colones, no como una moneda aparte', () => {
    const r = resumirPorMoneda([tx('1', 100, ''), tx('2', 100, 'CRC')]);
    expect(r).toHaveLength(1);
    expect(r[0].moneda).toBe('CRC');
    expect(r[0].neto).toBe(200);
  });

  it('sin movimientos no inventa un resumen', () => {
    expect(resumirPorMoneda([])).toHaveLength(0);
  });
});

describe('el CSV escribe la moneda de cada total', () => {
  it('pone una tanda de resumen por moneda, con su codigo', async () => {
    const blobs: Blob[] = [];
    const originalBlob = globalThis.Blob;
    // Se intercepta el Blob para leer lo que de verdad se escribe en el archivo.
    globalThis.Blob = class extends originalBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        blobs.push(this as unknown as Blob);
      }
    } as unknown as typeof Blob;
    globalThis.URL.createObjectURL = () => 'blob:test';
    globalThis.URL.revokeObjectURL = () => {};

    try {
      exportTransactionsCSV([tx('1', 1000, 'CRC'), tx('2', 50, 'USD')]);
      const texto = await blobs[0].text();
      const lineas = texto.split('\n').filter((l) => l.includes('Balance Neto'));
      expect(lineas).toHaveLength(2);
      expect(lineas.some((l) => l.includes('CRC'))).toBe(true);
      expect(lineas.some((l) => l.includes('USD'))).toBe(true);
    } finally {
      globalThis.Blob = originalBlob;
    }
  });
});
