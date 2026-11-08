// @vitest-environment node
import { detectarColumnas } from '../columnas';
import { extraerIngresos } from '../ingresos';
import type { Tabla } from '../tipos';

// Lo que un estado de cuenta puede no decir: la moneda, si un monto es salida
// y, en la descripcion, que el movimiento fue por SINPE.

const ingresosDe = (tabla: Tabla) => {
  const d = detectarColumnas(tabla);
  return extraerIngresos(tabla, d.columnas, d.filaEncabezado);
};

describe('lo que el archivo no dice', () => {
  it('sin moneda en ningun renglon pide confirmarla', () => {
    const r = ingresosDe([
      ['Fecha', 'Detalle', 'Credito', 'Debito'],
      ['01/10/2026', 'SINPE MOVIL', '1500.00', ''],
    ]);
    expect(r.monedaDeclarada).toBe(false);
    expect(r.ingresos[0].moneda).toBe('CRC');
  });

  it('una columna de moneda o un simbolo en el monto la declaran', () => {
    const conColumna = ingresosDe([
      ['Fecha', 'Detalle', 'Credito', 'Moneda'],
      ['01/10/2026', 'SINPE MOVIL', '1500.00', 'USD'],
    ]);
    expect(conColumna.monedaDeclarada).toBe(true);
    expect(conColumna.ingresos[0].moneda).toBe('USD');

    const conSimbolo = ingresosDe([
      ['Fecha', 'Detalle', 'Credito'],
      ['01/10/2026', 'SINPE MOVIL', '$1,500.00'],
    ]);
    expect(conSimbolo.monedaDeclarada).toBe(true);
    expect(conSimbolo.ingresos[0].moneda).toBe('USD');
  });

  it('una sola columna de montos, todos positivos, avisa que no se ven las salidas', () => {
    const r = ingresosDe([
      ['Fecha', 'Detalle', 'Monto'],
      ['01/10/2026', 'SINPE MOVIL RECIBIDO', '1500.00'],
      ['02/10/2026', 'SINPE MOVIL ENVIADO', '900.00'],
    ]);
    expect(r.sinSigno).toBe(true);
  });

  it('con montos negativos o columna de credito no hace falta el aviso', () => {
    expect(ingresosDe([
      ['Fecha', 'Detalle', 'Monto'],
      ['01/10/2026', 'SINPE MOVIL', '1500.00'],
      ['02/10/2026', 'PAGO', '-900.00'],
      ['03/10/2026', 'SINPE MOVIL', '200.00'],
    ]).sinSigno).toBe(false);
    expect(ingresosDe([
      ['Fecha', 'Detalle', 'Credito', 'Debito'],
      ['01/10/2026', 'SINPE MOVIL', '1500.00', ''],
      ['02/10/2026', 'DEPOSITO', '900.00', ''],
    ]).sinSigno).toBe(false);
  });

  it('reconoce SINPE aunque este en otra columna y no en la descripcion', () => {
    const r = ingresosDe([
      ['Fecha', 'Tipo', 'Detalle', 'Credito'],
      ['01/10/2026', 'SINPE MOVIL', '0048213', '1500.00'],
      ['02/10/2026', 'DEPOSITO', '0048214', '900.00'],
    ]);
    expect(r.ingresos.map((x) => x.esSinpe)).toEqual([true, false]);
  });

  it('prefiere el detalle sobre el numero de referencia', () => {
    const d = detectarColumnas([['Fecha', 'Referencia', 'Descripcion del movimiento', 'Credito']]);
    expect(d.columnas.descripcion).toBe(2);
  });

  it('usa la referencia si no hay otra descripcion', () => {
    const d = detectarColumnas([['Fecha', 'Referencia', 'Credito']]);
    expect(d.columnas.descripcion).toBe(1);
    expect(d.confiable).toBe(true);
  });
});
