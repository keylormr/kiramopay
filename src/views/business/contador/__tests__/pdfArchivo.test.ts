import { armarPdf, cadenaPdf, type ImagenPdf } from '../pdfArchivo';

const gris = (relleno: number, ancho = 1530, alto = 1980): ImagenPdf => ({
  ancho,
  alto,
  formato: 'gris4',
  datos: new Uint8Array(Array.from({ length: relleno }, (_, i) => (i * 7 + 3) & 0xff)),
});
const jpeg = (relleno: number): ImagenPdf => ({
  ancho: 1530,
  alto: 1980,
  formato: 'jpeg',
  datos: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: relleno }, (_, i) => (i * 5) & 0xfe), 0xff, 0xd9]),
});

const OP = { titulo: 'Resumen de cobros por SINPE', idioma: 'es', fecha: new Date(Date.UTC(2026, 10, 10, 15, 30, 5)), ancho: 612, alto: 792 };
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('cadenaPdf', () => {
  it('escribe el texto en UTF-16 BE con marca de orden, para cualquier idioma', () => {
    expect(cadenaPdf('Ab')).toBe('<FEFF00410062>');
    expect(cadenaPdf('入')).toBe('<FEFF5165>');
  });
});

describe('armarPdf', () => {
  const a = gris(40);
  const b = gris(90);
  const bytes = armarPdf([a, b], OP);
  const texto = latin1(bytes);

  it('tiene la cabecera, el cierre y una linea binaria', () => {
    expect(texto.startsWith('%PDF-1.4\n%')).toBe(true);
    expect(bytes[10]).toBeGreaterThan(127);
    expect(texto.endsWith('%%EOF\n')).toBe(true);
  });

  it('declara dos paginas carta a pagina completa', () => {
    expect(texto).toContain('/Count 2');
    expect(texto.match(/\/MediaBox \[0 0 612 792\]/g)).toHaveLength(2);
    expect(texto.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(texto.match(/q 612 0 0 792 0 0 cm \/Im0 Do Q/g)).toHaveLength(2);
  });

  it('la tabla de referencias apunta a cada objeto', () => {
    const inicio = Number(/startxref\n(\d+)\n/.exec(texto)![1]);
    expect(texto.slice(inicio, inicio + 4)).toBe('xref');
    const [, cuenta] = /xref\n0 (\d+)\n/.exec(texto.slice(inicio))!.map(Number);
    expect(cuenta).toBe(4 + 2 * 3);
    const entradas = texto.slice(inicio).split('\n').slice(2, 2 + cuenta);
    expect(entradas[0]).toBe('0000000000 65535 f ');
    entradas.slice(1).forEach((e, i) => {
      expect(e).toMatch(/^\d{10} 00000 n $/);
      const donde = Number(e.slice(0, 10));
      expect(texto.slice(donde, donde + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(texto).toContain(`/Size ${cuenta}`);
  });

  it('el gris comprimido se declara como gris de 4 bits con Flate y lleva sus bytes tal cual', () => {
    for (const img of [a, b]) {
      expect(texto).toContain(
        `/Width 1530 /Height 1980 /ColorSpace /DeviceGray /BitsPerComponent 4 /Filter /FlateDecode /Length ${img.datos.length} >>`,
      );
      const pos = texto.indexOf(latin1(img.datos));
      expect(pos).toBeGreaterThan(0);
      expect(texto.slice(pos + img.datos.length, pos + img.datos.length + 10)).toBe('\nendstream');
    }
  });

  it('el respaldo en JPEG se declara en color con DCT', () => {
    const j = jpeg(30);
    const r = latin1(armarPdf([j], OP));
    expect(r).toContain(`/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.datos.length} >>`);
    expect(r).not.toContain('/FlateDecode');
  });

  it('el largo del contenido de cada pagina es el de su texto', () => {
    const c = 'q 612 0 0 792 0 0 cm /Im0 Do Q\n';
    expect(texto.match(new RegExp(`<< /Length ${c.length} >>`, 'g'))).toHaveLength(2);
  });

  it('el titulo y la fecha de creacion van en la informacion del documento', () => {
    expect(texto).toContain('/CreationDate (D:20261110153005Z)');
    expect(texto).toContain('/Producer (KiramoPay)');
    const hex = /\/Title <([0-9A-F]+)>/.exec(texto)![1];
    expect(hex.startsWith('FEFF')).toBe(true);
    const letras = hex.slice(4).match(/.{4}/g)!.map((h) => String.fromCharCode(parseInt(h, 16)));
    expect(letras.join('')).toBe('Resumen de cobros por SINPE');
  });

  it('un titulo en japones y el idioma de chino viajan sin danarse', () => {
    const r = latin1(armarPdf([a], { ...OP, titulo: 'SINPE入金の集計', idioma: 'zh-cn' }));
    expect(r).toContain(`/Title ${cadenaPdf('SINPE入金の集計')}`);
    expect(r).toContain('/Lang (zh-CN)');
    expect(latin1(armarPdf([a], OP))).toContain('/Lang (es)');
  });

  it('un idioma raro no rompe la etiqueta de idioma del documento', () => {
    expect(latin1(armarPdf([a], { ...OP, idioma: 'x) /Evil (' }))).toContain('/Lang (es)');
  });

  it('sin paginas, o con un "jpeg" que no lo es, falla en vez de entregar un PDF roto', () => {
    expect(() => armarPdf([], OP)).toThrow('SIN_PAGINAS');
    expect(() => armarPdf([{ ...jpeg(5), datos: new Uint8Array([1, 2, 3]) }], OP)).toThrow('JPEG_INVALIDO');
  });
});
