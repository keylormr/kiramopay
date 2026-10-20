import type { ApiResponse } from '../types';
import type { PlanPersonal } from './plans.repository';

export type AdminUserStatus = 'active' | 'blocked' | 'suspended' | 'closed' | 'pending_deletion';

/** Respuesta de asignar un plan a mano. No se cobro nada. */
export interface PlanAsignado {
  userId: string;
  plan: PlanPersonal;
  planAnterior: PlanPersonal;
  updatedAt: string;
}

/**
 * A user as the admin console sees it. The identity fields arrive already
 * masked by the server (last digits only, obfuscated mailbox); the full values
 * never reach the client.
 */
export interface AdminUser {
  id: string;
  firstName: string;
  lastName: string;
  /** Nombre de usuario, SIN enmascarar: es lo que soporte tiene que poder dictar. */
  username: string;
  cedulaMasked: string;
  phoneMasked: string;
  emailMasked: string;
  status: AdminUserStatus;
  role: string;
  kycLevel: number;
  createdAt: string;
  lastLoginAt: string | null;
  blockedAt: string | null;
  blockedReason: string;
  blockedByName: string;
  /** Scheduled expiry (ISO-8601). Null when the account never expires. */
  expiresAt: string | null;
  /** Plan personal; free si el servidor no lo manda. */
  plan: PlanPersonal;
}

/**
 * Una solicitud de eliminacion hecha desde la pagina web, con el contacto ya
 * verificado, esperando a que una persona la atienda. La cuenta llega
 * enmascarada desde el servidor; es null si el contacto no corresponde a
 * ninguna cuenta.
 */
export interface SolicitudDeEliminacion {
  id: string;
  /** Por donde pidio: el correo o el telefono con que se registro. */
  contactKind: 'email' | 'phone';
  createdAt: string;
  verifiedAt: string | null;
  account: AdminUser | null;
}

/**
 * Una respuesta escrita a una solicitud de eliminacion (Ley 8968) que no pudo
 * salir sola por correo: la cuenta no tiene a donde mandarla (no_channel) o el
 * correo fallo durante 48 horas (send_failed). Operaciones la entrega por otro
 * medio antes de responderAntesDe y deja constancia.
 */
export interface RespuestaPorEntregar {
  id: string;
  /** scheduled: empezo el plazo (lleva las fechas); blocked: que resolver. */
  tipo: 'scheduled' | 'blocked';
  motivo: 'no_channel' | 'send_failed';
  intentos: number;
  creadaEn: string;
  responderAntesDe: string;
  seEliminaEl: string | null;
  conservaHasta: string | null;
  bloqueos: string[];
  account: AdminUser | null;
}

/** Lo que paso al atender una solicitud. */
export interface ResultadoDeSolicitud {
  /** scheduled (empezo el plazo de 30 dias) | blocked | rejected */
  status: string;
  resultCode: string;
  /** Codigos de lo que impide eliminar (solo cuando status = blocked). */
  blockers: string[];
}

/**
 * Admin repository: remote account blocking. Like kyc/auth this ALWAYS talks
 * to the real backend (the role is enforced server-side); there is no mock
 * adapter.
 */
export interface IAdminRepository {
  /** Exact match by cedula/phone/email, or partial match by name (3+ chars). */
  searchUsers(term: string): Promise<ApiResponse<AdminUser[]>>;
  listBlockedUsers(): Promise<ApiResponse<AdminUser[]>>;
  getUser(id: string): Promise<ApiResponse<AdminUser>>;
  /** Blocks the account and revokes every session. The reason is audited. */
  blockUser(id: string, reason: string): Promise<ApiResponse<AdminUser>>;
  unblockUser(id: string): Promise<ApiResponse<AdminUser>>;
  /**
   * Schedules when the account stops working, or clears it with null. Setting
   * it blocks nothing right away: a sweep on the server closes the account once
   * the moment passes, through the same path as a manual block.
   */
  setUserExpiry(id: string, expiresAt: string | null): Promise<ApiResponse<AdminUser>>;
  /**
   * Asigna el plan personal a mano, para pilotos mientras no exista el cobro.
   * No cobra nada y queda en la auditoria (admin_user_plan_set, riesgo alto).
   * Bajar de plan no borra metas ni tarjetas: solo impide crear nuevas.
   */
  setUserPlan(id: string, plan: PlanPersonal): Promise<ApiResponse<PlanAsignado>>;

  // ── Solicitudes de eliminacion de cuenta (pagina web) ──
  /** La cola: contacto verificado, la mas antigua primero. */
  listDeletionRequests(): Promise<ApiResponse<SolicitudDeEliminacion[]>>;
  /**
   * Corre la eliminacion de la cuenta de la solicitud. Un bloqueo (saldo, dinero
   * en transito) NO es un error: vuelve como status = blocked con sus codigos y
   * no se toco nada. Acepta cuentas bloqueadas, porque aqui hay una persona que
   * las reviso. Queda en la auditoria con el administrador como actor.
   */
  processDeletionRequest(id: string): Promise<ApiResponse<ResultadoDeSolicitud>>;
  /** Cierra la solicitud sin eliminar nada. */
  rejectDeletionRequest(id: string): Promise<ApiResponse<{ rejected: boolean }>>;
  /** Las respuestas escritas que pasaron a operaciones, la de plazo mas cercano primero. */
  listDeletionResponses(): Promise<ApiResponse<RespuestaPorEntregar[]>>;
  /**
   * Deja constancia de que la respuesta se entrego por otro medio. La nota (como
   * se entrego) es obligatoria; queda en la auditoria con el administrador.
   */
  markDeletionResponseDelivered(id: string, nota: string): Promise<ApiResponse<{ delivered: boolean }>>;

  // ── Fondo de promociones (cashback de puntos) ──
  /** Lo que queda en el fondo del que salen los canjes de cashback. */
  saldoPromociones(): Promise<ApiResponse<{ saldoMinor: number }>>;
  /**
   * Registra un deposito de la empresa al fondo. SUBE LA RESERVA PUBLICADA:
   * tiene que corresponder a un deposito real, por eso lleva referencia.
   */
  fondearPromociones(amountMinor: number, referencia: string, idempotencyKey: string): Promise<ApiResponse<{ saldoMinor: number }>>;
}
