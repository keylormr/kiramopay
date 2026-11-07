import type { AdminUser, AdminUserStatus } from '@/api/repositories/admin.repository';
import type { DeviceSession } from '@/api/repositories/sessions.repository';
import { nombreDelDispositivo } from '@/utils/dispositivo';
import { fechaSinCortes } from '@/utils/fechaSinCortes';

export type Translate = (key: string) => string;

/** Lista en filas (telefono) o en tabla (tablet y escritorio). */
export type ModoDeLista = 'filas' | 'tabla';

export const CHIP_BY_STATUS: Record<AdminUserStatus, string> = {
  active: 'uv-chip-success',
  blocked: 'uv-chip-danger',
  suspended: 'uv-chip-warning',
  closed: 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-muted',
  pending_deletion: 'uv-chip-warning',
};

// Contract error codes map to app-language copy; anything unknown falls back to
// the generic message so the raw backend text never reaches the screen.
export function errorKey(code?: string | null): string {
  switch (code) {
    case 'CANNOT_BLOCK_SELF': return 'admin_users_err_self';
    case 'CANNOT_BLOCK_ADMIN': return 'admin_users_err_admin';
    case 'REASON_REQUIRED': return 'admin_users_err_reason';
    case 'SEARCH_TERM_TOO_SHORT': return 'admin_users_search_hint';
    case 'CANNOT_EXPIRE_ADMIN': return 'admin_users_err_expire_admin';
    case 'EXPIRY_REQUIRED':
    case 'INVALID_EXPIRY': return 'admin_users_err_expiry';
    case 'USER_NOT_FOUND': return 'admin_users_err_not_found';
    case 'RATE_LIMITED': return 'admin_users_err_rate';
    case 'PLAN_INVALID':
    case 'PLAN_UPDATE_FAILED': return 'admin_users_err_plan';
    // Aqui solo lo responde el plan: un administrador no se asigna el suyo.
    case 'ADMIN_IS_AFFECTED_PARTY': return 'admin_users_err_own_plan';
    case 'SESSION_NOT_FOUND': return 'sessions_err_gone';
    case 'NETWORK_ERROR': return 'sessions_err_network';
    default: return 'admin_users_action_failed';
  }
}

export function fullName(u: AdminUser): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

/** Dos letras para el avatar: inicial del nombre y del apellido. */
export function iniciales(u: AdminUser): string {
  const letras = [u.firstName, u.lastName]
    .map((p) => p.trim().charAt(0))
    .filter(Boolean)
    .join('');
  return (letras || u.username.charAt(0) || '?').toUpperCase();
}

export function formatWhen(iso: string | null, locale: string, fallback: string): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return fechaSinCortes(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d));
}

/** Fecha corta para una celda de tabla: "5 nov, 8:12 a. m." o "13 nov". La hora va igual que en formatWhen. */
export function fechaCorta(iso: string, locale: string, conHora: boolean): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return fechaSinCortes(new Intl.DateTimeFormat(
    locale,
    conHora ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' },
  ).format(d));
}

export function nombreDeSesion(s: DeviceSession, t: Translate): string {
  return nombreDelDispositivo(s.deviceName, { navegadorEn: t('sessions_device_on'), appEn: t('sessions_device_app'), desconocido: t('sessions_device_unknown') });
}

/** Valor que entiende <input type="datetime-local">: hora LOCAL sin zona. */
export function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Clases de los botones del panel: tamano normal, nunca a todo el ancho de la pantalla. */
export const BOTON = {
  peligro:
    'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-[var(--color-danger-fill)] text-white text-sm font-semibold kp-toque kp-foco disabled:opacity-50',
  secundario:
    'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] ring-1 ring-inset ring-[var(--color-border-strong)] dark:ring-[var(--color-border-strong-dark)] uv-text-primary text-sm font-semibold kp-toque kp-foco disabled:opacity-50',
  cerrar:
    'inline-flex items-center justify-center h-8 px-3 rounded-[10px] ring-1 ring-inset ring-[var(--color-danger)]/40 text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)] text-[13px] font-semibold hover:bg-[var(--color-danger-soft)] kp-toque kp-foco disabled:opacity-50',
  primario:
    'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-semibold kp-toque kp-foco disabled:opacity-50',
} as const;

/** Superficie de tarjeta del panel con su filo, igual en los dos temas. */
export const TARJETA = 'uv-surface-1 rounded-[20px] ring-1 ring-inset ring-[var(--color-border)] dark:ring-[var(--color-border-dark)]';
