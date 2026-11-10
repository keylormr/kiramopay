import { ALTO, ANCHO, disenar, envolver, type Medidor, type Orden } from '../pdfDiseno';
import type { ContenidoPdf, FilaPdf } from '../pdfContenido';

/** Medidor falso: cada letra mide la mitad de su tamano, igual en cualquier idioma. */
const medir: Medidor = (texto, f) => Array.from(texto).length * f.tam * 0.5;

const fila = (i: number, descripcion = `SINPE Movil cliente ${i}`): FilaPdf => ({
  fecha: `${String((i % 28) + 1).padStart(2, '0')}/11/2026`,
  descripcion,
  monto: `₡${i},000.00`,
  venta: 'Sí',
});

const contenido = (sinpe: FilaPdf[], otros: FilaPdf[] = [], extra: Partial<ContenidoPdf> = {}): ContenidoPdf => ({
  titulo: 'Resumen de cobros por SINPE',
  subtitulo: 'Noviembre 2026 · Moneda: CRC',
  rotuloTotal: 'Cobros marcados como venta',
  total: '₡12,500.50',
  cantidad: '2 cobros',
  aviso: 'Este documento es una ayuda para ordenar los cobros. No es un comprobante fiscal.',
  notas: [],
  columnas: { fecha: 'Fecha', descripcion: 'Descripción', monto: 'Monto', venta: 'Es venta' },
  secciones: [
    { titulo: 'Cobros por SINPE', filas: sinpe, vacio: sinpe.length === 0 ? 'No hay cobros.' : null },
    ...(otros.length > 0 ? [{ titulo: `Otros ingresos (${otros.length})`, filas: otros, vacio: null }] : []),
  ],
  pie: 'Elaborado con KiramoPay el 10/11/2026',
  pagina: 'Página {n} de {total}',
  ...extra,
});

const textos = (o: Orden[]) => o.flatMap((x) => (x.tipo === 'texto' ? [x] : []));
const dePagina = (c: ContenidoPdf, p: number) => textos(disenar(c, medir)[p].ordenes).map((t) => t.texto);

describe('envolver', () => {
  const f = { tam: 10, peso: 400 as const };

  it('corta en espacios y no pasa del ancho', () => {
    const r = envolver('uno dos tres cuatro cinco', 60, f, medir);
    expect(r.join(' ')).toBe('uno dos tres cuatro cinco');
    for (const linea of r) expect(medir(linea, f)).toBeLessThanOrEqual(60);
    expect(r.length).toBeGreaterThan(1);
  });

  it('un texto corto queda en un renglon, y uno vacio no rompe', () => {
    expect(envolver('hola', 200, f, medir)).toEqual(['hola']);
    expect(envolver('', 200, f, medir)).toEqual(['']);
  });

  it('una palabra mas ancha que el renglon se corta letra por letra', () => {
    const r = envolver('X'.repeat(40), 50, f, medir);
    expect(r.join('')).toBe('X'.repeat(40));
    for (const linea of r) expect(medir(linea, f)).toBeLessThanOrEqual(50);
  });

  it('el chino y el japones, sin espacios, tambien se parten', () => {
    const texto = '这是一段没有空格的很长的中文说明文字用来测试换行';
    const r = envolver(texto, 60, f, medir);
    expect(r.join('')).toBe(texto);
    expect(r.length).toBeGreaterThan(1);
    for (const linea of r) expect(medir(linea, f)).toBeLessThanOrEqual(60);
  });

  it('no parte las marcas combinadas del hindi de su letra', () => {
    const texto = 'क्षत्रिय'.repeat(12);
    const r = envolver(texto, 40, f, medir);
    expect(r.join('')).toBe(texto);
    // Ningun renglon empieza con una marca combinada (vocal o virama sueltas).
    for (const linea of r) expect(/^[ा-्ँ-ः]/.test(linea)).toBe(false);
  });
});

describe('PDF del resumen: paginas', () => {
  it('con pocas filas cabe en una pagina carta con titulo, total, aviso y pie', () => {
    const paginas = disenar(contenido([fila(1), fila(2)]), medir);
    expect(paginas).toHaveLength(1);
    const t = dePagina(contenido([fila(1), fila(2)]), 0);
    expect(t).toContain('Resumen de cobros por SINPE');
    expect(t).toContain('Noviembre 2026 · Moneda: CRC');
    expect(t).toContain('Cobros marcados como venta');
    expect(t).toContain('₡12,500.50');
    expect(t).toContain('2 cobros');
    expect(t).toContain('Elaborado con KiramoPay el 10/11/2026');
    expect(t).toContain('Página 1 de 1');
  });

  it('el aviso de que no es un comprobante fiscal esta en la primera pagina, completo', () => {
    const c = contenido([fila(1)]);
    const t = dePagina(c, 0).join(' ');
    expect(t).toContain('Este documento es una ayuda');
    expect(t).toContain('No es un comprobante fiscal.');
  });

  it('muchas filas siguen en mas paginas, cada una numerada, y nada se sale de la hoja', () => {
    const c = contenido(Array.from({ length: 90 }, (_, i) => fila(i + 1)));
    const paginas = disenar(c, medir);
    expect(paginas.length).toBeGreaterThan(2);
    paginas.forEach((p, i) => {
      const t = textos(p.ordenes).map((x) => x.texto);
      expect(t).toContain(`Página ${i + 1} de ${paginas.length}`);
      expect(t).toContain('Elaborado con KiramoPay el 10/11/2026');
      for (const x of textos(p.ordenes)) {
        expect(x.y).toBeLessThanOrEqual(ALTO);
        expect(x.x).toBeGreaterThanOrEqual(0);
        expect(x.x).toBeLessThanOrEqual(ANCHO);
      }
      // Todo lo que no es pie queda sobre la zona del pie.
      const cuerpo = textos(p.ordenes).filter((x) => x.fuente.tam !== 8);
      for (const x of cuerpo) expect(x.y).toBeLessThanOrEqual(ALTO - 72);
    });
  });

  it('las paginas siguientes repiten el encabezado de columnas y llevan un titulo corrido', () => {
    const c = contenido(Array.from({ length: 90 }, (_, i) => fila(i + 1)));
    const paginas = disenar(c, medir);
    for (const p of paginas.slice(1)) {
      const t = textos(p.ordenes).map((x) => x.texto);
      expect(t).toContain('Descripción');
      expect(t).toContain('Monto');
      expect(t.some((x) => x.startsWith('Resumen de cobros por SINPE · Noviembre 2026'))).toBe(true);
    }
    // La caja del total y el aviso solo van en la primera.
    expect(textos(paginas[1].ordenes).map((x) => x.texto)).not.toContain('Cobros marcados como venta');
  });

  it('una fila no se parte entre dos paginas: su fecha y su monto van juntos', () => {
    const filas = Array.from({ length: 70 }, (_, i) => fila(i + 1, i % 5 === 0 ? 'Descripcion larga '.repeat(8) : undefined));
    const paginas = disenar(contenido(filas), medir);
    for (const f of filas) {
      const dondeMonto = paginas.findIndex((p) => textos(p.ordenes).some((x) => x.texto === f.monto && x.alinear === 'der'));
      expect(dondeMonto).toBeGreaterThanOrEqual(0);
      const lineas = textos(paginas[dondeMonto].ordenes);
      const m = lineas.find((x) => x.texto === f.monto)!;
      const fecha = lineas.find((x) => x.texto === f.fecha && x.y === m.y);
      expect(fecha).toBeDefined();
    }
  });

  it('una descripcion larga ocupa mas renglones y todos sus renglones estan en el PDF', () => {
    const larga = 'Pago de la factura del servicio mensual de mantenimiento del local comercial numero 123 '.repeat(2).trim();
    const t = dePagina(contenido([fila(1, larga)]), 0);
    const trozos = t.filter((x) => larga.includes(x) && x.length > 5);
    expect(trozos.join(' ').replace(/\s+/g, ' ')).toContain(larga.slice(0, 40));
    expect(trozos.length).toBeGreaterThan(1);
  });

  it('un titulo de seccion nunca queda solo al pie de una pagina', () => {
    for (let n = 1; n <= 70; n += 1) {
      const c = contenido(Array.from({ length: n }, (_, i) => fila(i + 1)), [fila(900), fila(901)]);
      for (const p of disenar(c, medir)) {
        const ts = textos(p.ordenes);
        for (const s of ts.filter((x) => x.texto.startsWith('Otros ingresos'))) {
          expect(ts.some((x) => x.y > s.y && x.texto.endsWith('/11/2026'))).toBe(true);
        }
      }
    }
  });

  it('una seccion sin filas dice por que, y no dibuja encabezados de columna para nada', () => {
    const c = contenido([]);
    const t = dePagina(c, 0);
    expect(t).toContain('No hay cobros.');
    expect(t).not.toContain('Descripción');
  });

  it('las notas del archivo salen en la primera pagina', () => {
    const c = contenido([fila(1)], [], { notas: ['El archivo del banco no distingue entradas de salidas.'] });
    expect(dePagina(c, 0).join(' ')).toContain('no distingue entradas de salidas');
  });

  it('cada pagina que se arma tiene contenido: sin paginas en blanco al final', () => {
    for (const n of [1, 30, 31, 32, 60, 61, 62, 90]) {
      const paginas = disenar(contenido(Array.from({ length: n }, (_, i) => fila(i + 1))), medir);
      for (const p of paginas) expect(textos(p.ordenes).length).toBeGreaterThan(3);
    }
  });
});
