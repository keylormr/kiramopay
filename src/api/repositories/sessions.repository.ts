import type { ApiResponse } from '../types';

/**
 * Una sesion abierta, tal como la ve su dueno. El servidor no manda tokens ni
 * hashes: solo lo que sirve para reconocer un aparato y decidir si se cierra.
 */
export interface DeviceSession {
  id: string;
  /** Nombre del aparato; el servidor manda un texto de respaldo si no lo sabe. */
  deviceName: string;
  /** IP recortada a la red por el servidor: nunca llega completa al cliente. */
  ipMasked: string;
  /** ISO-8601. Cuando se abrio la sesion. */
  createdAt: string;
  /** ISO-8601. Cuando caduca por si sola. */
  expiresAt: string;
  /** Marca la sesion desde la que se hizo la consulta. */
  current: boolean;
}

/**
 * Sesiones por dispositivo. Como auth, mfa, kyc y admin, SIEMPRE va contra el
 * backend real, tambien en modo mock: cerrar una sesion destruye credenciales
 * vivas y eso no se simula en localStorage.
 */
export interface ISessionsRepository {
  /** Las sesiones vivas de la cuenta, la mas reciente primero. */
  listar(): Promise<ApiResponse<DeviceSession[]>>;
  /** Cierra UNA sesion propia; el servidor mata tambien su familia de refresh. */
  cerrar(id: string): Promise<ApiResponse<void>>;
  /** Cierra todas menos la actual. Devuelve cuantas cerro. */
  cerrarLasDemas(): Promise<ApiResponse<number>>;
}
