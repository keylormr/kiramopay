export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  // `data` en el error: algunos rechazos (p. ej. CONTACT_EXISTS) devuelven el
  // registro con el que chocaron, para que el cliente lo muestre en vez de
  // adivinar. Tipo `unknown` porque no comparte forma con el `data` de exito.
  data?: unknown;
  /**
   * Lo que la pantalla necesita para explicar un rechazo (por ejemplo el plan,
   * el tope y cuantas hay en un SAVINGS_GOAL_LIMIT). El servidor solo lo manda
   * en respuestas 4xx; un adaptador que reescribe el error lo tiene que pasar.
   */
  details?: Record<string, unknown>;
}

/** Un archivo que manda el servidor (un CSV, por ejemplo) y el nombre que sugiere. */
export interface ArchivoDescargado {
  blob: Blob;
  nombre: string;
}

export function apiSuccess<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function apiError<T>(
  code: string,
  message: string,
  data?: unknown,
  details?: Record<string, unknown>,
): ApiResponse<T> {
  const error: ApiError = { code, message };
  if (data !== undefined) error.data = data;
  if (details) error.details = details;
  return { success: false, error };
}

/**
 * El error con `details` (el tope del plan, el plan que haria falta). Los
 * adaptadores que reescriben el codigo o el mensaje lo usan para no perderlo.
 */
export function apiErrorConDetalle<T>(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiResponse<T> {
  return apiError<T>(code, message, undefined, details);
}
