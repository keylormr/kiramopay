import { ALTO, ANCHO, type Fuente, type Medidor, type Pagina } from './pdfDiseno';
import type { ImagenPdf } from './pdfArchivo';
import { comprimir, empaquetarGris4, sabeComprimir } from './pdfPixeles';

/** Pixeles por punto: 2,5 son unos 180 ppp, nitido al leer y al imprimir. */
export const ESCALA = 2.5;

/** Solo para el respaldo en JPEG de un WebView que no sabe comprimir. */
const CALIDAD_JPEG = 0.85;

// La letra de la app (index.css) y, detras, las del telefono: son estas ultimas
// las que dibujan hindi, japones y chino, y las que dan forma al devanagari.
const FAMILIA = '"Geist", "Inter Colon", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif';

export const aFuente = (f: Fuente) => `${f.peso} ${f.tam}px ${FAMILIA}`;

/**
 * Espera a que las letras de la app esten listas antes de medir y dibujar: un
 * canvas pintado con una letra que aun no bajo sale con la del sistema y con
 * otro ancho. El colon (U+20A1) vive en un archivo aparte que el navegador solo
 * descarga cuando se usa.
 */
export async function cargarFuentes(): Promise<void> {
  const fuentes = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fuentes?.load) return;
  try {
    await Promise.all([
      fuentes.load('400 12px "Geist"'),
      fuentes.load('600 12px "Geist"'),
      fuentes.load('700 12px "Geist"'),
      fuentes.load('400 12px "Inter Colon"', '₡'),
    ]);
  } catch {
    // Sin la letra de la app el PDF sale con la del sistema: legible, no roto.
  }
}

function crearLienzo(idioma: string): HTMLCanvasElement {
  const lienzo = document.createElement('canvas');
  // El idioma del canvas decide que variante de un ideograma comun al japones y
  // al chino se dibuja.
  lienzo.setAttribute('lang', idioma === 'zh-cn' ? 'zh-CN' : idioma);
  return lienzo;
}

export function crearMedidor(idioma: string): Medidor {
  const ctx = crearLienzo(idioma).getContext('2d');
  if (!ctx) throw new Error('SIN_CANVAS');
  return (texto, fuente) => {
    ctx.font = aFuente(fuente);
    return ctx.measureText(texto).width;
  };
}

function aJpeg(lienzo: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolver, rechazar) => {
    lienzo.toBlob(
      (blob) => {
        if (!blob) {
          rechazar(new Error('SIN_JPEG'));
          return;
        }
        blob.arrayBuffer().then((b) => resolver(new Uint8Array(b)), rechazar);
      },
      'image/jpeg',
      CALIDAD_JPEG,
    );
  });
}

/** Dibuja cada pagina en un canvas y la devuelve como imagen lista para el PDF. */
export async function rasterizar(paginas: Pagina[], idioma: string): Promise<ImagenPdf[]> {
  const lienzo = crearLienzo(idioma);
  lienzo.width = Math.round(ANCHO * ESCALA);
  lienzo.height = Math.round(ALTO * ESCALA);
  // Cada pagina se lee de vuelta: con el canvas en memoria normal, y no en la
  // GPU, la lectura es rapida y no gasta la memoria grafica del telefono.
  const ctx = lienzo.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('SIN_CANVAS');
  const imagenes: ImagenPdf[] = [];
  const comprime = sabeComprimir();
  try {
    for (const pagina of paginas) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      ctx.scale(ESCALA, ESCALA);
      ctx.textBaseline = 'alphabetic';
      for (const o of pagina.ordenes) {
        if (o.tipo === 'texto') {
          ctx.font = aFuente(o.fuente);
          ctx.fillStyle = o.color;
          ctx.textAlign = o.alinear === 'izq' ? 'left' : o.alinear === 'der' ? 'right' : 'center';
          ctx.fillText(o.texto, o.x, o.y);
        } else if (o.tipo === 'linea') {
          ctx.fillStyle = o.color;
          ctx.fillRect(o.x1, o.y - o.grosor / 2, o.x2 - o.x1, o.grosor);
        } else {
          ctx.fillStyle = o.color;
          // Con arcTo y no roundRect, que iOS anterior a 16 no trae.
          const r = Math.min(o.radio, o.ancho / 2, o.alto / 2);
          ctx.beginPath();
          ctx.moveTo(o.x + r, o.y);
          ctx.arcTo(o.x + o.ancho, o.y, o.x + o.ancho, o.y + o.alto, r);
          ctx.arcTo(o.x + o.ancho, o.y + o.alto, o.x, o.y + o.alto, r);
          ctx.arcTo(o.x, o.y + o.alto, o.x, o.y, r);
          ctx.arcTo(o.x, o.y, o.x + o.ancho, o.y, r);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (comprime) {
        const { data } = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
        const datos = await comprimir(empaquetarGris4(data, lienzo.width, lienzo.height));
        imagenes.push({ ancho: lienzo.width, alto: lienzo.height, formato: 'gris4', datos });
      } else {
        imagenes.push({ ancho: lienzo.width, alto: lienzo.height, formato: 'jpeg', datos: await aJpeg(lienzo) });
      }
    }
  } finally {
    // Suelta la memoria del bitmap: en iOS un canvas grande no se libera solo.
    lienzo.width = 0;
    lienzo.height = 0;
  }
  return imagenes;
}
