import {
  resumirPorMoneda,
  exportTransactionsCSV,
  exportTransactionsJSON,
  copyTransactionsToClipboard,
  shareTransactions,
} from '../export';
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

// Una fecha local armada a mano: su ISO depende de la zona del equipo, lo que
// se espera en el archivo no (las 09:30 del 4 de setiembre en la hora local).
const LOCAL = new Date(2026, 8, 4, 9, 30);
const ISO = LOCAL.toISOString();

function conFecha(id: string, amount: number, ccy: string): Transaction {
  return { ...tx(id, amount, ccy), date: '4/9/2026', dateISO: ISO };
}

// Se intercepta el Blob para leer lo que de verdad se escribe en el archivo.
async function leerArchivo(exportar: () => void): Promise<string> {
  const blobs: Blob[] = [];
  const originalBlob = globalThis.Blob;
  globalThis.Blob = class extends originalBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      blobs.push(this as unknown as Blob);
    }
  } as unknown as typeof Blob;
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
  try {
    exportar();
    return await blobs[0].text();
  } finally {
    globalThis.Blob = originalBlob;
  }
}

// La fecha exportada era el texto de la pantalla: "4/9/2026" del adaptador
// (es-CR, que una hoja de calculo en ingles lee 9 de abril y sin la hora), o
// "Ahora" y "Hoy, 9:41 AM" en lo anotado localmente, que ni siquiera es una
// fecha y cuya coma partia la fila del CSV en una columna de mas.
describe('lo exportado lleva la fecha de maquina, sin ambiguedad', () => {
  it('el CSV escribe la fecha y hora locales como aaaa-mm-dd hh:mm, no el d/m de es-CR', async () => {
    const texto = await leerArchivo(() => exportTransactionsCSV([conFecha('1', 1000, 'CRC')]));

    const fila = texto.split('\n').find((l) => l.startsWith('1,'));
    expect(fila).toContain('2026-09-04 09:30');
    expect(fila).not.toContain('4/9/2026');
  });

  it('sin fecha de maquina, la que trae va entre comillas y su coma no parte la fila', async () => {
    const viejo = { ...tx('1', 1000, 'CRC'), date: 'Hoy, 9:41 AM' };

    const texto = await leerArchivo(() => exportTransactionsCSV([viejo]));

    const fila = texto.split('\n').find((l) => l.startsWith('1,'));
    expect(fila).toContain('"Hoy, 9:41 AM"');
  });

  it('el JSON trae la fecha ISO del movimiento', async () => {
    const texto = await leerArchivo(() => exportTransactionsJSON([conFecha('1', 1000, 'CRC')]));

    expect(JSON.parse(texto).transactions[0].date).toBe(ISO);
  });
});

// Copiar y compartir sumaban todas las filas sin mirar la moneda, el mismo
// defecto que resumirPorMoneda ya habia cerrado en el CSV y el JSON: colones y
// dolares en un solo total, escrito sin moneda.
describe('copiar y compartir no mezclan monedas', () => {
  const movimientos = () => [conFecha('1', 1000, 'CRC'), conFecha('2', -400, 'CRC'), conFecha('3', 50, 'USD')];

  it('copiar escribe un total por moneda, con su codigo, y la fecha de maquina de cada fila', async () => {
    let copiado = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (s: string) => { copiado = s; } },
      configurable: true,
    });

    expect(await copyTransactionsToClipboard(movimientos())).toBe(true);

    expect(copiado).toContain('Ingresos: +1000.00 CRC');
    expect(copiado).toContain('Egresos:  -400.00 CRC');
    expect(copiado).toContain('Ingresos: +50.00 USD');
    // Lo que hacia antes: 1000 + 50 = 1050, ni colones ni dolares.
    expect(copiado).not.toContain('1050.00');
    expect(copiado).toContain('2026-09-04 09:30  movimiento 1');
  });

  it('compartir resume por moneda', async () => {
    let compartido = '';
    Object.defineProperty(navigator, 'share', {
      value: async (datos: { text: string }) => { compartido = datos.text; },
      configurable: true,
    });

    try {
      expect(await shareTransactions(movimientos())).toBe(true);
    } finally {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    }

    expect(compartido).toContain('Ingresos: +1000.00 CRC');
    expect(compartido).toContain('Balance: +600.00 CRC');
    expect(compartido).toContain('Ingresos: +50.00 USD');
    expect(compartido).not.toContain('1050.00');
  });
});
