/**
 * Textos de error que no escribe ninguna pantalla.
 *
 * El cliente HTTP es un modulo plano, sin acceso a `useLanguage()`, y fabricaba
 * sus propios mensajes: "Network request failed. Check your connection." en
 * ingles, "Demasiadas solicitudes..." en espanol fijo. Las pantallas los
 * pintaban tal cual con el patron `mapaDelModulo(codigo) || res.error.message ||
 * t('generico')`, que se repite en decenas de vistas: una persona con la app en
 * frances veia el aviso de red en ingles en medio de una pantalla en frances.
 *
 * Arreglarlo vista por vista dejaba siempre alguna afuera. Aqui el mensaje sale
 * ya traducido al idioma activo, asi que cualquier vista que muestre
 * `res.error.message` recibe un texto correcto sin tocarla.
 *
 * El diccionario activo lo fija LanguageProvider cada vez que cambia el idioma.
 * Mientras no lo fije (o si el idioma todavia no termino de cargar), responde en
 * espanol, igual que `t()`.
 */
import { defaultTranslations, type TranslationKeys } from './translations';

const respaldo = defaultTranslations as unknown as Record<string, string>;
let diccionarioActivo: Record<string, string> = respaldo;

export function fijarDiccionarioActivo(diccionario: TranslationKeys): void {
  diccionarioActivo = diccionario as unknown as Record<string, string>;
}

export function traducirFueraDeReact(clave: keyof TranslationKeys): string {
  return diccionarioActivo[clave] ?? respaldo[clave] ?? clave;
}

/** Codigos que nacen en el propio cliente: el servidor nunca los escribio. */
export type CodigoDelCliente = 'NETWORK_ERROR' | 'SESSION_EXPIRED' | 'SESSION_UNCONFIRMED' | 'RATE_LIMITED';

export function mensajeDelCliente(codigo: CodigoDelCliente): string {
  switch (codigo) {
    case 'NETWORK_ERROR':
      return traducirFueraDeReact('err_network');
    case 'SESSION_EXPIRED':
      return traducirFueraDeReact('err_session_expired');
    // La sesion no se pudo renovar por un fallo pasajero: sigue abierta.
    case 'SESSION_UNCONFIRMED':
      return traducirFueraDeReact('err_session_unconfirmed');
    case 'RATE_LIMITED':
      return traducirFueraDeReact('err_rate_limited');
  }
}

/**
 * Mensaje para un rechazo que SI respondio el servidor.
 *
 * El texto del servidor se respeta: los rechazos 4xx los redacta cada modulo y
 * las vistas los afinan por codigo. Se reemplaza solo cuando ese texto no esta
 * pensado para una persona:
 *  - 5xx: `response.Error` del backend lo pisa a proposito con "internal server
 *    error" para no filtrar detalles internos. Es un texto fijo en ingles.
 *  - INVALID_REQUEST / INVALID_BODY: el cuerpo no se pudo leer; el backend dice
 *    "invalid request" o "invalid request body", que no le dice a nadie que
 *    corregir.
 *  - sin mensaje: antes se inventaba "Request failed with status 404".
 */
const CUERPO_ILEGIBLE = new Set(['INVALID_REQUEST', 'INVALID_BODY']);

export function mensajeDelServidor(estadoHttp: number, codigo: string, mensaje?: string): string {
  if (estadoHttp >= 500) return traducirFueraDeReact('err_server');
  if (CUERPO_ILEGIBLE.has(codigo)) return traducirFueraDeReact('err_invalid_request');
  const limpio = (mensaje ?? '').trim();
  return limpio || traducirFueraDeReact('err_generic');
}
