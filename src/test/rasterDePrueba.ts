// Capa de dibujo de prueba para leer imagenes en jsdom.
//
// jsdom no trae canvas ni createImageBitmap: sin ellos no hay forma de pasar
// un archivo de imagen por el lector de QR. Esta capa reemplaza SOLO eso: el
// navegador que abre el archivo y lo dibuja a otro tamano. Los pixeles salen
// de PNG reales (src/utils/__tests__/fixtures/qr) y el decodificador de QR que
// los lee es jsQR de verdad, el mismo de produccion: nada devuelve "lo que la
// prueba espera".
//
// Lo que NO prueba: como escala un Chrome o un WebView real, ni como abre un
// JPEG. Eso se mira en un navegador de verdad (ver el PR).

import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

export interface PngDecodificado {
  width: number;
  height: number;
  /** RGBA, 4 bytes por pixel. */
  data: Uint8ClampedArray;
}

/** Decodificador minimo de PNG: 8 bits, sin entrelazado (lo que escribe Chrome). */
export function decodificarPng(bytes: Uint8Array): PngDecodificado {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (firma.some((b, i) => bytes[i] !== b)) throw new Error('No es un PNG');

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let ancho = 0;
  let alto = 0;
  let profundidad = 0;
  let tipo = 0;
  let entrelazado = 0;
  let paleta: Uint8Array | null = null;
  const datos: Uint8Array[] = [];

  while (pos + 8 <= bytes.length) {
    const largo = dv.getUint32(pos);
    const nombre = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const cuerpo = bytes.subarray(pos + 8, pos + 8 + largo);
    if (nombre === 'IHDR') {
      ancho = dv.getUint32(pos + 8);
      alto = dv.getUint32(pos + 12);
      profundidad = cuerpo[8];
      tipo = cuerpo[9];
      entrelazado = cuerpo[12];
    } else if (nombre === 'PLTE') {
      paleta = cuerpo;
    } else if (nombre === 'IDAT') {
      datos.push(cuerpo);
    } else if (nombre === 'IEND') {
      break;
    }
    pos += 12 + largo;
  }

  if (profundidad !== 8 || entrelazado !== 0) throw new Error('PNG no soportado por el helper');
  const canales = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[tipo];
  if (!canales) throw new Error('Tipo de color de PNG no soportado');

  const crudo = inflateSync(Buffer.concat(datos));
  const fila = ancho * canales;
  const pix = new Uint8Array(alto * fila);

  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (fila + 1)];
    const desde = y * (fila + 1) + 1;
    for (let x = 0; x < fila; x++) {
      const actual = crudo[desde + x];
      const izq = x >= canales ? pix[y * fila + x - canales] : 0;
      const arr = y > 0 ? pix[(y - 1) * fila + x] : 0;
      const arrIzq = y > 0 && x >= canales ? pix[(y - 1) * fila + x - canales] : 0;
      let v: number;
      switch (filtro) {
        case 0: v = actual; break;
        case 1: v = actual + izq; break;
        case 2: v = actual + arr; break;
        case 3: v = actual + ((izq + arr) >> 1); break;
        case 4: {
          const p = izq + arr - arrIzq;
          const pa = Math.abs(p - izq);
          const pb = Math.abs(p - arr);
          const pc = Math.abs(p - arrIzq);
          v = actual + (pa <= pb && pa <= pc ? izq : pb <= pc ? arr : arrIzq);
          break;
        }
        default: throw new Error('Filtro de PNG desconocido');
      }
      pix[y * fila + x] = v & 0xff;
    }
  }

  const rgba = new Uint8ClampedArray(ancho * alto * 4);
  for (let i = 0; i < ancho * alto; i++) {
    const o = i * 4;
    if (tipo === 6) {
      rgba.set(pix.subarray(i * 4, i * 4 + 4), o);
    } else if (tipo === 2) {
      rgba[o] = pix[i * 3]; rgba[o + 1] = pix[i * 3 + 1]; rgba[o + 2] = pix[i * 3 + 2]; rgba[o + 3] = 255;
    } else if (tipo === 0) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = pix[i]; rgba[o + 3] = 255;
    } else if (tipo === 4) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = pix[i * 2]; rgba[o + 3] = pix[i * 2 + 1];
    } else if (paleta) {
      const idx = pix[i] * 3;
      rgba[o] = paleta[idx]; rgba[o + 1] = paleta[idx + 1]; rgba[o + 2] = paleta[idx + 2]; rgba[o + 3] = 255;
    }
  }
  return { width: ancho, height: alto, data: rgba };
}

/** Los pixeles de una de las imagenes de prueba, ya decodificados. */
export function pixelesDePrueba(nombre: string): PngDecodificado {
  const ruta = path.resolve(__dirname, '../utils/__tests__/fixtures/qr', nombre);
  return decodificarPng(new Uint8Array(fs.readFileSync(ruta)));
}

/** Lee un archivo de las imagenes de prueba como File, igual que lo entrega un <input type="file">. */
export function imagenDePrueba(nombre: string, tipo = 'image/png'): File {
  const ruta = path.resolve(__dirname, '../utils/__tests__/fixtures/qr', nombre);
  return new File([new Uint8Array(fs.readFileSync(ruta))], nombre, { type: tipo });
}

function leerBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(new Uint8Array(lector.result as ArrayBuffer));
    lector.onerror = () => reject(lector.error);
    lector.readAsArrayBuffer(blob);
  });
}

interface BitmapDePrueba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  close: () => void;
}

/** Lo que el lector pidio a la capa de dibujo: sirve para comprobar que reduce. */
export interface RegistroDeRaster {
  /** Tamano de cada ImageData que el lector construyo para decodificar. */
  lecturas: { ancho: number; alto: number }[];
  /** Bitmaps abiertos y aun sin cerrar: tiene que quedar en 0. */
  bitmapsAbiertos: () => number;
  /** Canvas que se crearon y no se encogieron a 0 x 0 al terminar: tiene que quedar en 0. */
  lienzosSinLiberar: () => number;
  /**
   * Detiene la apertura de la imagen hasta que se llame a lo que devuelve. Para
   * cerrar una hoja EN MEDIO de una lectura sin depender de cuanto tarde: bajo
   * carga una foto de 12 MP puede terminar antes de que la prueba alcance a
   * cerrar nada.
   */
  retener: () => () => void;
  restaurar: () => void;
}

function colorDe(css: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) throw new Error('rasterDePrueba solo entiende colores #rgb o #rrggbb, no ' + css);
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function pintar(
  destino: { w: number; h: number; px: Uint8ClampedArray },
  fuente: BitmapDePrueba,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  // Promedio por area al reducir (lo que hace un navegador con calidad alta) y
  // vecino mas cercano al ampliar. El alfa se mezcla con lo que ya habia: un PNG
  // transparente sobre fondo blanco tiene que quedar sobre blanco.
  const { width: sw, height: sh, data: sp } = fuente;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * sw + xx) * 4;
          const alfa = sp[i + 3];
          r += sp[i] * alfa; g += sp[i + 1] * alfa; b += sp[i + 2] * alfa; a += alfa; n++;
        }
      }
      const px = dx + x;
      const py = dy + y;
      if (px < 0 || py < 0 || px >= destino.w || py >= destino.h) continue;
      const o = (py * destino.w + px) * 4;
      const aProm = a / n / 255; // alfa medio, 0..1
      const k = a > 0 ? 1 / a : 0;
      destino.px[o] = (r * k) * aProm + destino.px[o] * (1 - aProm);
      destino.px[o + 1] = (g * k) * aProm + destino.px[o + 1] * (1 - aProm);
      destino.px[o + 2] = (b * k) * aProm + destino.px[o + 2] * (1 - aProm);
      destino.px[o + 3] = 255 * aProm + destino.px[o + 3] * (1 - aProm);
    }
  }
}

export function instalarRasterDePrueba(): RegistroDeRaster {
  const lecturas: RegistroDeRaster['lecturas'] = [];
  let abiertos = 0;
  const lienzos = new Set<HTMLCanvasElement>();

  const originalBitmap = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  let compuerta: Promise<void> | null = null;

  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async (fuente: Blob) => {
    if (compuerta) await compuerta;
    const bytes = await leerBytes(fuente);
    let png: PngDecodificado;
    try {
      png = decodificarPng(bytes);
    } catch {
      // Lo que hace un navegador ante un archivo que no es una imagen.
      throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
    }
    abiertos++;
    let cerrado = false;
    const bitmap: BitmapDePrueba = {
      width: png.width,
      height: png.height,
      data: png.data,
      close: () => {
        if (!cerrado) abiertos--;
        cerrado = true;
      },
    };
    return bitmap;
  };

  const estado = new WeakMap<HTMLCanvasElement, { px: Uint8ClampedArray; w: number; h: number }>();
  const asegurar = (lienzo: HTMLCanvasElement) => {
    let e = estado.get(lienzo);
    if (!e || e.w !== lienzo.width || e.h !== lienzo.height) {
      e = { w: lienzo.width, h: lienzo.height, px: new Uint8ClampedArray(lienzo.width * lienzo.height * 4) };
      estado.set(lienzo, e);
    }
    return e;
  };

  const contextoDe = (lienzo: HTMLCanvasElement) => {
    const ctx = {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
      fillStyle: '#000',
      fillRect() {
        // Solo se usa para pintar el fondo de un color liso antes de dibujar, y
        // honra fillStyle (#rgb o #rrggbb): si el lector pintara el fondo de otro
        // color, la prueba del PNG transparente tiene que notarlo.
        const e = asegurar(lienzo);
        const [r, g, b] = colorDe(ctx.fillStyle);
        for (let i = 0; i < e.px.length; i += 4) {
          e.px[i] = r; e.px[i + 1] = g; e.px[i + 2] = b; e.px[i + 3] = 255;
        }
      },
      drawImage(fuente: BitmapDePrueba, dx: number, dy: number, dw: number, dh: number) {
        pintar(asegurar(lienzo), fuente, dx, dy, dw, dh);
      },
      getImageData(sx: number, sy: number, sw: number, sh: number) {
        const e = asegurar(lienzo);
        lecturas.push({ ancho: sw, alto: sh });
        // Se entrega una copia, como un ImageData de verdad.
        return { data: new Uint8ClampedArray(e.px), width: sw, height: sh, colorSpace: 'srgb' };
      },
    };
    return ctx as unknown as CanvasRenderingContext2D;
  };

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, tipo: string) {
    if (tipo !== '2d') return null;
    lienzos.add(this);
    return contextoDe(this);
  } as typeof HTMLCanvasElement.prototype.getContext;

  return {
    lecturas,
    bitmapsAbiertos: () => abiertos,
    lienzosSinLiberar: () => [...lienzos].filter((l) => l.width > 0 || l.height > 0).length,
    retener: () => {
      let soltar: () => void = () => {};
      compuerta = new Promise<void>((resolver) => {
        soltar = resolver;
      });
      return () => {
        compuerta = null;
        soltar();
      };
    },
    restaurar: () => {
      compuerta = null;
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = originalBitmap;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    },
  };
}
