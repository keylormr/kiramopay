import { Capacitor } from '@capacitor/core';

export type EstadoExport = 'quieto' | 'exportando' | 'listo' | 'error' | 'plan' | 'solo_web';

/**
 * Entrega el CSV a quien lo pidio. En el navegador lo descarga. En la app del
 * telefono un enlace de descarga no hace nada (el WebView lo ignora en
 * silencio), asi que ahi se ofrece compartir el archivo si el sistema lo deja
 * y, si no, se dice que hoy se exporta desde la web: nunca un "listo" falso.
 */
export async function entregarArchivo(blob: Blob, nombre: string): Promise<EstadoExport> {
  if (Capacitor.isNativePlatform()) {
    const nav = navigator as Navigator & { canShare?: (datos: ShareData) => boolean };
    const archivo = typeof File === 'function' ? new File([blob], nombre, { type: 'text/csv' }) : null;
    if (archivo && nav.share && nav.canShare?.({ files: [archivo] })) {
      try {
        await nav.share({ files: [archivo], title: nombre });
        return 'listo';
      } catch {
        return 'quieto';
      }
    }
    return 'solo_web';
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
