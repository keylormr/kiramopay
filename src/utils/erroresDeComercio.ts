import { mensajeDeRechazo } from '@/i18n/mensajesDeError';

/**
 * Los rechazos de registrar o editar un comercio, por codigo. Los usan la hoja
 * de registro y la de ajustes del negocio: el servidor responde lo mismo a las
 * dos, y las dos tienen que decirlo igual.
 *
 * Los tres "falta el dato" comparten texto: la pantalla ya no deja enviar con un
 * campo en blanco, asi que llegan solo desde otro cliente, y el texto nombra los
 * tres datos obligatorios.
 */
export const CLAVES_DEL_PERFIL_DE_COMERCIO: Readonly<Record<string, string>> = {
  INVALID_CATEGORY: 'merchant_err_category',
  MERCHANT_NAME_REQUIRED: 'merchant_err_required',
  MERCHANT_CEDULA_REQUIRED: 'merchant_err_required',
  MERCHANT_LEGAL_NAME_REQUIRED: 'merchant_err_required',
  MERCHANT_CEDULA_TYPE_INVALID: 'merchant_err_cedula_type',
  MERCHANT_FIELD_TOO_LONG: 'merchant_err_too_long',
  MERCHANT_DUPLICATE: 'merchant_err_duplicate',
  // El comercio se cerro con la hoja abierta (desde otro telefono, o lo cerro un
  // administrador).
  MERCHANT_CLOSED: 'business_err_cerrado',
};

/** Lo que cabe en las columnas del servidor (name, legal_name, cedula). */
export const LARGO_MAXIMO_DE_COMERCIO = { nombre: 200, razonSocial: 200, cedula: 50 } as const;

/**
 * El texto de un rechazo de registrar o editar un comercio. Un codigo que no
 * conoce, o ninguno, cae a `claveGenerica` (el texto de la pantalla): nunca al
 * mensaje del servidor, que va en ingles y puede traer el del controlador de la
 * base.
 */
export function mensajeDelPerfilDeComercio(
  t: (clave: string) => string,
  error: { code?: string; message?: string } | undefined,
  claveGenerica: string,
): string {
  return mensajeDeRechazo(error, CLAVES_DEL_PERFIL_DE_COMERCIO, claveGenerica, t);
}
