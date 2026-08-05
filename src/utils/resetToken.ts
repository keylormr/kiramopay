/**
 * Lee el token que trae el enlace del correo de recuperación y lo BORRA de la
 * URL en el mismo acto.
 *
 * Borrarlo es el punto, no un prurito de limpieza: ese token es una credencial
 * de un solo uso que cambia la contraseña de la cuenta. Si queda en la barra de
 * direcciones lo ve cualquiera que mire la pantalla, el navegador lo guarda en
 * el historial (y lo sincroniza entre dispositivos), y viaja en la cabecera
 * Referer de cualquier enlace saliente que el usuario toque después. Leerlo una
 * vez a memoria lo saca de las tres superficies.
 *
 * Devuelve '' cuando no hay token, para que el llamador siga al login normal.
 */
export function takeResetToken(): string {
  if (typeof window === 'undefined') return '';

  const params = new URLSearchParams(window.location.search);
  const token = params.get('reset_token');
  if (!token) return '';

  params.delete('reset_token');
  const query = params.toString();
  window.history.replaceState(
    null,
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
  );
  return token;
}
