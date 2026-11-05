import { compartirImagenDeQr, dibujarTarjetaQr, partirEnLineas } from '../qrComoImagen';

// Compartir el QR propio como imagen: quien lo recibe por chat lo abre desde su
// galeria con el escaner de KiramoPay (ver qrDesdeImagen). Esta parte decide
// COMO sale la imagen —menu del sistema, Web Share o descarga— y como se dibuja
// la tarjeta; que la imagen vuelva a leerse como el mismo codigo se comprueba
// con el lector real en el recorrido de la pantalla.

const entorno = vi.hoisted(() => ({
  esNativo: false,
  entregar: vi.fn(),
}));

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => entorno.esNativo },
}));

vi.mock('../entregarArchivo', () => ({ entregarArchivo: entorno.entregar }));

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

function errorDe(nombre: string): Error {
  const e = new Error(nombre);
  e.name = nombre;
  return e;
}

function conWebShare(share: unknown, canShare: unknown) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
}

beforeEach(() => {
  entorno.esNativo = false;
  entorno.entregar.mockReset().mockResolvedValue('listo');
  conWebShare(undefined, undefined);
});

afterEach(() => {
  // jsdom no trae share/canShare: se quitan para no contaminar otras pruebas.
  delete (navigator as unknown as Record<string, unknown>).share;
  delete (navigator as unknown as Record<string, unknown>).canShare;
});

describe('compartirImagenDeQr', () => {
  it('en el telefono usa el mismo camino que las exportaciones: archivo en la cache y menu del sistema', async () => {
    entorno.esNativo = true;
    entorno.entregar.mockResolvedValue('compartido');
    const share = vi.fn();
    conWebShare(share, vi.fn(() => true));

    const estado = await compartirImagenDeQr(PNG, 'kiramopay-cobro.png', 'Mi cobro');

    expect(estado).toBe('compartido');
    expect(entorno.entregar).toHaveBeenCalledWith(PNG, 'kiramopay-cobro.png');
    expect(share).not.toHaveBeenCalled();
  });

  it('en el telefono devuelve tal cual lo que diga la entrega (cerrar el menu no es un error)', async () => {
    entorno.esNativo = true;
    entorno.entregar.mockResolvedValue('quieto');
    expect(await compartirImagenDeQr(PNG, 'a.png', 't')).toBe('quieto');

    entorno.entregar.mockResolvedValue('solo_web');
    expect(await compartirImagenDeQr(PNG, 'a.png', 't')).toBe('solo_web');
  });

  it('en un navegador con Web Share de archivos abre el menu de compartir con la imagen', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn(() => true);
    conWebShare(share, canShare);

    const estado = await compartirImagenDeQr(PNG, 'kiramopay-cobro.png', 'Mi cobro');

    expect(estado).toBe('compartido');
    const datos = share.mock.calls[0][0] as { files: File[]; title: string };
    expect(datos.files).toHaveLength(1);
    expect(datos.files[0].name).toBe('kiramopay-cobro.png');
    expect(datos.files[0].type).toBe('image/png');
    expect(datos.title).toBe('Mi cobro');
    // Se pregunto con el mismo archivo antes de abrir el menu.
    expect(canShare).toHaveBeenCalledWith({ files: [expect.any(File)] });
    expect(entorno.entregar).not.toHaveBeenCalled();
  });

  it('cerrar el menu de compartir no descarga nada ni es un error', async () => {
    conWebShare(vi.fn().mockRejectedValue(errorDe('AbortError')), vi.fn(() => true));

    const estado = await compartirImagenDeQr(PNG, 'a.png', 't');

    expect(estado).toBe('quieto');
    expect(entorno.entregar).not.toHaveBeenCalled();
  });

  it('si Web Share falla por otra razon, cae a descargar la imagen en vez de dejar a la persona sin nada', async () => {
    conWebShare(vi.fn().mockRejectedValue(errorDe('NotAllowedError')), vi.fn(() => true));

    const estado = await compartirImagenDeQr(PNG, 'a.png', 't');

    expect(estado).toBe('listo');
    expect(entorno.entregar).toHaveBeenCalledWith(PNG, 'a.png');
  });

  it('en un navegador que no puede compartir archivos (escritorio) descarga la imagen', async () => {
    conWebShare(vi.fn(), vi.fn(() => false));
    expect(await compartirImagenDeQr(PNG, 'a.png', 't')).toBe('listo');
    expect(entorno.entregar).toHaveBeenCalledTimes(1);
  });

  it('sin Web Share en absoluto tambien descarga', async () => {
    conWebShare(undefined, undefined);
    expect(await compartirImagenDeQr(PNG, 'a.png', 't')).toBe('listo');
    expect(entorno.entregar).toHaveBeenCalledWith(PNG, 'a.png');
  });
});

describe('partirEnLineas', () => {
  // Cada caracter mide 10: un texto de N caracteres mide 10 * N.
  const medir = (s: string) => s.length * 10;

  it('un texto que cabe queda en una linea', () => {
    expect(partirEnLineas(medir, 'Ana Solis', 200, 2)).toEqual(['Ana Solis']);
  });

  it('parte por palabras cuando no cabe', () => {
    expect(partirEnLineas(medir, 'Soda Tica Playa del Coco', 130, 3)).toEqual(['Soda Tica', 'Playa del', 'Coco']);
  });

  it('si sobra texto despues del maximo de lineas, la ultima termina en puntos suspensivos y cabe', () => {
    const lineas = partirEnLineas(medir, 'Soda Tica Playa del Coco Guanacaste Costa Rica', 130, 2);
    expect(lineas).toHaveLength(2);
    expect(lineas[1].endsWith('…')).toBe(true);
    expect(medir(lineas[1])).toBeLessThanOrEqual(130);
  });

  it('una sola palabra mas ancha que la linea se recorta con puntos suspensivos', () => {
    const [linea] = partirEnLineas(medir, 'Supercalifragilisticoespialidoso', 100, 1);
    expect(linea.endsWith('…')).toBe(true);
    expect(medir(linea)).toBeLessThanOrEqual(100);
  });

  it('un texto vacio no dibuja lineas', () => {
    expect(partirEnLineas(medir, '   ', 100, 2)).toEqual([]);
  });

  it('al recortar no parte un emoji por la mitad', () => {
    // Un emoji son dos unidades UTF-16: cortar entre ellas deja un caracter roto.
    const [linea] = partirEnLineas(medir, 'Cafe 😀😀😀😀😀😀', 70, 1);
    expect(linea.endsWith('…')).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(linea)).toBe(false);
  });
});

// El lienzo no existe en jsdom: se simula solo lo que usa la tarjeta, para
// comprobar el ORDEN del dibujo (fondo blanco, luego el QR, luego los textos).
describe('dibujarTarjetaQr', () => {
  type Llamada = [string, ...unknown[]];

  function lienzoFalso() {
    const llamadas: Llamada[] = [];
    const ctx = {
      font: '',
      fillStyle: '' as string,
      strokeStyle: '' as string,
      lineWidth: 0,
      textAlign: '',
      textBaseline: '',
      imageSmoothingEnabled: true,
      fillRect: (...a: unknown[]) => llamadas.push(['fillRect', ctx.fillStyle, ...a]),
      roundRect: ((...a: unknown[]) => llamadas.push(['roundRect', ...a])) as unknown,
      rect: (...a: unknown[]) => llamadas.push(['rect', ...a]),
      fill: () => llamadas.push(['fill', ctx.fillStyle]),
      stroke: () => llamadas.push(['stroke']),
      beginPath: () => {},
      measureText: (s: string) => ({ width: s.length * 20 }),
      fillText: (...a: unknown[]) => llamadas.push(['fillText', ...a]),
      drawImage: (...a: unknown[]) => llamadas.push(['drawImage', ...a]),
    };
    const lienzo = {
      width: 0,
      height: 0,
      getContext: (): typeof ctx | null => ctx,
      toBlob: (cb: (b: Blob | null) => void, tipo: string) => cb(new Blob(['png'], { type: tipo })),
    };
    return { lienzo, llamadas };
  }

  function conLienzoFalso(decode: () => Promise<void> = () => Promise.resolve()) {
    const f = lienzoFalso();
    const crear = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? (f.lienzo as unknown as HTMLCanvasElement) : crear(tag)) as typeof document.createElement);
    class ImagenFalsa {
      src = '';
      decode() { return decode(); }
    }
    vi.stubGlobal('Image', ImagenFalsa);
    const crearUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:qr');
    const revocarUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return { ...f, crearUrl, revocarUrl };
  }

  function svgDeQr(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '200');
    svg.setAttribute('height', '200');
    svg.setAttribute('viewBox', '0 0 29 29');
    return svg;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('dibuja fondo blanco, el QR grande y los textos, y entrega un PNG', async () => {
    const { lienzo, llamadas } = conLienzoFalso();

    const blob = await dibujarTarjetaQr({
      svg: svgDeQr(),
      marca: 'KiramoPay',
      titulo: 'Keilor Martinez',
      subtitulo: '+506 8888-0000',
      pie: 'Escanealo con KiramoPay',
    });

    expect(blob.type).toBe('image/png');
    expect(lienzo.width).toBe(1080);
    expect(lienzo.height).toBeGreaterThan(1080);

    // El primer trazo es el fondo blanco de toda la tarjeta.
    const iFondo = llamadas.findIndex((l) => l[0] === 'fillRect');
    expect(llamadas[iFondo].slice(1)).toEqual(['#ffffff', 0, 0, 1080, lienzo.height]);

    // El QR se dibuja DESPUES del fondo, cuadrado y de al menos 600 px (un QR
    // chico en una tarjeta de 1080 se vuelve ilegible al reducirla).
    const iQr = llamadas.findIndex((l) => l[0] === 'drawImage');
    expect(iQr).toBeGreaterThan(iFondo);
    const [, , x, y, ancho, alto] = llamadas[iQr] as [string, unknown, number, number, number, number];
    expect(ancho).toBe(alto);
    expect(ancho).toBeGreaterThanOrEqual(600);
    // Con zona de silencio: el QR no toca el borde de la tarjeta...
    expect(x).toBeGreaterThanOrEqual(100);
    expect(y).toBeGreaterThan(0);
    expect(x + ancho).toBeLessThanOrEqual(1080 - 100);
    // ...y va sobre su propio recuadro blanco, que lo rodea con aire de sobra
    // (los lectores piden un margen claro alrededor de los modulos).
    const recuadro = llamadas.find((l) => l[0] === 'roundRect') as [string, number, number, number, number];
    const [, rx, ry, rancho, ralto] = recuadro;
    expect(x - rx).toBeGreaterThanOrEqual(60);
    expect(y - ry).toBeGreaterThanOrEqual(60);
    expect(rx + rancho - (x + ancho)).toBeGreaterThanOrEqual(60);
    expect(ry + ralto - (y + alto)).toBeGreaterThanOrEqual(60);

    const textos = llamadas.filter((l) => l[0] === 'fillText').map((l) => l[1]);
    expect(textos).toEqual(expect.arrayContaining(['KiramoPay', 'Keilor Martinez', '+506 8888-0000', 'Escanealo con KiramoPay']));
  });

  it('libera la URL de la imagen del QR al terminar, y tambien si no se pudo decodificar', async () => {
    const ok = conLienzoFalso();
    await dibujarTarjetaQr({ svg: svgDeQr(), marca: 'KiramoPay', titulo: 'x', pie: 'y' });
    expect(ok.crearUrl).toHaveBeenCalledTimes(1);
    expect(ok.revocarUrl).toHaveBeenCalledWith('blob:qr');
    vi.restoreAllMocks();

    const roto = conLienzoFalso(() => Promise.reject(new Error('no se pudo decodificar')));
    await expect(
      dibujarTarjetaQr({ svg: svgDeQr(), marca: 'KiramoPay', titulo: 'x', pie: 'y' }),
    ).rejects.toThrow('no se pudo decodificar');
    expect(roto.revocarUrl).toHaveBeenCalledWith('blob:qr');
  });

  it('rasteriza una COPIA del svg al tamano de la tarjeta y no toca el de la pantalla', async () => {
    const { crearUrl } = conLienzoFalso();
    const svg = svgDeQr();

    await dibujarTarjetaQr({ svg, marca: 'KiramoPay', titulo: 'x', pie: 'y' });

    const blob = crearUrl.mock.calls[0][0] as Blob;
    const texto = await new Promise<string>((resolver) => {
      const lector = new FileReader();
      lector.onload = () => resolver(String(lector.result));
      lector.readAsText(blob);
    });
    expect(texto).toContain('width="720"');
    expect(texto).toContain('height="720"');
    expect(texto).toContain('viewBox="0 0 29 29"');
    // El QR que la persona esta viendo sigue a 200 px.
    expect(svg.getAttribute('width')).toBe('200');
    expect(svg.getAttribute('height')).toBe('200');
  });

  it('con titulo de dos lineas, subtitulo y pie de tres lineas nada se encima ni se corta', async () => {
    const { lienzo, llamadas } = conLienzoFalso();
    const largo = 'Soda Tica de la Playa del Coco Guanacaste Costa Rica Centroamerica';
    const pieLargo = 'Escanealo con la aplicacion de KiramoPay para pagar este cobro de forma rapida y segura en cualquier momento del dia';

    await dibujarTarjetaQr({ svg: svgDeQr(), marca: 'KiramoPay', titulo: largo, subtitulo: '+506 8888-0000', pie: pieLargo });

    const textos = llamadas.filter((l) => l[0] === 'fillText') as Array<[string, string, number, number]>;
    const recuadro = llamadas.find((l) => l[0] === 'roundRect') as [string, number, number, number, number];
    const [, , ry, , ralto] = recuadro;
    const arriba = textos.filter((t) => t[3] < ry);
    const abajo = textos.filter((t) => t[3] > ry + ralto);

    // Marca, dos lineas de titulo y el subtitulo quedan sobre el recuadro del QR...
    expect(arriba).toHaveLength(4);
    // ...y las lineas del pie, debajo; no sobra ningun texto metido dentro del recuadro.
    expect(abajo.length).toBeGreaterThanOrEqual(2);
    expect(arriba.length + abajo.length).toBe(textos.length);
    // Y el lienzo llega hasta debajo de la ultima linea.
    const ultima = Math.max(...textos.map((t) => t[3]));
    expect(lienzo.height).toBeGreaterThan(ultima + 20);
  });

  it('en un WebView viejo sin roundRect dibuja el recuadro con esquinas rectas en vez de fallar', async () => {
    const { lienzo, llamadas } = conLienzoFalso();
    (lienzo.getContext() as { roundRect?: unknown }).roundRect = undefined;

    const blob = await dibujarTarjetaQr({ svg: svgDeQr(), marca: 'KiramoPay', titulo: 'x', pie: 'y' });

    expect(blob.type).toBe('image/png');
    expect(llamadas.some((l) => l[0] === 'rect')).toBe(true);
    expect(llamadas.some((l) => l[0] === 'drawImage')).toBe(true);
  });

  it('sin subtitulo no deja un hueco con texto vacio', async () => {
    const { llamadas } = conLienzoFalso();

    await dibujarTarjetaQr({ svg: svgDeQr(), marca: 'KiramoPay', titulo: 'Cobro', pie: 'Escanealo' });

    const textos = llamadas.filter((l) => l[0] === 'fillText').map((l) => l[1]);
    expect(textos).not.toContain('');
    expect(textos).toEqual(expect.arrayContaining(['KiramoPay', 'Cobro', 'Escanealo']));
  });

  it('un titulo largo se parte en lineas que caben en la tarjeta', async () => {
    const { llamadas } = conLienzoFalso();
    const largo = 'Soda Tica de la Playa del Coco Guanacaste Costa Rica Centroamerica';

    await dibujarTarjetaQr({ svg: svgDeQr(), marca: 'KiramoPay', titulo: largo, pie: 'Escanealo' });

    const lineas = llamadas.filter((l) => l[0] === 'fillText').map((l) => String(l[1]));
    for (const l of lineas) expect(l.length * 20).toBeLessThanOrEqual(1080 - 2 * 72);
  });

  it('rechaza si el lienzo no da contexto en vez de entregar una imagen vacia', async () => {
    const { lienzo } = conLienzoFalso();
    lienzo.getContext = () => null;

    await expect(
      dibujarTarjetaQr({ svg: svgDeQr(), marca: 'KiramoPay', titulo: 'x', pie: 'y' }),
    ).rejects.toThrow('canvas no disponible');
  });

  it('rechaza si el navegador no logra generar el PNG', async () => {
    const { lienzo } = conLienzoFalso();
    lienzo.toBlob = (cb: (b: Blob | null) => void) => cb(null);

    await expect(
      dibujarTarjetaQr({ svg: svgDeQr(), marca: 'KiramoPay', titulo: 'x', pie: 'y' }),
    ).rejects.toThrow('no se pudo generar el PNG');
  });
});
