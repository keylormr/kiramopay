import { apiError, type ApiResponse } from '../../types';
import { traducirFueraDeReact } from '@/i18n/mensajesDeError';

/**
 * El error que devuelve un adaptador cuando una llamada no salio.
 *
 * Los adaptadores lo armaban a mano y perdian algo de dos maneras:
 *  - con un codigo fijo ('FETCH_FAILED', 'TOTP_CONFIRM_FAILED'...) que pisaba el
 *    que trajo el cliente: un 429 o la falta de red llegaban a la pantalla como
 *    un fallo cualquiera, y la pantalla no podia decir si esperar sirve o si hay
 *    que revisar la conexion;
 *  - con un texto fijo en ingles ('Failed to fetch cards') que se pintaba tal
 *    cual con la app en frances o en espanol.
 *
 * Aqui el codigo, el texto, `data` y `details` del error que trajo el cliente
 * pasan enteros: el cliente ya los deja en el idioma activo o con el texto del
 * servidor (ver i18n/mensajesDeError.ts). Solo cuando no hay error —la
 * respuesta llego, pero vacia— se usa el codigo propio del adaptador, con el
 * texto generico del idioma activo.
 */
export function falla<T>(res: ApiResponse<unknown>, codigoPropio: string): ApiResponse<T> {
  const e = res.error;
  return apiError<T>(
    e?.code || codigoPropio,
    e?.message?.trim() || traducirFueraDeReact('err_generic'),
    e?.data,
    e?.details,
  );
}

/**
 * Un error que nace en el adaptador mismo, sin llamada al servidor (algo que
 * todavia no existe, una cuenta que no esta): su codigo y el texto generico
 * del idioma activo. Las pantallas que lo distinguen lo hacen por el codigo.
 */
export function errorPropio<T>(codigo: string): ApiResponse<T> {
  return apiError<T>(codigo, traducirFueraDeReact('err_generic'));
}
