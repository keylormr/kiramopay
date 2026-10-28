import type {
  IAuthRepository,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  ChangePasswordRequest,
  ForgotPasswordResult,
  SendRegistrationOtpResult,
  VerifyRegistrationOtpResult,
  TokenPair,
  PreflightDeEliminacion,
  MotivoDeEliminacion,
  EliminarCuentaRequest,
  SolicitudDeEliminacionPropia,
} from '../../repositories/auth.repository';
import type { ApiResponse } from '../../types';
import type { User } from '@/types';
import { apiSuccess } from '../../types';
import { falla } from './falla';
import { normalizarPlan } from '../../../utils/planes';
import { HttpClient } from './client';
import { traducirFueraDeReact } from '@/i18n/mensajesDeError';

export class HttpAuthRepository implements IAuthRepository {
  constructor(private client: HttpClient) {}

  async login(request: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    const res = await this.client.post<{
      user: {
        id: string;
        cedula: string;
        username?: string;
        phone: string;
        first_name: string;
        last_name: string;
        email: string;
        kyc_level: number;
        status: string;
        plan?: string;
        language?: string | null;
      };
      tokens: { access_token: string; refresh_token: string; expires_at: number };
    }>('/api/v1/auth/login', request, false);

    if (!res.success || !res.data) {
      // Keep the backend code (ACCOUNT_BLOCKED, RATE_LIMITED, ...): the login
      // view tells them apart; a fixed AUTH_FAILED collapsed all of them into
      // "wrong credentials".
      return falla(res, 'AUTH_FAILED');
    }

    const { user: u, tokens } = res.data;

    // Map backend user to frontend User type
    const user: User = {
      id: u.id,
      cedula: u.cedula,
      username: u.username || '',
      firstName: u.first_name,
      lastName: u.last_name,
      phone: u.phone,
      email: u.email || '',
      avatar: '',
      createdAt: new Date().toISOString(),
      kycLevel: u.kyc_level as 0 | 1 | 2,
      plan: normalizarPlan(u.plan),
      language: u.language,
    };

    // IMPORTANT: expose the full `tokens` object — the auth store reads
    // `result.data.tokens.access_token` to feed the in-memory provider that
    // HttpClient consults on every request. Returning only the legacy
    // `token` field leaves the store with accessToken=null → every
    // subsequent request is unauthenticated.
    return apiSuccess<LoginResponse>({
      user,
      token: tokens.access_token,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
      },
    });
  }

  async register(
    request: RegisterRequest,
  ): Promise<ApiResponse<{ user: User; tokens?: { access_token: string; refresh_token: string } }>> {
    const res = await this.client.post<{
      user: {
        id: string;
        cedula: string;
        username?: string;
        phone: string;
        first_name: string;
        last_name: string;
        email: string;
        referral_code?: string;
        plan?: string;
        language?: string | null;
      };
      tokens: { access_token: string; refresh_token: string };
    }>(
      '/api/v1/auth/register',
      {
        cedula: request.cedula,
        // Solo viaja si el usuario eligio uno: sin el, la cuenta queda sin
        // nombre de usuario y entra por los otros tres identificadores.
        username: request.username || undefined,
        phone: request.phone,
        first_name: request.firstName,
        last_name: request.lastName,
        email: request.email,
        password: request.password,
        verification_token: request.verificationToken,
        // undefined se omite en el JSON: sin codigo no viaja la clave.
        referral_code: request.referralCode,
      },
      false,
    );

    if (!res.success || !res.data) {
      // Conservar el codigo del backend: la UI distingue un codigo de
      // invitacion inexistente (REFERRAL_CODE_INVALID) del error generico.
      return falla(res, 'REGISTER_FAILED');
    }

    const { user: u, tokens } = res.data;

    const user: User = {
      id: u.id,
      cedula: u.cedula,
      username: u.username || '',
      firstName: u.first_name,
      lastName: u.last_name,
      phone: u.phone,
      email: u.email || '',
      avatar: '',
      createdAt: new Date().toISOString(),
      kycLevel: 0,
      referralCode: u.referral_code,
      plan: normalizarPlan(u.plan),
      language: u.language,
    };

    return apiSuccess({
      user,
      tokens: { access_token: tokens.access_token, refresh_token: tokens.refresh_token },
    });
  }

  async validatePassword(
    _cedula: string,
    password: string,
  ): Promise<ApiResponse<{ valid: boolean }>> {
    return apiSuccess({ valid: password.length >= 8 });
  }

  async changePassword(
    request: ChangePasswordRequest,
  ): Promise<ApiResponse<{ changed: boolean }>> {
    const res = await this.client.post('/api/v1/auth/change-password', {
      old_password: request.oldPassword,
      new_password: request.newPassword,
    });

    if (!res.success) {
      // El codigo pasa: la pantalla elige el texto por codigo, y pisado con el
      // de aqui decia "contrasena incorrecta" tambien sin red o cuando la
      // nueva era igual a la actual.
      return falla(res, 'CHANGE_PASSWORD_FAILED');
    }

    return apiSuccess({ changed: true });
  }

  async deletionPreflight(): Promise<ApiResponse<PreflightDeEliminacion>> {
    const res = await this.client.get<{
      eligible: boolean;
      reason?: MotivoDeEliminacion;
      blockers: { code: string }[] | null;
      requires_totp: boolean;
      requires_response_email?: boolean;
    }>('/api/v1/users/me/delete-account/preflight');
    if (!res.success || !res.data) {
      return falla(res, 'PREFLIGHT_FAILED');
    }
    const d = res.data;
    return apiSuccess({
      elegible: !!d.eligible,
      motivo: d.reason,
      bloqueos: (d.blockers ?? []).map((b) => b.code),
      pideSegundoFactor: !!d.requires_totp,
      pideCorreoParaRespuesta: !!d.requires_response_email,
    });
  }

  async deleteAccount(request: EliminarCuentaRequest): Promise<ApiResponse<SolicitudDeEliminacionPropia>> {
    const res = await this.client.post<{
      already_requested?: boolean;
      requested_at?: string;
      deletion_due_at?: string;
    }>('/api/v1/users/me/delete-account', {
      password: request.password,
      // undefined se omite del JSON: sin autenticador no viaja la clave.
      totp_code: request.totpCode,
      accept_terms: request.acceptTerms,
      // Igual: solo viaja si la cuenta no tiene correo y la persona dio uno.
      ...(request.responseEmail ? { response_email: request.responseEmail } : {}),
      ...(request.responseEmailConfirmation ? { response_email_confirmation: request.responseEmailConfirmation } : {}),
    });
    if (!res.success) {
      // El codigo y el detalle pasan: la pantalla elige el texto por codigo y,
      // en DELETION_BLOCKED, lista lo que hay que resolver.
      return falla(res, 'DELETION_FAILED');
    }
    return apiSuccess({
      yaPedida: !!res.data?.already_requested,
      solicitadaEn: res.data?.requested_at ?? '',
      seEliminaEl: res.data?.deletion_due_at ?? '',
    });
  }

  async sendRegistrationOtp(phone: string, email: string): Promise<ApiResponse<SendRegistrationOtpResult>> {
    // auth=false: el registro ocurre antes de tener sesión. El código viaja al
    // correo; `dev_code` solo aparece con el backend en desarrollo.
    const res = await this.client.post<{ message?: string; dev_code?: string }>(
      '/api/v1/auth/register/otp/send',
      { phone, email },
      false,
    );

    if (!res.success) {
      return falla(res, 'OTP_SEND_FAILED');
    }

    return apiSuccess<SendRegistrationOtpResult>({ devCode: res.data?.dev_code });
  }

  async verifyRegistrationOtp(phone: string, code: string): Promise<ApiResponse<VerifyRegistrationOtpResult>> {
    const res = await this.client.post<{ verification_token?: string }>(
      '/api/v1/auth/register/otp/verify',
      { phone, code },
      false,
    );

    if (!res.success || !res.data?.verification_token) {
      return falla(res, 'OTP_INVALID');
    }

    return apiSuccess<VerifyRegistrationOtpResult>({ verificationToken: res.data.verification_token });
  }

  async forgotPassword(identificador: string): Promise<ApiResponse<ForgotPasswordResult>> {
    // auth=false: this is an unauthenticated endpoint. The backend replies 202
    // with a constant message whether or not the account exists
    // (anti-enumeration), so a `success` result here does NOT imply it exists.
    //
    // Se manda `identifier` —nombre de usuario, cedula, correo o telefono— y
    // ademas `cedula` como alias legado, igual que en el login: el servidor
    // sigue leyendo el segundo si el primero no viene.
    const res = await this.client.post<{ message?: string; dev_token?: string }>(
      '/api/v1/auth/forgot-password',
      { identifier: identificador, cedula: identificador },
      false,
    );

    if (!res.success) {
      return falla(res, 'FORGOT_PASSWORD_FAILED');
    }

    // `dev_token` is only present when the backend runs in a dev environment.
    return apiSuccess<ForgotPasswordResult>({ devToken: res.data?.dev_token });
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<ApiResponse<{ reset: boolean }>> {
    const res = await this.client.post(
      '/api/v1/auth/reset-password',
      { token, new_password: newPassword },
      false,
    );

    if (!res.success) {
      // Preserve the backend code so the UI can distinguish an invalid/expired
      // token (RESET_FAILED) from a weak password (VALIDATION_ERROR) and show
      // the right localized guidance.
      return falla(res, 'RESET_PASSWORD_FAILED');
    }

    return apiSuccess({ reset: true });
  }

  async refresh(refreshToken: string): Promise<ApiResponse<TokenPair>> {
    // auth=false: the refresh token travels in the body, not the Authorization
    // header — and this MUST NOT trigger the HttpClient's 401 refresh loop.
    const res = await this.client.post<{
      access_token: string;
      refresh_token: string;
      expires_at?: number;
    }>('/api/v1/auth/refresh', { refresh_token: refreshToken }, false);

    if (!res.success || !res.data) {
      // El codigo original viaja tal cual. Antes todo fallo salia como
      // REFRESH_FAILED, y el arranque no podia distinguir una sesion invalida
      // (REFRESH_FAILED, ACCOUNT_BLOCKED) de un corte pasajero (NETWORK_ERROR,
      // RATE_LIMITED, un 5xx): cerraba la sesion por un parpadeo de la red.
      return falla(res, 'REFRESH_FAILED');
    }
    return apiSuccess<TokenPair>({
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token,
      expires_at: res.data.expires_at,
    });
  }

  async logout(): Promise<ApiResponse<void>> {
    await this.client.post('/api/v1/auth/logout');
    this.client.clearTokens();
    return apiSuccess(undefined as unknown as void);
  }

  async registrarActividad(): Promise<ApiResponse<void>> {
    // Con el token de acceso (auth=true): si vencio, la renovacion de siempre
    // lo resuelve; si la sesion ya paso la ventana de inactividad, el servidor
    // responde 401 y esa renovacion se rechaza.
    return this.client.post<void>('/api/v1/auth/activity');
  }

  async setLanguage(language: string): Promise<ApiResponse<void>> {
    const res = await this.client.put<void>('/api/v1/users/me/language', { language });
    if (!res.success) {
      // El codigo, el texto y los detalles que trajo el cliente pasan enteros
      // (sin red, sesion vencida, un rechazo del servidor): el cliente ya los
      // deja en el idioma activo. Sin ninguno, el codigo propio con el texto
      // generico del idioma activo, nunca una frase fija en ingles.
      const e = res.error;
      return {
        success: false,
        error: {
          code: e?.code || 'LANGUAGE_FAILED',
          message: e?.message?.trim() || traducirFueraDeReact('err_generic'),
          ...(e?.data !== undefined ? { data: e.data } : {}),
          ...(e?.details ? { details: e.details } : {}),
        },
      };
    }
    return apiSuccess(undefined as unknown as void);
  }

  async getProfile(): Promise<ApiResponse<User>> {
    const res = await this.client.get<{
      id: string;
      cedula: string;
      username?: string;
      phone: string;
      first_name: string;
      last_name: string;
      email: string;
      kyc_level: number;
      profile_picture_url?: string;
      created_at?: string;
      referral_code?: string;
      plan?: string;
      language?: string | null;
    }>('/api/v1/users/me');

    if (!res.success || !res.data) {
      return falla(res, 'PROFILE_FAILED');
    }

    const u = res.data;
    const user: User = {
      id: u.id,
      cedula: u.cedula,
      username: u.username || '',
      firstName: u.first_name,
      lastName: u.last_name,
      phone: u.phone,
      email: u.email || '',
      avatar: u.profile_picture_url || '',
      createdAt: u.created_at || new Date().toISOString(),
      kycLevel: u.kyc_level as 0 | 1 | 2,
      referralCode: u.referral_code,
      plan: normalizarPlan(u.plan),
      language: u.language,
    };
    return apiSuccess<User>(user);
  }
}
