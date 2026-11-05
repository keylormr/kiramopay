/**
 * Lee un codigo QR desde una imagen: la captura o la foto que llego por chat.
 *
 * El escaner solo leia con la camara o con el codigo escrito a mano, asi que un
 * QR recibido por chat no se podia pagar con el mismo telefono. Esto es la
 * tercera via de entrada: entrega el texto crudo, igual que las otras dos, y lo
 * que se haga con el (validarlo, mostrar a quien se le paga, pedir confirmacion)
 * es del flujo que lo recibe. Este modulo no juzga el contenido.
 *
 * Una imagen de 12 megapixeles son 48 MB de pixeles: pasarsela completa al
 * decodificador congela el telefono. Se reduce antes, y solo si esa lectura no
 * encuentra nada se vuelve a intentar con mas resolucion (un QR que ocupa poco
 * de una captura grande pierde modulos al reducirla). Cada intento arma una
 * sola copia de pixeles, nunca mas grande que LADO_MAXIMO_DE_LA_SEGUNDA_PASADA.
 */

export type MotivoDeFalloDeImagen =
  /** La imagen se abrio, pero no hay ningun QR legible en ella. */
  | 'sin_qr'
  /** El archivo no se pudo abrir como imagen (danado, otro formato, demasiado grande). */
  | 'ilegible';

export type LecturaDeImagen =
  | { ok: true; texto: string }
  | { ok: false; motivo: MotivoDeFalloDeImagen };

/** Lado mayor, en pixeles, de la primera lectura: alcanza para un QR de captura de pantalla. */
export const LADO_MAXIMO_DE_LA_PRIMERA_PASADA = 1600;
/** Lado mayor de la segunda, solo si la primera no encontro nada y la imagen era mas grande. */
export const LADO_MAXIMO_DE_LA_SEGUNDA_PASADA = 2800;
/** Mas pesado que esto no se intenta abrir: no es una foto ni una captura. */
const PESO_MAXIMO_EN_BYTES = 30 * 1024 * 1024;

interface ImagenAbierta {
  fuente: CanvasImageSource;
  ancho: number;
  alto: number;
  liberar: () => void;
}

// createImageBitmap decodifica fuera del hilo principal y no necesita una URL;
// el <img> queda para un WebView que no lo tenga. Si createImageBitmap EXISTE y
// rechaza, el archivo no es una imagen que este navegador pueda abrir: no se
// insiste con otro camino.
async function abrirImagen(archivo: Blob): Promise<ImagenAbierta> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(archivo);
    return {
      fuente: bitmap,
      ancho: bitmap.width,
      alto: bitmap.height,
      liberar: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      fuente: img,
      ancho: img.naturalWidth,
      alto: img.naturalHeight,
      liberar: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function rasterizar(fuente: CanvasImageSource, ancho: number, alto: number): ImageData | null {
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  // Fondo blanco primero: un PNG con fondo transparente (un QR exportado, una
  // captura recortada) tiene pixeles RGBA = 0, y jsQR ignora el alfa: sin el
  // fondo veria un cuadro negro.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fuente, 0, 0, ancho, alto);
  return ctx.getImageData(0, 0, ancho, alto);
}

// Los pixeles ya no hacen falta tal como estaban: se invierten sobre la misma
// copia en vez de armar otra (en una foto grande son decenas de MB). El alfa se
// deja; jsQR lo ignora.
function invertirEnSitio(datos: Uint8ClampedArray): void {
  for (let i = 0; i < datos.length; i += 4) {
    datos[i] = 255 - datos[i];
    datos[i + 1] = 255 - datos[i + 1];
    datos[i + 2] = 255 - datos[i + 2];
  }
}

// Entre una lectura y la siguiente el navegador respira: si la primera tardo, la
// pantalla ya pudo pintar el aviso de "leyendo" antes de la segunda.
const cederElTurno = () => new Promise<void>((resolver) => setTimeout(resolver, 0));

export async function leerQrDeImagen(archivo: Blob): Promise<LecturaDeImagen> {
  if (archivo.size > PESO_MAXIMO_EN_BYTES) return { ok: false, motivo: 'ilegible' };

  let abierta: ImagenAbierta;
  try {
    abierta = await abrirImagen(archivo);
  } catch {
    return { ok: false, motivo: 'ilegible' };
  }

  try {
    const { ancho, alto } = abierta;
    if (!(ancho > 0 && alto > 0)) return { ok: false, motivo: 'ilegible' };

    // jsQR (~110 KB) se carga solo cuando hay una imagen que leer, igual que con
    // la camara.
    const jsQR = (await import('jsqr')).default;

    const lado = Math.max(ancho, alto);
    const pasadas = [Math.min(lado, LADO_MAXIMO_DE_LA_PRIMERA_PASADA)];
    if (lado > LADO_MAXIMO_DE_LA_PRIMERA_PASADA) {
      pasadas.push(Math.min(lado, LADO_MAXIMO_DE_LA_SEGUNDA_PASADA));
    }

    for (let i = 0; i < pasadas.length; i++) {
      if (i > 0) await cederElTurno();
      const escala = pasadas[i] / lado;
      const w = Math.max(1, Math.round(ancho * escala));
      const h = Math.max(1, Math.round(alto * escala));
      const pixeles = rasterizar(abierta.fuente, w, h);
      if (!pixeles) return { ok: false, motivo: 'ilegible' };
      const normal = jsQR(pixeles.data, pixeles.width, pixeles.height, {
        inversionAttempts: 'dontInvert',
      });
      if (normal && normal.data) return { ok: true, texto: normal.data };

      // A diferencia de la camara, una imagen de chat puede venir en modo
      // oscuro (QR claro sobre fondo oscuro): aqui tambien se prueba al reves.
      // Se invierte a mano, en dos lecturas con un respiro en medio, y no con
      // 'attemptBoth': juntas son una sola tarea que en una foto grande sin QR
      // bloquea el hilo principal casi el doble. 'onlyInvert' de jsQR tampoco
      // sirve: no calcula la version invertida y lanza una excepcion.
      await cederElTurno();
      invertirEnSitio(pixeles.data);
      const invertido = jsQR(pixeles.data, pixeles.width, pixeles.height, {
        inversionAttempts: 'dontInvert',
      });
      if (invertido && invertido.data) return { ok: true, texto: invertido.data };
    }
    return { ok: false, motivo: 'sin_qr' };
  } finally {
    abierta.liberar();
  }
}
