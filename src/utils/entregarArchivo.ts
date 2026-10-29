import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Como termino una exportacion. `listo` es la descarga del navegador;
 * `compartido`, que en el telefono la persona eligio a donde mandar el archivo
 * desde el menu del sistema. `quieto` tambien es el resultado de cerrar ese menu
 * sin compartir: no hay nada que avisar.
 */
export type EstadoExport = 'quieto' | 'exportando' | 'listo' | 'compartido' | 'error' | 'plan' | 'solo_web';

/**
 * Entrega un archivo exportado a quien lo pidio. Es el unico camino para todas
 * las exportaciones de la app: los movimientos (CSV y JSON) y el reporte del
 * comercio.
 *
 * En el navegador lo descarga con un enlace. En la app del telefono ese enlace
 * no hace nada (el WebView de Android ignora una URL blob: y el puente de
 * Capacitor no registra quien atienda la descarga), asi que ahi el archivo se
 * escribe en la cache de la app y se abre el menu de compartir del sistema con
 * ese archivo: la persona lo guarda en Archivos o Drive, o lo manda por correo.
 *
 * Un binario anterior a los plugins de archivos y de compartir sigue diciendo
 * que hoy se exporta desde la web: nunca un "listo" falso.
 */
export async function entregarArchivo(blob: Blob, nombre: string): Promise<EstadoExport> {
  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable('Filesystem') || !Capacitor.isPluginAvailable('Share')) return 'solo_web';
    return compartirDesdeElTelefono(blob, nombre);
  }
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'listo';
}

async function compartirDesdeElTelefono(blob: Blob, nombre: string): Promise<EstadoExport> {
  let uri: string;
  try {
    // Sin `encoding`, el plugin decodifica el base64 y escribe los bytes tal
    // cual: el BOM y los acentos del CSV llegan intactos.
    const escrito = await Filesystem.writeFile({
      path: nombreSeguro(nombre),
      directory: Directory.Cache,
      data: await enBase64(blob),
    });
    uri = escrito.uri;
  } catch {
    return 'error';
  }
  try {
    await Share.share({ title: nombre, files: [uri] });
    return 'compartido';
  } catch (e) {
    // El plugin rechaza con "Share canceled" cuando la persona cierra el menu
    // sin elegir nada (Android e iOS). Eso no es un error ni un "listo".
    return /cancel/i.test(e instanceof Error ? e.message : String(e)) ? 'quieto' : 'error';
  }
}

/** El nombre como archivo dentro de la cache, sin barras que lo manden a otra carpeta. */
function nombreSeguro(nombre: string): string {
  return nombre.replace(/[\\/]/g, '-');
}

async function enBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = '';
  // Por tramos: String.fromCharCode con un archivo grande entero desborda la pila.
  const TRAMO = 0x8000;
  for (let i = 0; i < bytes.length; i += TRAMO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TRAMO));
  }
  return btoa(binario);
}
