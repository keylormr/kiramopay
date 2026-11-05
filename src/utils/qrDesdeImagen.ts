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
 * decodificador congela el telefono. Se reduce antes, a un PRESUPUESTO DE
 * PIXELES y no a un lado maximo: una captura larga de 1170 x 15000 reducida por
 * su lado mayor quedaba de 94 px de ancho y el QR de 30 px. Solo si esa lectura
 * no encuentra nada se vuelve a intentar con mas resolucion (un QR que ocupa
 * poco de una captura grande pierde modulos al reducirla). Cada intento arma
 * una sola copia de pixeles, nunca mayor que PIXELES_MAXIMOS_DE_LA_SEGUNDA_PASADA.
 *
 * Limite conocido: el bitmap de la imagen se abre completo (createImageBitmap
 * sin tamano) y solo despues se reduce. Una foto de decenas de megapixeles
 * ocupa cientos de MB mientras esta abierta. Reducirla al abrirla exige saber
 * sus dimensiones antes (leer la cabecera de cada formato); la defensa gruesa es
 * el tope de PESO_MAXIMO_EN_BYTES.
 */

export type MotivoDeFalloDeImagen =
  /** La imagen se abrio, pero no hay ningun QR legible en ella. */
  | 'sin_qr'
  /** El archivo no se pudo abrir como imagen (danado, otro formato, demasiado grande). */
  | 'ilegible';

export type LecturaDeImagen =
  | { ok: true; texto: string }
  | { ok: false; motivo: MotivoDeFalloDeImagen };

/** Pixeles de la primera lectura (~1400 x 1400): alcanza para un QR de captura de pantalla. */
export const PIXELES_MAXIMOS_DE_LA_PRIMERA_PASADA = 2_000_000;
/** Pixeles de la segunda (~2800 x 2100), solo si la primera no encontro nada y la imagen era mayor. */
export const PIXELES_MAXIMOS_DE_LA_SEGUNDA_PASADA = 6_000_000;
/** Ningun lado pasa de esto, aunque el presupuesto de pixeles lo permita (100000 x 10 px): el canvas tiene su propio limite. */
const LADO_MAXIMO_ABSOLUTO = 8192;
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

// Cuanto reducir para caber en el presupuesto; nunca amplia.
function escalaPara(ancho: number, alto: number, maxPixeles: number): number {
  return Math.min(
    1,
    Math.sqrt(maxPixeles / (ancho * alto)),
    LADO_MAXIMO_ABSOLUTO / Math.max(ancho, alto),
  );
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
  const pixeles = ctx.getImageData(0, 0, ancho, alto);
  // El canvas ya cumplio: se encoge para soltar su memoria sin esperar al
  // recolector (Safari de iOS retiene la de los canvas grandes y se queda corto).
  lienzo.width = 0;
  lienzo.height = 0;
  return pixeles;
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

    const primera = escalaPara(ancho, alto, PIXELES_MAXIMOS_DE_LA_PRIMERA_PASADA);
    const escalas = [primera];
    if (primera < 1) {
      const segunda = escalaPara(ancho, alto, PIXELES_MAXIMOS_DE_LA_SEGUNDA_PASADA);
      if (segunda > primera) escalas.push(segunda);
    }

    for (let i = 0; i < escalas.length; i++) {
      if (i > 0) await cederElTurno();
      const escala = escalas[i];
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
