/**
 * Compartir el enlace de la app (campaña promocional y bloque "Invita y gana"
 * del perfil comparten esta plomería para no duplicarla).
 */
export const URL_APP = 'https://kiramopay.com';

/** Enlace de invitación con el código del usuario; sin código, la portada. */
export function enlaceInvitacion(codigo?: string): string {
  return codigo ? `${URL_APP}/?ref=${encodeURIComponent(codigo)}` : URL_APP;
}

/**
 * Abre la hoja nativa de compartir si existe; si no (o si el usuario la
 * cancela), copia "texto url" al portapapeles. 'nada' cuando tampoco hay
 * portapapeles: el llamador decide qué mostrar.
 */
export async function compartirEnlace(
  texto: string,
  url: string,
): Promise<'compartido' | 'copiado' | 'nada'> {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'KiramoPay', text: texto, url });
      return 'compartido';
    }
  } catch {
    // compartir cancelado: cae al portapapeles
  }
  try {
    await navigator.clipboard.writeText(`${texto} ${url}`);
    return 'copiado';
  } catch {
    return 'nada';
  }
}
