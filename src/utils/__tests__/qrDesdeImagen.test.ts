import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  leerQrDeImagen,
  PIXELES_MAXIMOS_DE_LA_PRIMERA_PASADA,
  PIXELES_MAXIMOS_DE_LA_SEGUNDA_PASADA,
} from '../qrDesdeImagen';
import { imagenDePrueba, instalarRasterDePrueba, pixelesDePrueba, type RegistroDeRaster } from '@/test/rasterDePrueba';

// Lector de QR desde una imagen. Las imagenes son QR REALES (codificados con el
// mismo qrcode.react que usa la app y dibujados por Chrome) y los lee jsQR de
// verdad: ninguna prueba devuelve lo que ella misma espera. Lo unico simulado
// es la capa de dibujo del navegador, que jsdom no trae (ver rasterDePrueba).

// Leer una foto de 12 MP en un runner lento tarda segundos, no milisegundos: el
// tope por defecto (5 s) haria fallar por tiempo lo que no esta roto.
vi.setConfig({ testTimeout: 30_000 });

const KP = 'KP:merchant_dynamic:abcd1234:550000:CRC:i0123456789abcdef01234567';

let raster: RegistroDeRaster;
beforeEach(() => {
  raster = instalarRasterDePrueba();
});
afterEach(() => {
  raster.restaurar();
});

const pixelesMaximos = () => Math.max(0, ...raster.lecturas.map((l) => l.ancho * l.alto));
const ladoMaximo = () => Math.max(0, ...raster.lecturas.map((l) => Math.max(l.ancho, l.alto)));

describe('leerQrDeImagen — imagen con un QR valido', () => {
  it('lee un QR recortado', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('qr-kiramo.png'));
    expect(r).toEqual({ ok: true, texto: KP });
  });

  it('lee el QR de una captura de pantalla de un chat', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('captura-chat.png'));
    expect(r).toEqual({ ok: true, texto: KP });
  });

  it('lee un QR con fondo transparente (el alfa no lo vuelve negro)', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('qr-transparente.png'));
    expect(r).toEqual({ ok: true, texto: KP });
  });

  it('lee un QR claro sobre fondo oscuro, como sale del modo oscuro de un chat', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('qr-invertido.png'));
    expect(r).toEqual({ ok: true, texto: KP });
  });
});

describe('leerQrDeImagen — QR de otra cosa', () => {
  // Un QR ajeno es un QR valido: leerlo es trabajo del lector, juzgarlo es del
  // flujo que lo recibe (el mismo que juzga lo que lee la camara).
  it('entrega el texto tal cual, sin juzgarlo', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('qr-ajeno.png'));
    expect(r).toEqual({ ok: true, texto: 'https://example.com/promo?ref=chat-2026' });
  });
});

describe('leerQrDeImagen — imagen sin QR', () => {
  it('dice sin_qr', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('sin-qr.png'));
    expect(r).toEqual({ ok: false, motivo: 'sin_qr' });
  });
});

describe('leerQrDeImagen — archivo que no se puede leer', () => {
  it('un archivo que no es una imagen dice ilegible', async () => {
    const texto = new File(['esto no es una imagen'], 'qr.png', { type: 'image/png' });
    const r = await leerQrDeImagen(texto);
    expect(r).toEqual({ ok: false, motivo: 'ilegible' });
  });

  it('un archivo vacio dice ilegible', async () => {
    const r = await leerQrDeImagen(new File([], 'vacio.png', { type: 'image/png' }));
    expect(r).toEqual({ ok: false, motivo: 'ilegible' });
  });

  it('un archivo desmesurado se descarta sin abrirlo', async () => {
    // Una imagen valida y legible que solo DECLARA pesar 80 MB: sin la guarda se
    // abriria y se leeria. (Con un Blob falso la prueba pasaba igual sin ella,
    // porque el navegador de prueba rechaza el Blob falso por otra razon.)
    const imagen = imagenDePrueba('qr-kiramo.png');
    Object.defineProperty(imagen, 'size', { value: 80 * 1024 * 1024 });

    const r = await leerQrDeImagen(imagen);

    expect(r).toEqual({ ok: false, motivo: 'ilegible' });
    expect(raster.lecturas).toHaveLength(0);
  });
});

describe('leerQrDeImagen — imagen grande', () => {
  // El riesgo: pasarle a jsQR los 12 millones de pixeles de una foto congela el
  // telefono. Se reduce ANTES de decodificar. Esta prueba mira el tamano de lo
  // que de verdad se le entrego al decodificador, no solo que haya leido bien.
  it('una foto de 12 MP se reduce antes de decodificar y se lee', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('foto-grande.png'));

    expect(r).toEqual({ ok: true, texto: KP });
    // El redondeo de cada lado puede pasarse un poco del presupuesto.
    expect(pixelesMaximos()).toBeLessThanOrEqual(PIXELES_MAXIMOS_DE_LA_PRIMERA_PASADA * 1.01);
    expect(pixelesMaximos()).toBeLessThan(4000 * 3000 * 0.25);
  });

  it('un QR chico en una captura grande se sigue leyendo', async () => {
    // Ocupa un sexto del ancho de una captura de 1170x2532.
    const r = await leerQrDeImagen(imagenDePrueba('captura-qr-pequeno.png'));
    expect(r).toEqual({ ok: true, texto: KP });
  });

  it('un QR diminuto en una foto de 12 MP (4 % del ancho) se lee con la segunda pasada', async () => {
    // En la primera pasada cada modulo queda en menos de 1,5 px y se pierde: la
    // primera pasada no lo ve. Sin la segunda, una foto asi diria "sin QR" con
    // un QR a la vista.
    const r = await leerQrDeImagen(imagenDePrueba('foto-grande-qr-diminuto.png'));

    expect(r).toEqual({ ok: true, texto: KP });
    expect(raster.lecturas).toHaveLength(2);
    expect(pixelesMaximos()).toBeLessThanOrEqual(PIXELES_MAXIMOS_DE_LA_SEGUNDA_PASADA * 1.01);
  });

  it('una foto de 12 MP sin QR dice sin_qr y nunca arma una lectura mayor que el presupuesto de la segunda pasada', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('foto-grande-sin-qr.png'));
    expect(r).toEqual({ ok: false, motivo: 'sin_qr' });
    expect(raster.lecturas).toHaveLength(2);
    expect(pixelesMaximos()).toBeLessThanOrEqual(PIXELES_MAXIMOS_DE_LA_SEGUNDA_PASADA * 1.01);
    expect(pixelesMaximos()).toBeLessThan(4000 * 3000 * 0.55);
  });

  it('un QR de 320 px en una captura larga de 1170 x 15000 se lee', async () => {
    // Reducir por el lado mayor dejaba el ANCHO en 94 px: el QR quedaba de ~30 px
    // y se decia "sin QR" con el codigo a la vista.
    const r = await leerQrDeImagen(imagenDePrueba('captura-larga.png'));
    expect(r).toEqual({ ok: true, texto: KP });
  });

  it('una imagen que ya es chica no se amplia', async () => {
    await leerQrDeImagen(imagenDePrueba('qr-kiramo.png'));
    expect(ladoMaximo()).toBe(360);
  });
});

describe('leerQrDeImagen — no deja nada abierto', () => {
  it('cierra el bitmap despues de leer, con QR o sin el', async () => {
    await leerQrDeImagen(imagenDePrueba('qr-kiramo.png'));
    await leerQrDeImagen(imagenDePrueba('sin-qr.png'));
    expect(raster.bitmapsAbiertos()).toBe(0);
  });

  it('encoge el canvas de cada lectura para soltar su memoria', async () => {
    await leerQrDeImagen(imagenDePrueba('foto-grande-sin-qr.png'));
    expect(raster.lecturas.length).toBeGreaterThan(0);
    expect(raster.lienzosSinLiberar()).toBe(0);
  });
});

describe('leerQrDeImagen — WebView sin createImageBitmap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('abre la imagen con <img> y suelta la URL temporal al terminar', async () => {
    const png = pixelesDePrueba('captura-chat.png');
    const urls = new Set<string>();
    vi.stubGlobal('createImageBitmap', undefined);
    URL.createObjectURL = vi.fn(() => {
      urls.add('blob:prueba');
      return 'blob:prueba';
    });
    URL.revokeObjectURL = vi.fn((u: string) => {
      urls.delete(u);
    });
    // Un <img> de prueba: carga los pixeles del PNG real y los ofrece al canvas.
    class ImagenDePrueba {
      src = '';
      naturalWidth = png.width;
      naturalHeight = png.height;
      width = png.width;
      height = png.height;
      data = png.data;
      decode = () => Promise.resolve();
    }
    vi.stubGlobal('Image', ImagenDePrueba);

    const r = await leerQrDeImagen(imagenDePrueba('captura-chat.png'));

    expect(r).toEqual({ ok: true, texto: KP });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(urls.size).toBe(0);
  });

  it('si el <img> no se puede decodificar dice ilegible y tambien suelta la URL', async () => {
    const urls = new Set<string>();
    vi.stubGlobal('createImageBitmap', undefined);
    URL.createObjectURL = vi.fn(() => {
      urls.add('blob:prueba');
      return 'blob:prueba';
    });
    URL.revokeObjectURL = vi.fn((u: string) => {
      urls.delete(u);
    });
    class ImagenRota {
      src = '';
      decode = () => Promise.reject(new DOMException('rota', 'EncodingError'));
    }
    vi.stubGlobal('Image', ImagenRota);

    const r = await leerQrDeImagen(imagenDePrueba('qr-kiramo.png'));

    expect(r).toEqual({ ok: false, motivo: 'ilegible' });
    expect(urls.size).toBe(0);
  });
});
