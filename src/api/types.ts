export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  // `data` en el error: algunos rechazos (p. ej. CONTACT_EXISTS) devuelven el
  // registro con el que chocaron, para que el cliente lo muestre en vez de
  // adivinar. Tipo `unknown` porque no comparte forma con el `data` de exito.
  error?: { code: string; message: string; data?: unknown };
}

export interface ApiError {
  code: string;
  message: string;
}

export function apiSuccess<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function apiError<T>(code: string, message: string, data?: unknown): ApiResponse<T> {
  return { success: false, error: { code, message, data } };
}
