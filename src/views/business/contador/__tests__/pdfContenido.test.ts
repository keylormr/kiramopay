import { construirContenidoPdf, descripcionParaPdf, MAX_DESCRIPCION, type DatosPdf, type FormatosPdf, type TextosPdf } from '../pdfContenido';
import type { Ingreso } from '../tipos';

const TEXTOS: TextosPdf = {
  titulo: 'Resumen de cobros por SINPE',
  moneda: 'Moneda',
  totalVentas: 'Cobros marcados como venta',
  cantidadUna: '1 cobro',
  cantidadOtras: '{n} cobros',
  aviso: 'Este documento es una ayuda para ordenar los cobros. No es un comprobante fiscal.',
  sinSigno: 'El archivo del banco no distingue entradas de salidas.',
  omitidas: '{n} filas con ingreso se dejaron fuera.',
  listaSinpe: 'Cobros por SINPE',
  sinSinpe: 'No hay cobros por SINPE en este mes.',
  otros: 'Otros ingresos ({n})',
  fecha: 'Fecha',
  descripcion: 'Descripción',
  monto: 'Monto',
  esVenta: 'Es venta',
  si: 'Sí',
  no: 'No',
  pie: 'Elaborado con KiramoPay el {fecha}',
  pagina: 'Página {n} de {total}',
};

const FORMATOS: FormatosPdf = {
  dinero: (c, m) => `${m} ${(c / 100).toFixed(2)}`,
  mes: (m) => `Mes ${m}`,
  fecha: (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`,
};

const ing = (o: Partial<Ingreso> & { id: string }): Ingreso => ({
  fecha: '2026-11-03',
  mes: '2026-11',
  descripcion: 'SINPE Movil Ana',
  centimos: 1000000,
  moneda: 'CRC',
  esSinpe: true,
  ...o,
});

const base = (over: Partial<DatosPdf> = {}): DatosPdf => {
  const delMes = [
    ing({ id: 'b', fecha: '2026-11-05', descripcion: 'SINPE Movil Luis', centimos: 250050 }),
    ing({ id: 'a', fecha: '2026-11-03', descripcion: 'SINPE Movil Ana', centimos: 1000000 }),
    ing({ id: 'c', fecha: '2026-11-06', descripcion: 'Deposito en ventanilla', centimos: 400000, esSinpe: false }),
  ];
  return {
    delMes,
    esVenta: (x) => x.esSinpe,
    mes: '2026-11',
    moneda: 'CRC',
    sinSigno: false,
    omitidas: 0,
    hoy: '2026-11-10',
    ...over,
  };
};

describe('PDF del resumen: contenido', () => {
  it('lleva el total y la cantidad que la pantalla muestra para lo marcado como venta', () => {
    const c = construirContenidoPdf(base(), TEXTOS, FORMATOS);
    expect(c.titulo).toBe('Resumen de cobros por SINPE');
    expect(c.subtitulo).toBe('Mes 2026-11 · Moneda: CRC');
    expect(c.rotuloTotal).toBe('Cobros marcados como venta');
    expect(c.total).toBe('CRC 12500.50');
    expect(c.cantidad).toBe('2 cobros');
  });

  it('lo que la persona marca cambia el total: un deposito marcado como venta suma, un SINPE apagado resta', () => {
    const d = base({ esVenta: (x) => x.id === 'c' });
    const c = construirContenidoPdf(d, TEXTOS, FORMATOS);
    expect(c.total).toBe('CRC 4000.00');
    expect(c.cantidad).toBe('1 cobro');
    expect(c.secciones[0].filas.map((f) => f.venta)).toEqual(['No', 'No']);
    expect(c.secciones[1].filas.map((f) => f.venta)).toEqual(['Sí']);
  });

  it('sin ninguna venta el total es cero y la cantidad lo dice', () => {
    const c = construirContenidoPdf(base({ esVenta: () => false }), TEXTOS, FORMATOS);
    expect(c.total).toBe('CRC 0.00');
    expect(c.cantidad).toBe('0 cobros');
  });

  it('separa los cobros por SINPE de otros ingresos y ordena por fecha', () => {
    const c = construirContenidoPdf(base(), TEXTOS, FORMATOS);
    expect(c.secciones.map((s) => s.titulo)).toEqual(['Cobros por SINPE', 'Otros ingresos (1)']);
    expect(c.secciones[0].filas).toEqual([
      { fecha: '03/11/2026', descripcion: 'SINPE Movil Ana', monto: 'CRC 10000.00', venta: 'Sí' },
      { fecha: '05/11/2026', descripcion: 'SINPE Movil Luis', monto: 'CRC 2500.50', venta: 'Sí' },
    ]);
    expect(c.secciones[1].filas).toEqual([
      { fecha: '06/11/2026', descripcion: 'Deposito en ventanilla', monto: 'CRC 4000.00', venta: 'No' },
    ]);
  });

  it('el desempate de dos cobros del mismo dia es estable, por id', () => {
    const d = base({
      delMes: [ing({ id: 'z', descripcion: 'Z' }), ing({ id: 'a', descripcion: 'A' })],
    });
    expect(construirContenidoPdf(d, TEXTOS, FORMATOS).secciones[0].filas.map((f) => f.descripcion)).toEqual(['A', 'Z']);
  });

  it('un mes sin SINPE lo dice y no inventa la seccion de otros ingresos', () => {
    const d = base({ delMes: [ing({ id: 'c', esSinpe: false })], esVenta: () => false });
    const c = construirContenidoPdf(d, TEXTOS, FORMATOS);
    expect(c.secciones[0]).toMatchObject({ filas: [], vacio: 'No hay cobros por SINPE en este mes.' });
    expect(c.secciones[1].filas).toHaveLength(1);

    const sinNada = construirContenidoPdf(base({ delMes: [ing({ id: 'x' })] }), TEXTOS, FORMATOS);
    expect(sinNada.secciones).toHaveLength(1);
    expect(sinNada.secciones[0].vacio).toBeNull();
  });

  it('dice que es una ayuda y no un comprobante fiscal', () => {
    const c = construirContenidoPdf(base(), TEXTOS, FORMATOS);
    expect(c.aviso).toMatch(/ayuda/);
    expect(c.aviso).toMatch(/no es un comprobante fiscal/i);
  });

  it('las notas salen solo cuando la pantalla las muestra', () => {
    expect(construirContenidoPdf(base(), TEXTOS, FORMATOS).notas).toEqual([]);
    const c = construirContenidoPdf(base({ sinSigno: true, omitidas: 3 }), TEXTOS, FORMATOS);
    expect(c.notas).toEqual(['El archivo del banco no distingue entradas de salidas.', '3 filas con ingreso se dejaron fuera.']);
  });

  it('el pie lleva la fecha de hoy con el formato de la pantalla', () => {
    expect(construirContenidoPdf(base(), TEXTOS, FORMATOS).pie).toBe('Elaborado con KiramoPay el 10/11/2026');
  });

  it('no agrega nada que la pantalla no tenga: ni nombre del comercio, ni cedula, ni impuestos', () => {
    const c = construirContenidoPdf(base(), TEXTOS, FORMATOS);
    expect(Object.keys(c).sort()).toEqual(
      ['aviso', 'cantidad', 'columnas', 'notas', 'pagina', 'pie', 'rotuloTotal', 'secciones', 'subtitulo', 'titulo', 'total'],
    );
    expect(Object.keys(c.secciones[0]).sort()).toEqual(['filas', 'titulo', 'vacio']);
    expect(Object.keys(c.secciones[0].filas[0]).sort()).toEqual(['descripcion', 'fecha', 'monto', 'venta']);
  });
});

describe('PDF del resumen: descripciones que vienen del banco', () => {
  it('quita saltos y caracteres de control, y junta los espacios', () => {
    expect(descripcionParaPdf('SINPE\nMovil\t  Ana\u0000')).toBe('SINPE Movil Ana');
    expect(descripcionParaPdf('a b')).toBe('a b');
  });

  it('una descripcion vacia se muestra como la pantalla: con raya', () => {
    expect(descripcionParaPdf('   ')).toBe('—');
    expect(descripcionParaPdf('')).toBe('—');
  });

  it('pone tope a un texto desmedido sin partir una letra por la mitad', () => {
    const largo = 'A'.repeat(MAX_DESCRIPCION + 50);
    const r = descripcionParaPdf(largo);
    expect(Array.from(r)).toHaveLength(MAX_DESCRIPCION);
    expect(r.endsWith('…')).toBe(true);
    const emojis = '😀'.repeat(MAX_DESCRIPCION + 5);
    expect(descripcionParaPdf(emojis)).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it('un texto que parece formula se queda como texto: el PDF es una imagen y no ejecuta nada', () => {
    expect(descripcionParaPdf('=HYPERLINK("http://x")')).toBe('=HYPERLINK("http://x")');
  });
});
