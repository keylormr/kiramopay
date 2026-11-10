import type { ContenidoPdf } from './pdfContenido';
import { disenar, ALTO, ANCHO } from './pdfDiseno';
import { armarPdf } from './pdfArchivo';
import { cargarFuentes, crearMedidor, rasterizar } from './pdfDibujo';

/**
 * El PDF del resumen para el contador. Se arma entero en el telefono: la
 * pantalla ya tiene los datos, el canvas los dibuja y el resultado es un Blob
 * que `entregarArchivo` deja en la cache de la app y comparte. Nada sale a la
 * red.
 */
export async function construirPdf(contenido: ContenidoPdf, idioma: string, fecha: Date = new Date()): Promise<Blob> {
  await cargarFuentes();
  const paginas = disenar(contenido, crearMedidor(idioma));
  const imagenes = await rasterizar(paginas, idioma);
  const bytes = armarPdf(imagenes, { titulo: contenido.titulo, idioma, fecha, ancho: ANCHO, alto: ALTO });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
