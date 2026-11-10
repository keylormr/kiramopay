import { comprimir, empaquetarGris4, juntar, sabeComprimir } from '../pdfPixeles';

const px = (...pixeles: Array<[number, number, number]>) => new Uint8ClampedArray(pixeles.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('empaquetarGris4', () => {
  it('blanco es 15 y negro es 0, dos pixeles por byte con el primero arriba', () => {
    expect(Array.from(empaquetarGris4(px([255, 255, 255], [0, 0, 0]), 2, 1))).toEqual([0xf0]);
    expect(Array.from(empaquetarGris4(px([0, 0, 0], [255, 255, 255]), 2, 1))).toEqual([0x0f]);
  });

  it('una fila de ancho impar termina en un byte propio, con el sobrante en cero', () => {
    const r = empaquetarGris4(px([255, 255, 255], [0, 0, 0], [255, 255, 255], [0, 0, 0], [255, 255, 255], [255, 255, 255]), 3, 2);
    expect(Array.from(r)).toEqual([0xf0, 0xf0, 0x0f, 0xf0]);
  });

  it('un gris intermedio cae en su tono mas cercano', () => {
    // 128 / 255 * 15 = 7,53 -> 8
    expect(empaquetarGris4(px([128, 128, 128], [128, 128, 128]), 2, 1)[0]).toBe(0x88);
  });

  it('usa la luminancia: el verde pesa mas que el azul y un fleco de color no deja huella', () => {
    // rojo puro 0,299 -> 4; verde puro 0,587 -> 9; azul puro 0,114 -> 2
    expect(Array.from(empaquetarGris4(px([255, 0, 0], [0, 255, 0]), 2, 1))).toEqual([0x49]);
    expect(Array.from(empaquetarGris4(px([0, 0, 255], [0, 0, 0]), 2, 1))).toEqual([0x20]);
  });

  it('ignora el alfa', () => {
    const r = new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 255]);
    expect(Array.from(empaquetarGris4(r, 2, 1))).toEqual([0xf0]);
  });

  it('el tamano es el que PDF espera para 4 bits: ceil(ancho / 2) por alto', () => {
    expect(empaquetarGris4(new Uint8ClampedArray(1530 * 4 * 3), 1530, 1).length).toBe(765);
    expect(empaquetarGris4(new Uint8ClampedArray(5 * 4 * 4), 5, 4).length).toBe(12);
  });
});

describe('comprimir', () => {
  const descomprimir = (b: Uint8Array) =>
    juntar(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(b);
          c.close();
        },
      }).pipeThrough(new DecompressionStream('deflate')),
    );

  it('produce zlib que se descomprime a lo mismo, y mucho mas chico si es una pagina casi blanca', async () => {
    const pagina = new Uint8Array(765 * 1980).fill(0xff);
    pagina.fill(0x37, 1000, 1400);
    const comprimido = await comprimir(pagina);
    expect(comprimido.length).toBeLessThan(pagina.length / 100);
    expect(Array.from(await descomprimir(comprimido))).toEqual(Array.from(pagina));
  });

  it('sabe si el WebView puede comprimir', () => {
    expect(sabeComprimir()).toBe(true);
    vi.stubGlobal('CompressionStream', undefined);
    expect(sabeComprimir()).toBe(false);
    vi.unstubAllGlobals();
  });
});
