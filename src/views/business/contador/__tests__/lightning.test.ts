import type { VentaLightning } from '@/api/repositories/qrpayment.repository';
import { cobrosLightningDelMes, fechaLocal, sumarLightning, type CobroLightningDelMes } from '../lightning';
import { construirCsv, type TextosCsv, type TextosCsvLightning } from '../csvSalida';
import { construirContenidoPdf, type TextosPdf } from '../pdfContenido';
import type { Ingreso } from '../tipos';

const venta = (p: Partial<VentaLightning>): VentaLightning => ({
  chargeId: 'c1',
  note: 'Casado',
  monto: 5000,
  currency: 'CRC',
  sats: 12_500,
  precioBtc: '40000000',
  paymentHash: '00',
  paidAt: '2026-11-07T18:00:00Z',
  chargeStatus: 'paid',
  ...p,
});

describe('cobrosLightningDelMes', () => {
  it('deja solo la moneda del resumen, en centimos, de la mas vieja a la mas nueva', () => {
    const lista = cobrosLightningDelMes(
      [
        venta({ chargeId: 'b', paidAt: '2026-11-09T18:00:00Z', monto: 1234.56 }),
        venta({ chargeId: 'u', currency: 'USD', monto: 10 }),
        venta({ chargeId: 'a', paidAt: '2026-11-03T18:00:00Z', monto: 0.1 }),
      ],
      'CRC',
      'Cobro con Lightning',
    );
    expect(lista.map((x) => x.id)).toEqual(['a', 'b']);
    expect(lista.map((x) => x.centimos)).toEqual([10, 123_456]);
    expect(sumarLightning(lista)).toBe(123_466);
  });

  it('una venta sin nota dice que fue un cobro con Lightning', () => {
    const [x] = cobrosLightningDelMes([venta({ note: '  ' })], 'CRC', 'Cobro con Lightning');
    expect(x.descripcion).toBe('Cobro con Lightning');
  });

  it('la fecha es la del dia local, no la de UTC', () => {
    const d = new Date(2026, 10, 7, 23, 30);
    expect(fechaLocal(d.toISOString())).toBe('2026-11-07');
    expect(fechaLocal('no es fecha')).toBe('');
  });
});

const TX: TextosCsv = {
  fecha: 'Fecha', descripcion: 'Descripcion', monto: 'Monto', moneda: 'Moneda', esSinpe: 'SINPE',
  esVenta: 'Venta', si: 'Si', no: 'No', totalVentas: 'Total ventas', cantidadVentas: 'Cantidad',
};
const TXLN: TextosCsvLightning = {
  medio: 'Medio', banco: 'Banco', sats: 'Sats', precioBtc: 'Precio de 1 BTC',
  totalLightning: 'Total por Lightning', cantidadLightning: 'Cantidad por Lightning',
};
const INGRESOS: Ingreso[] = [
  { id: 'i1', fecha: '2026-11-03', mes: '2026-11', descripcion: 'SINPE Ana', centimos: 1_000_000, moneda: 'CRC', esSinpe: true },
  { id: 'i2', fecha: '2026-11-08', mes: '2026-11', descripcion: 'Deposito', centimos: 400_000, moneda: 'CRC', esSinpe: false },
];
const esVenta = (x: Ingreso) => x.esSinpe;
const LN: CobroLightningDelMes[] = [
  { id: 'c1', fecha: '2026-11-05', descripcion: '=2x Casado', centimos: 500_000, moneda: 'CRC', sats: 12_500, precioBtc: '40000000' },
];

describe('CSV con Lightning', () => {
  it('sin cobros por Lightning el archivo queda como siempre', () => {
    expect(construirCsv(INGRESOS, esVenta, TX, [], TXLN)).toBe(construirCsv(INGRESOS, esVenta, TX));
    expect(construirCsv(INGRESOS, esVenta, TX)).not.toContain('Medio');
  });

  it('agrega medio, sats y precio; ordena por fecha y suma Lightning al total de ventas', () => {
    const csv = construirCsv(INGRESOS, esVenta, TX, LN, TXLN);
    const lineas = csv.split('\n');
    expect(lineas[0]).toBe('﻿sep=,');
    expect(lineas[1]).toBe('"Fecha","Descripcion","Monto","Moneda","SINPE","Venta","Medio","Sats","Precio de 1 BTC"');
    expect(lineas[2]).toBe('2026-11-03,"SINPE Ana",10000.00,"CRC","Si","Si","Banco",,');
    // La nota la escribio el cajero: una formula no se ejecuta en Excel.
    expect(lineas[3]).toBe(`2026-11-05,"'=2x Casado",5000.00,"CRC","No","Si","Lightning",12500,"40000000"`);
    expect(lineas[4]).toBe('2026-11-08,"Deposito",4000.00,"CRC","No","No","Banco",,');
    expect(lineas[5]).toBe('');
    expect(lineas[6]).toBe(',"Total ventas",15000.00,"CRC",,,,,');
    expect(lineas[7]).toBe(',"Cantidad",2,,,,,,');
    expect(lineas[8]).toBe(',"Total por Lightning",5000.00,"CRC",,,,,');
    expect(lineas[9]).toBe(',"Cantidad por Lightning",1,,,,,,');
    // Todas las filas con las mismas columnas.
    for (const l of lineas.slice(1).filter(Boolean)) expect(l.split(',').length, l).toBe(9);
  });
});

const TPDF: TextosPdf = {
  titulo: 'Resumen', moneda: 'Moneda', totalVentas: 'Total', cantidadUna: '1 venta', cantidadOtras: '{n} ventas',
  aviso: 'Aviso', sinSigno: 'Sin signo', omitidas: '{n} omitidas', listaSinpe: 'SINPE', sinSinpe: 'Sin SINPE',
  otros: 'Otros ({n})', fecha: 'Fecha', descripcion: 'Descripcion', monto: 'Monto', esVenta: 'Venta', si: 'Si',
  no: 'No', pie: 'Hecho el {fecha}', pagina: '{n}/{total}',
};
const FORMATOS = {
  dinero: (c: number, m: string) => `${m} ${(c / 100).toFixed(2)}`,
  mes: (m: string) => m,
  fecha: (iso: string) => iso,
};
const DATOS = { delMes: INGRESOS, esVenta, mes: '2026-11', moneda: 'CRC', sinSigno: false, omitidas: 0, hoy: '2026-11-18' };

describe('PDF con Lightning', () => {
  it('sin cobros por Lightning el contenido no cambia', () => {
    const sin = construirContenidoPdf(DATOS, TPDF, FORMATOS);
    expect(construirContenidoPdf({ ...DATOS, lightning: [] }, { ...TPDF, lightning: { titulo: 'LN', porLightning: 'Por LN: {monto}' } }, FORMATOS)).toEqual(sin);
    // Con cobros pero sin los textos (una pantalla vieja), tampoco.
    expect(construirContenidoPdf({ ...DATOS, lightning: LN }, TPDF, FORMATOS)).toEqual(sin);
  });

  it('suma Lightning al total, cuenta la venta, agrega su seccion y dice cuanto fue por Lightning', () => {
    const c = construirContenidoPdf(
      { ...DATOS, lightning: LN },
      { ...TPDF, lightning: { titulo: 'Cobros por Lightning', porLightning: 'Por Lightning: {monto}' } },
      { ...FORMATOS, detalleLightning: (x) => `${x.sats} sats` },
    );
    expect(c.total).toBe('CRC 15000.00');
    expect(c.cantidad).toBe('2 ventas');
    expect(c.notas[0]).toBe('Por Lightning: CRC 5000.00');
    expect(c.secciones.map((s) => s.titulo)).toEqual(['SINPE', 'Cobros por Lightning', 'Otros (1)']);
    expect(c.secciones[1].filas).toEqual([
      { fecha: '2026-11-05', descripcion: '=2x Casado · 12500 sats', monto: 'CRC 5000.00', venta: 'Si' },
    ]);
  });
});
