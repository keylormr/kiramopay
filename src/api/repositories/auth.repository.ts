import type { ApiResponse } from '../types';
import type { User } from '@/types';

export interface LoginRequest {
  /**
   * Cedula, correo o telefono en forma canonica (ver clasificarIdentificador).
   * El backend decide el tipo por forma.
   */
  identifier: string;
  /**
   * Alias legado: se manda ADEMAS cuando el identificador es una cedula, para
   * que el login siga funcionando contra un backend anterior durante la
   * ventana de despliegue.
   */
  cedula?: string;
  password: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

export interface LoginResponse {
  user: User;
  /** @deprecated Use tokens.access_token; kept for back-compat. */
  token?: string;
  tokens?: TokenPair;
}

export interface RegisterRequest {
  /** Nombre de usuario elegido (opcional). */
  username?: string;
  cedula: string;
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  password: string;
  /** Token de un solo uso emitido por verifyRegistrationOtp (prueba el OTP). */
  verificationToken?: string;
  /**
   * Código de invitación de otro usuario (8 caracteres, ya normalizado). Se
   * manda solo si el invitado lo tiene; el backend responde
   * REFERRAL_CODE_INVALID cuando no existe.
   */
  referralCode?: string;
}

export interface SendRegistrationOtpResult {
  /** Solo en desarrollo: eco del código para probar sin buzón real. */
  devCode?: string;
}

export interface VerifyRegistrationOtpResult {
  verificationToken: string;
}

export interface RegisterResponse {
  user: User;
  tokens?: TokenPair;
}

export interface ChangePasswordRequest {
  cedula: string;
  oldPassword: string;
  newPassword: string;
}

export interface ForgotPasswordResult {
  /**
   * Only ever populated when the backend runs in a development environment,
   * as a testing convenience. In production it is always undefined — the real
   * reset token is delivered out-of-band (SMS/email). The UI must gate any
   * display of it behind `import.meta.env.DEV`.
   */
  devToken?: string;
}

/**
 * Lo que impide eliminar la cuenta todavia. Son codigos del backend (la pantalla
 * los traduce, nunca muestra el texto del servidor).
 */
export type BloqueoDeEliminacion =
  | 'BALANCE_POSITIVE'
  | 'SAVINGS_BALANCE'
  | 'CRYPTO_BALANCE'
  | 'STAKING_ACTIVE'
  | 'REGIONAL_BALANCE'
  | 'MERCHANT_BALANCE'
  | 'MERCHANT_PENDING_CHARGES'
  | 'TX_PENDING'
  | 'ESCROW_OPEN'
  | 'PAYOUT_PENDING'
  | 'CROSS_BORDER_PENDING'
  | 'MARKETPLACE_IN_PROGRESS';

/** Por que esta cuenta no puede usar la via de la app, cuando no es cuestion de saldo. */
export type MotivoDeEliminacion = 'DEMO_ACCOUNT' | 'ADMIN_ACCOUNT' | 'ACCOUNT_NOT_ELIGIBLE';

export interface PreflightDeEliminacion {
  elegible: boolean;
  motivo?: MotivoDeEliminacion;
  /** Nunca null: vacio cuando no hay nada que resolver. */
  bloqueos: string[];
  /** La confirmacion pedira ademas el codigo del autenticador. */
  pideSegundoFactor: boolean;
}

export interface EliminarCuentaRequest {
  password: string;
  /** Solo si el autenticador esta encendido. */
  totpCode?: string;
}

export interface IAuthRepository {
  login(request: LoginRequest): Promise<ApiResponse<LoginResponse>>;
  register(request: RegisterRequest): Promise<ApiResponse<RegisterResponse>>;
  /**
   * Pide el código de verificación del registro. Viaja al CORREO (SES es el
   * canal real hoy); el teléfono es la identidad a la que queda atado.
   */
  sendRegistrationOtp(phone: string, email: string): Promise<ApiResponse<SendRegistrationOtpResult>>;
  /** Canjea el código por el token de un solo uso que consume register(). */
  verifyRegistrationOtp(phone: string, code: string): Promise<ApiResponse<VerifyRegistrationOtpResult>>;
  validatePassword(cedula: string, password: string): Promise<ApiResponse<{ valid: boolean }>>;
  changePassword(request: ChangePasswordRequest): Promise<ApiResponse<{ changed: boolean }>>;
  /**
   * Requests a password-reset token for the given cédula. Resolves successfully
   * regardless of whether the account exists (anti-enumeration) — a failure
   * here signals a transport/rate-limit problem, never "account not found".
   */
  /** Acepta lo mismo que el login: nombre de usuario, cedula, correo o telefono. */
  forgotPassword(identificador: string): Promise<ApiResponse<ForgotPasswordResult>>;
  /** Consumes a reset token and sets a new password for the owning account. */
  resetPassword(token: string, newPassword: string): Promise<ApiResponse<{ reset: boolean }>>;
  /** Exchanges a refresh token for a fresh token pair (rotation). */
  refresh(refreshToken: string): Promise<ApiResponse<TokenPair>>;
  logout(): Promise<ApiResponse<void>>;
  /**
   * Pregunta si la cuenta se puede eliminar ahora, sin tocar nada. Los codigos
   * de `bloqueos` son lo que la persona puede resolver antes.
   */
  deletionPreflight(): Promise<ApiResponse<PreflightDeEliminacion>>;
  /**
   * Elimina la cuenta de quien esta conectado, reautenticandolo. La fila no se
   * borra: queda como tumba y el historial del dinero se conserva (ver la
   * politica de privacidad). En un 409 DELETION_BLOCKED, `error.details.blockers`
   * trae los codigos pendientes.
   */
  deleteAccount(request: EliminarCuentaRequest): Promise<ApiResponse<{ alreadyDeleted: boolean }>>;
  /**
   * Fetches the authenticated user's profile (GET /users/me). Used on cold
   * start to rehydrate the profile from the backend so PII (cedula/phone/email)
   * never has to be persisted in localStorage.
   */
  getProfile(): Promise<ApiResponse<User>>;
}
