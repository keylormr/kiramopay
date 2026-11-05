import { Capacitor } from '@capacitor/core';
import { entregarArchivo, type EstadoExport } from '@/utils/entregarArchivo';

/**
 * Compartir el QR propio como imagen.
 *
 * Una captura de pantalla sirve, pero recorta el marco de la app y el codigo
 * queda a medias. La tarjeta lleva el QR GRANDE y con zona de silencio, el
 * nombre de quien cobra y una linea que dice que hacer con ella: quien la
 * recibe por chat la abre desde su galeria con el escaner de KiramoPay
 * (utils/qrDesdeImagen).
 */

const ANCHO = 1080;
const MARGEN = 72;
const LADO_QR = 720;
const ZONA_SILENCIO = 72;
const COLOR_MARCA = '#1d4ed8';
const COLOR_TEXTO = '#0f172a';
const COLOR_SUAVE = '#64748b';
const FUENTE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface TarjetaQr {
  /** El <svg> del QR tal como esta en pantalla. */
  svg: SVGSVGElement;
  /** El nombre de la app, arriba. */
  marca: string;
  /** Quien cobra, o el monto de un cobro. */
  titulo: string;
  subtitulo?: string;
  /** Que hacer con la imagen, abajo. */
  pie: string;
}

/**
 * Parte un texto en lineas que caben en `anchoMax`, por palabras. Si sobra texto
 * despues de `maxLineas`, la ultima termina en puntos suspensivos y cabe. Una
 * palabra mas ancha que la linea se recorta igual.
 */
export function partirEnLineas(
  medir: (texto: string) => number,
  texto: string,
  anchoMax: number,
  maxLineas: number,
): string[] {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);

  const recortar = (linea: string): string => {
    if (medir(linea) <= anchoMax) return linea;
    // Por caracteres, no por unidades UTF-16: un emoji son dos y cortar entre
    // ellas deja un caracter roto.
    const letras = Array.from(linea);
    while (letras.length > 1 && medir(`${letras.join('').trimEnd()}…`) > anchoMax) letras.pop();
    return `${letras.join('').trimEnd()}…`;
  };

  const lineas: string[] = [];
  let i = 0;
  while (i < palabras.length && lineas.length < maxLineas) {
    const esLaUltima = lineas.length === maxLineas - 1;
    let linea = palabras[i++];
    while (i < palabras.length && medir(`${linea} ${palabras[i]}`) <= anchoMax) linea += ` ${palabras[i++]}`;
    // Si despues de la ultima linea sobra texto, esa linea lo lleva y se recorta.
    if (esLaUltima && i < palabras.length) linea = `${linea} ${palabras.slice(i).join(' ')}`;
    lineas.push(recortar(linea));
  }
  return lineas;
}

function cargarImagen(svg: SVGSVGElement): Promise<{ imagen: CanvasImageSource; liberar: () => void }> {
  // Una copia con el tamano de dibujo: un SVG se rasteriza al tamano que declara,
  // y el de la pantalla (200 px) saldria borroso al ampliarlo a 720.
  const copia = svg.cloneNode(true) as SVGSVGElement;
  copia.setAttribute('width', String(LADO_QR));
  copia.setAttribute('height', String(LADO_QR));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copia)], { type: 'image/svg+xml;charset=utf-8' }),
  );
  const imagen = new Image();
  imagen.src = url;
  return imagen.decode().then(
    () => ({ imagen, liberar: () => URL.revokeObjectURL(url) }),
    (e) => {
      URL.revokeObjectURL(url);
      throw e;
    },
  );
}

/** Dibuja la tarjeta y entrega el PNG. Lanza si el navegador no puede dibujarla. */
export async function dibujarTarjetaQr(tarjeta: TarjetaQr): Promise<Blob> {
  const lienzo = document.createElement('canvas');
  lienzo.width = ANCHO;
  lienzo.height = 10;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('canvas no disponible');

  const anchoTexto = ANCHO - 2 * MARGEN;
  const fuentes = {
    marca: `700 52px ${FUENTE}`,
    titulo: `800 64px ${FUENTE}`,
    subtitulo: `500 40px ${FUENTE}`,
    pie: `500 36px ${FUENTE}`,
  };
  const medirCon = (fuente: string) => (s: string) => {
    ctx.font = fuente;
    return ctx.measureText(s).width;
  };
  const lineasTitulo = partirEnLineas(medirCon(fuentes.titulo), tarjeta.titulo, anchoTexto, 2);
  const lineasSubtitulo = tarjeta.subtitulo
    ? partirEnLineas(medirCon(fuentes.subtitulo), tarjeta.subtitulo, anchoTexto, 1)
    : [];
  const lineasPie = partirEnLineas(medirCon(fuentes.pie), tarjeta.pie, anchoTexto, 3);

  // Todo se mide ANTES de dibujar: el alto de la tarjeta depende de cuantas
  // lineas ocupan los textos, y cambiarlo reinicia el contexto del lienzo.
  const BASE_MARCA = MARGEN + 52;
  const INTERLINEA_TITULO = 78;
  const INTERLINEA_SUBTITULO = 54;
  const INTERLINEA_PIE = 48;
  const baseTitulo = BASE_MARCA + 100;
  const baseSubtitulo = baseTitulo + lineasTitulo.length * INTERLINEA_TITULO;
  const finDelTexto = baseSubtitulo + lineasSubtitulo.length * INTERLINEA_SUBTITULO;
  const bloqueQr = LADO_QR + 2 * ZONA_SILENCIO;
  const yQr = finDelTexto + 8;
  const basePie = yQr + bloqueQr + 72;
  const alto = basePie + (lineasPie.length - 1) * INTERLINEA_PIE + MARGEN;

  const { imagen, liberar } = await cargarImagen(tarjeta.svg);
  try {
    lienzo.width = ANCHO;
    lienzo.height = alto;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ANCHO, alto);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = COLOR_MARCA;
    ctx.font = fuentes.marca;
    ctx.fillText(tarjeta.marca, ANCHO / 2, BASE_MARCA);

    ctx.fillStyle = COLOR_TEXTO;
    ctx.font = fuentes.titulo;
    lineasTitulo.forEach((linea, n) => ctx.fillText(linea, ANCHO / 2, baseTitulo + n * INTERLINEA_TITULO));

    ctx.fillStyle = COLOR_SUAVE;
    ctx.font = fuentes.subtitulo;
    lineasSubtitulo.forEach((linea, n) => ctx.fillText(linea, ANCHO / 2, baseSubtitulo + n * INTERLINEA_SUBTITULO));

    // El QR sobre su propio recuadro blanco con borde: la zona de silencio que
    // exigen los lectores, tambien cuando la imagen se abre sobre un chat oscuro.
    const xQr = (ANCHO - bloqueQr) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.beginPath();
    // roundRect llego con Chrome 99 y Safari 16: un WebView mas viejo dibuja el
    // recuadro con las esquinas rectas en vez de no poder compartir nada.
    if (typeof ctx.roundRect === 'function') ctx.roundRect(xQr, yQr, bloqueQr, bloqueQr, 40);
    else ctx.rect(xQr, yQr, bloqueQr, bloqueQr);
    ctx.fill();
    ctx.stroke();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imagen, xQr + ZONA_SILENCIO, yQr + ZONA_SILENCIO, LADO_QR, LADO_QR);

    ctx.fillStyle = COLOR_SUAVE;
    ctx.font = fuentes.pie;
    lineasPie.forEach((linea, n) => ctx.fillText(linea, ANCHO / 2, basePie + n * INTERLINEA_PIE));
  } finally {
    liberar();
  }

  return new Promise<Blob>((resolver, rechazar) => {
    lienzo.toBlob((blob) => (blob ? resolver(blob) : rechazar(new Error('no se pudo generar el PNG'))), 'image/png');
  });
}

/**
 * Entrega la imagen. En el telefono, por el mismo camino que las exportaciones
 * (archivo en la cache y menu de compartir del sistema). En un navegador con Web
 * Share de archivos, el menu del sistema; si ese falla por otra razon que
 * cerrarlo, o el navegador no puede compartir archivos (escritorio), se
 * descarga.
 */
export async function compartirImagenDeQr(blob: Blob, nombre: string, titulo: string): Promise<EstadoExport> {
  if (Capacitor.isNativePlatform()) return entregarArchivo(blob, nombre);

  const archivo = new File([blob], nombre, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: titulo });
      return 'compartido';
    } catch (e) {
      // Cerrar el menu sin elegir nada no es un error ni pide descargar.
      if (e instanceof Error && e.name === 'AbortError') return 'quieto';
    }
  }
  return entregarArchivo(blob, nombre);
}
