export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface ApiError {
  code: string;
  message: string;
}

export function apiSuccess<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function apiError<T>(code: string, message: string): ApiResponse<T> {
  return { success: false, error: { code, message } };
}
