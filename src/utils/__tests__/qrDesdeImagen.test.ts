import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leerQrDeImagen, LADO_MAXIMO_DE_LA_PRIMERA_PASADA, LADO_MAXIMO_DE_LA_SEGUNDA_PASADA } from '../qrDesdeImagen';
import { imagenDePrueba, instalarRasterDePrueba, type RegistroDeRaster } from '@/test/rasterDePrueba';

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
    const enorme = { size: 80 * 1024 * 1024, type: 'image/png' } as unknown as Blob;
    const r = await leerQrDeImagen(enorme);
    expect(r).toEqual({ ok: false, motivo: 'ilegible' });
    expect(raster.bitmapsAbiertos()).toBe(0);
  });
});

describe('leerQrDeImagen — imagen grande', () => {
  // El riesgo: pasarle a jsQR los 12 millones de pixeles de una foto congela el
  // telefono. Se reduce ANTES de decodificar. Esta prueba mira el tamano de lo
  // que de verdad se le entrego al decodificador, no solo que haya leido bien.
  it('una foto de 12 MP se reduce antes de decodificar y se lee', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('foto-grande.png'));

    expect(r).toEqual({ ok: true, texto: KP });
    expect(ladoMaximo()).toBeLessThanOrEqual(LADO_MAXIMO_DE_LA_PRIMERA_PASADA);
    expect(pixelesMaximos()).toBeLessThan(4000 * 3000 * 0.25);
  });

  it('un QR chico en una captura grande se sigue leyendo', async () => {
    // Ocupa un sexto del ancho de una captura de 1170x2532.
    const r = await leerQrDeImagen(imagenDePrueba('captura-qr-pequeno.png'));
    expect(r).toEqual({ ok: true, texto: KP });
  });

  it('un QR diminuto en una foto de 12 MP (3 % del ancho) se lee con la segunda pasada', async () => {
    // A 1600 px de lado cada modulo queda en menos de 2 px y se pierde: la
    // primera pasada no lo ve. Sin la segunda, una foto asi diria "sin QR" con
    // un QR a la vista.
    const r = await leerQrDeImagen(imagenDePrueba('foto-grande-qr-diminuto.png'));

    expect(r).toEqual({ ok: true, texto: KP });
    expect(raster.lecturas).toHaveLength(2);
    expect(ladoMaximo()).toBeLessThanOrEqual(LADO_MAXIMO_DE_LA_SEGUNDA_PASADA);
  });

  it('una foto de 12 MP sin QR dice sin_qr y nunca arma una lectura mayor que la segunda pasada', async () => {
    const r = await leerQrDeImagen(imagenDePrueba('foto-grande-sin-qr.png'));
    expect(r).toEqual({ ok: false, motivo: 'sin_qr' });
    expect(ladoMaximo()).toBeLessThanOrEqual(LADO_MAXIMO_DE_LA_SEGUNDA_PASADA);
    expect(pixelesMaximos()).toBeLessThan(4000 * 3000 * 0.55);
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
});
