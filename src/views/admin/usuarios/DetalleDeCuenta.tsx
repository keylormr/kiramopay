import React, { useEffect, useRef } from 'react';
import { Icons } from '@/components/Icons';
import { IconoDeDispositivo } from '@/components/IconoDeDispositivo';
import type { AdminUser, EventoDeHistorial } from '@/api/repositories/admin.repository';
import type { DeviceSession } from '@/api/repositories/sessions.repository';
import { rellenar } from '@/utils/planes';
import { Avatar, Estado } from './ListaDeCuentas';
import type { Carga } from './useDetalleDeCuenta';
import {
  BOTON,
  TARJETA,
  fechaCorta,
  formatWhen,
  fullName,
  nombreDeSesion,
  type ModoDeLista,
  type Translate,
} from './formato';

export interface Aviso {
  texto: string;
  ok: boolean;
}

interface Props {
  user: AdminUser;
  /** Instante con el que se compara el vencimiento; llega de fuera del render. */
  ahora: number;
  locale: string;
  t: Translate;
  modo: ModoDeLista;
  sesiones: Carga<DeviceSession[]>;
  historial: Carga<EventoDeHistorial[]>;
  ocupado: boolean;
  aviso: Aviso | null;
  /** La cuenta del propio administrador: sus sesiones se cierran desde Dispositivos conectados. */
  esMiCuenta: boolean;
  /** En telefono la ficha es una pantalla: al abrirse, el foco va a su titulo. */
  enfocar: boolean;
  onBloquear: () => void;
  onDesbloquear: () => void;
  onVencimiento: () => void;
  onPlan: () => void;
  onCerrarSesion: (s: DeviceSession) => void;
  onCerrarTodas: () => void;
  onReintentarSesiones: () => void;
  onReintentarHistorial: () => void;
}

const TITULO_SECCION = 'text-sm font-semibold uv-text-primary';

const Cargando: React.FC = () => (
  <div className="flex items-center justify-center py-8">
    <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
  </div>
);

const ErrorConReintento: React.FC<{ texto: string; t: Translate; onReintentar: () => void }> = ({ texto, t, onReintentar }) => (
  <div className="flex flex-wrap items-center gap-3 px-5 py-4">
    <p className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]" role="alert">{texto}</p>
    <button type="button" onClick={onReintentar} className={BOTON.secundario}>{t('error_retry')}</button>
  </div>
);

// ── Sesiones ────────────────────────────────────────────────────────────────

const IconoSesion: React.FC<{ s: DeviceSession; chico?: boolean }> = ({ s, chico }) => {
  return (
    <span className={`${chico ? 'w-8 h-8 rounded-[10px]' : 'w-10 h-10 rounded-xl'} shrink-0 flex items-center justify-center bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-3-dark)] text-[var(--color-primary-700)] dark:text-[var(--color-primary-tint)]`}>
      <IconoDeDispositivo userAgent={s.deviceName} size={chico ? 18 : 22} />
    </span>
  );
};

const CELDA = 'px-3 py-2.5 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] align-middle';

const TablaDeSesiones: React.FC<{
  sesiones: DeviceSession[];
  modo: ModoDeLista;
  locale: string;
  t: Translate;
  ocupado: boolean;
  /** null: se ven, pero no se cierran desde aqui. */
  onCerrar: ((s: DeviceSession) => void) | null;
}> = ({ sesiones, modo, locale, t, ocupado, onCerrar }) => {
  if (modo === 'filas') {
    return (
      <ul className="px-5">
        {sesiones.map((s) => {
          const nombre = nombreDeSesion(s, t);
          return (
            <li key={s.id} className="flex items-center gap-3 py-3 border-t first:border-t-0 border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
              <IconoSesion s={s} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold uv-text-primary break-words" title={s.deviceName}>{nombre}</p>
                <p id={`adm-sesion-${s.id}-abierta`} className="mt-0.5 text-xs uv-text-muted kp-num">
                  {rellenar(t('sessions_opened_on'), { fecha: fechaCorta(s.createdAt, locale, true) })}
                </p>
                <p id={`adm-sesion-${s.id}-red`} className="mt-0.5 text-xs uv-text-muted kp-num">
                  {rellenar(t('sessions_network_value'), { red: s.ipMasked || '—' })} · {rellenar(t('sessions_expires_on'), { fecha: fechaCorta(s.expiresAt, locale, false) })}
                </p>
              </div>
              {onCerrar && (
                <button
                  type="button"
                  onClick={() => onCerrar(s)}
                  disabled={ocupado}
                  aria-label={rellenar(t('admin_users_session_close_aria'), { device: nombre })}
                  aria-describedby={`adm-sesion-${s.id}-abierta adm-sesion-${s.id}-red`}
                  className={BOTON.cerrar}
                >
                  {t('sessions_close')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto @container">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left uv-text-muted">
            <th scope="col" className="px-3 pl-5 py-2 text-xs font-medium">{t('admin_users_col_device')}</th>
            <th scope="col" className="px-3 py-2 text-xs font-medium">{t('sessions_network')}</th>
            <th scope="col" className="px-3 py-2 text-xs font-medium">{t('sessions_opened')}</th>
            <th scope="col" className="hidden @lg:table-cell px-3 py-2 text-xs font-medium">{t('sessions_expires')}</th>
            {onCerrar && (
              <th scope="col" className="px-3 pr-5 py-2 text-xs font-medium text-right"><span className="sr-only">{t('admin_users_col_action')}</span></th>
            )}
          </tr>
        </thead>
        <tbody>
          {sesiones.map((s) => {
            const nombre = nombreDeSesion(s, t);
            return (
              <tr key={s.id} className="kp-fila hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]">
                <td className={`${CELDA} pl-5`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <IconoSesion s={s} chico />
                    <span className="font-semibold uv-text-primary break-words" title={s.deviceName}>{nombre}</span>
                  </div>
                </td>
                <td id={`adm-sesion-${s.id}-red`} className={`${CELDA} uv-text-secondary kp-num whitespace-nowrap`}>{s.ipMasked || '—'}</td>
                <td id={`adm-sesion-${s.id}-abierta`} className={`${CELDA} uv-text-secondary kp-num whitespace-nowrap`}>{fechaCorta(s.createdAt, locale, true)}</td>
                <td className={`${CELDA} hidden @lg:table-cell uv-text-secondary kp-num whitespace-nowrap`}>{fechaCorta(s.expiresAt, locale, false)}</td>
                {onCerrar && (
                  <td className={`${CELDA} pr-5 text-right`}>
                    <button
                      type="button"
                      onClick={() => onCerrar(s)}
                      disabled={ocupado}
                      aria-label={rellenar(t('admin_users_session_close_aria'), { device: nombre })}
                      aria-describedby={`adm-sesion-${s.id}-abierta adm-sesion-${s.id}-red`}
                      className={BOTON.cerrar}
                    >
                      {t('sessions_close')}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ── Historial ───────────────────────────────────────────────────────────────

const PUNTO: Record<EventoDeHistorial['accion'], string> = {
  user_blocked: 'bg-[var(--color-danger)] shadow-[0_0_0_3px_var(--color-danger-soft)]',
  user_unblocked: 'bg-[var(--color-success)] shadow-[0_0_0_3px_var(--color-success-soft)]',
  admin_session_revoked: 'bg-[var(--color-warning)] shadow-[0_0_0_3px_var(--color-warning-soft)]',
  admin_sessions_revoked_all: 'bg-[var(--color-warning)] shadow-[0_0_0_3px_var(--color-warning-soft)]',
  user_expiry_set: 'bg-[var(--color-primary)] shadow-[0_0_0_3px_var(--color-primary-soft)]',
  admin_user_plan_set: 'bg-[var(--color-primary)] shadow-[0_0_0_3px_var(--color-primary-soft)]',
};

function tituloDelEvento(e: EventoDeHistorial, t: Translate, locale: string): string {
  const actor = e.actor || t('admin_users_history_someone');
  switch (e.accion) {
    case 'user_blocked':
      return e.automatico ? t('admin_users_history_blocked_auto') : rellenar(t('admin_users_history_blocked'), { actor });
    case 'user_unblocked':
      return rellenar(t('admin_users_history_unblocked'), { actor });
    case 'admin_session_revoked':
      return rellenar(t('admin_users_history_session_revoked'), { actor });
    case 'admin_sessions_revoked_all':
      return rellenar(t('admin_users_history_sessions_revoked_all'), { actor });
    case 'user_expiry_set':
      return e.vencimientoQuitado
        ? rellenar(t('admin_users_history_expiry_cleared'), { actor })
        : rellenar(t('admin_users_history_expiry_set'), { actor, fecha: formatWhen(e.venceEl, locale, '—') });
    case 'admin_user_plan_set':
      return rellenar(t('admin_users_history_plan_set'), {
        actor,
        antes: e.planAntes ? t(`plans_name_${e.planAntes}`) : '—',
        ahora: e.planDespues ? t(`plans_name_${e.planDespues}`) : '—',
      });
  }
}

function detalleDelEvento(e: EventoDeHistorial, t: Translate, locale: string): string {
  const partes = [formatWhen(e.createdAt, locale, '—')];
  if (e.motivo) partes.push(e.motivo);
  if (e.sesionesCerradas !== null) partes.push(rellenar(t('admin_users_history_sessions_closed'), { count: e.sesionesCerradas }));
  return partes.join(' · ');
}

const Historial: React.FC<{ historial: Carga<EventoDeHistorial[]>; locale: string; t: Translate; onReintentar: () => void }> = ({ historial, locale, t, onReintentar }) => {
  if (historial.cargando) return <Cargando />;
  if (historial.error) return <ErrorConReintento texto={t('admin_users_history_err')} t={t} onReintentar={onReintentar} />;
  if (historial.datos.length === 0) return <p className="px-5 pb-5 text-sm uv-text-muted">{t('admin_users_history_empty')}</p>;
  return (
    <ol className="px-5 pb-5 flex flex-col gap-3.5">
      {historial.datos.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${PUNTO[e.accion]}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium uv-text-primary">{tituloDelEvento(e, t, locale)}</span>
            <span className="block mt-0.5 text-xs uv-text-muted kp-num break-words">{detalleDelEvento(e, t, locale)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
};

// ── Detalle ─────────────────────────────────────────────────────────────────

export const DetalleDeCuenta: React.FC<Props> = ({
  user,
  ahora,
  locale,
  t,
  modo,
  sesiones,
  historial,
  ocupado,
  aviso,
  esMiCuenta,
  enfocar,
  onBloquear,
  onDesbloquear,
  onVencimiento,
  onPlan,
  onCerrarSesion,
  onCerrarTodas,
  onReintentarSesiones,
  onReintentarHistorial,
}) => {
  const bloqueada = user.status === 'blocked';
  const esAdmin = user.role === 'admin';
  // Una cuenta puede tener vencimiento sin estar bloqueada todavia: ese dato se
  // muestra siempre que exista, no solo cuando ya se ejecuto.
  const vencida = user.expiresAt !== null && new Date(user.expiresAt).getTime() <= ahora;
  const abiertas = sesiones.datos.length;
  const titulo = useRef<HTMLHeadingElement>(null);

  // Al tocar una fila en el telefono, la lista se desmonta y el foco caeria al
  // documento: pasa al nombre de la cuenta, que es lo que se acaba de abrir.
  useEffect(() => {
    if (enfocar) titulo.current?.focus({ preventScroll: true });
  }, [enfocar, user.id]);

  // Solo los datos que existen: una fila con el icono y sin texto no dice nada.
  const datos: Array<{ clave: string; etiqueta: string; valor: React.ReactNode }> = [];
  if (user.username) datos.push({ clave: 'u', etiqueta: t('admin_users_username'), valor: <span className="font-semibold">@{user.username}</span> });
  if (user.cedulaMasked) datos.push({ clave: 'c', etiqueta: t('admin_users_cedula'), valor: <span className="kp-num">{user.cedulaMasked}</span> });
  if (user.phoneMasked) datos.push({ clave: 'p', etiqueta: t('admin_users_phone'), valor: <span className="kp-num">{user.phoneMasked}</span> });
  if (user.emailMasked) datos.push({ clave: 'e', etiqueta: t('admin_users_email'), valor: <span className="break-all">{user.emailMasked}</span> });
  datos.push({ clave: 'l', etiqueta: t('admin_users_last_login'), valor: <span className="kp-num">{formatWhen(user.lastLoginAt, locale, t('admin_users_never'))}</span> });
  if (user.createdAt) datos.push({ clave: 'r', etiqueta: t('admin_users_created'), valor: <span className="kp-num">{formatWhen(user.createdAt, locale, '—')}</span> });
  if (user.expiresAt) {
    datos.push({
      clave: 'v',
      etiqueta: t('admin_users_expires_at'),
      valor: (
        <span className={`kp-num ${vencida ? 'text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]' : ''}`}>
          {formatWhen(user.expiresAt, locale, '—')}
          {/* Con punto, "6:45 p. m." quedaba "p. m.. Vencida". */}
          {vencida && <span className="ml-1 font-semibold">· {t('admin_users_expired')}</span>}
        </span>
      ),
    });
  }

  return (
    <article aria-label={fullName(user)} className={`${TARJETA} overflow-hidden`}>
      <header className="flex flex-wrap items-center gap-3.5 px-5 py-4 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
        <Avatar user={user} grande />
        <div className="min-w-0 flex-1 basis-40">
          <h2 ref={titulo} tabIndex={-1} className="text-[17px] font-semibold tracking-[-0.01em] uv-text-primary break-words outline-none">{fullName(user)}</h2>
          <p className="mt-0.5 text-[13px] uv-text-secondary">
            {esAdmin ? t('admin_users_role_admin') : rellenar(t('admin_users_kyc_level'), { n: user.kycLevel })}
          </p>
        </div>
        <Estado user={user} t={t} />
      </header>

      {/* La region viva esta siempre montada: una que nace ya con el texto no
          siempre se anuncia. */}
      <div role="status" aria-live="polite">
        {aviso && (
          <div
            className={`animate-fade-in mx-5 mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium ${
              aviso.ok ? 'uv-chip-success' : 'bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-secondary'
            }`}
          >
            {aviso.ok
              ? <Icons.Check size={16} className="shrink-0 mt-px" aria-hidden="true" />
              : <Icons.Info size={16} className="shrink-0 mt-px" aria-hidden="true" />}
            <span>{aviso.texto}</span>
          </div>
        )}
      </div>

      <section aria-labelledby={`datos-${user.id}`} className="px-5 pt-4 pb-5 @container">
        <h3 id={`datos-${user.id}`} className="sr-only">{t('admin_users_details')}</h3>
        <dl className="grid grid-cols-1 @md:grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          {datos.map((d) => (
            <div key={d.clave} className="min-w-0">
              <dt className="text-xs uv-text-muted">{d.etiqueta}</dt>
              <dd className="mt-0.5 uv-text-primary">{d.valor}</dd>
            </div>
          ))}
          {/* El plan se puede cambiar tambien con la cuenta bloqueada: no es un
              permiso para entrar, es el tope que tendra cuando vuelva. */}
          <div className="min-w-0">
            <dt className="text-xs uv-text-muted" id={`plan-${user.id}`}>{t('admin_users_plan')}</dt>
            <dd className="mt-0.5">
              <button
                type="button"
                onClick={onPlan}
                disabled={ocupado}
                aria-labelledby={`plan-${user.id} plan-valor-${user.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg -mx-1 px-1 font-semibold uv-text-primary hover:text-[var(--color-primary-600)] dark:hover:text-[var(--color-primary-light)] kp-foco disabled:opacity-50"
              >
                <span id={`plan-valor-${user.id}`}>{t(`plans_name_${user.plan}`)}</span>
                <Icons.Edit size={13} className="uv-text-muted" aria-hidden="true" />
              </button>
            </dd>
          </div>
        </dl>
        {bloqueada && (
          <dl className="mt-4 rounded-2xl bg-[var(--color-danger-soft)] px-4 py-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="uv-text-muted">{t('admin_users_blocked_at')}</dt>
            <dd className="uv-text-primary kp-num">{formatWhen(user.blockedAt, locale, '—')}</dd>
            {user.blockedByName && (
              <>
                <dt className="uv-text-muted">{t('admin_users_blocked_by')}</dt>
                <dd className="uv-text-primary break-words">{user.blockedByName}</dd>
              </>
            )}
            <dt className="uv-text-muted">{t('admin_users_blocked_reason_label')}</dt>
            <dd className="uv-text-primary break-words">{user.blockedReason || '—'}</dd>
          </dl>
        )}
      </section>

      <section aria-labelledby={`sesiones-${user.id}`} className="border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-2">
          <h3 id={`sesiones-${user.id}`} className={`${TITULO_SECCION} flex items-center gap-2`}>
            {t('admin_users_sessions_title')}
            {!sesiones.cargando && !sesiones.error && (
              <span className="kp-num rounded-md px-1.5 py-px text-xs font-semibold bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-secondary">{abiertas}</span>
            )}
          </h3>
          {abiertas > 1 && <span className="text-xs uv-text-muted">{t('admin_users_sessions_sorted')}</span>}
          {abiertas > 1 && !esMiCuenta && (
            <button type="button" onClick={onCerrarTodas} disabled={ocupado} className={`${BOTON.cerrar} ml-auto`}>
              {t('admin_users_sessions_close_all')}
            </button>
          )}
        </div>
        {sesiones.cargando ? (
          <Cargando />
        ) : sesiones.error ? (
          <ErrorConReintento texto={t('admin_users_sessions_err')} t={t} onReintentar={onReintentarSesiones} />
        ) : abiertas === 0 ? (
          <p className="px-5 pb-5 text-[13px] leading-relaxed uv-text-muted">
            {bloqueada ? t('admin_users_sessions_none_blocked') : t('admin_users_sessions_none')}
          </p>
        ) : (
          <div className="pb-2">
            {/* Las propias se cierran desde Dispositivos conectados, donde se
                sabe cual es la de este aparato: aqui "Cerrar todas" lo sacaria
                del panel sin aviso. */}
            {esMiCuenta && <p className="px-5 pb-1 text-[13px] leading-relaxed uv-text-muted">{t('admin_users_sessions_own')}</p>}
            <TablaDeSesiones sesiones={sesiones.datos} modo={modo} locale={locale} t={t} ocupado={ocupado} onCerrar={esMiCuenta ? null : onCerrarSesion} />
          </div>
        )}
      </section>

      <section aria-labelledby={`acciones-${user.id}`} className="border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-5 py-4">
        <h3 id={`acciones-${user.id}`} className={TITULO_SECCION}>
          {bloqueada ? t('admin_users_blocked_section') : t('admin_users_block_section')}
        </h3>
        {esAdmin ? (
          <p className="mt-1.5 text-[13px] leading-relaxed uv-text-muted">{t('admin_users_admin_note')}</p>
        ) : bloqueada ? (
          <>
            <p className="mt-1.5 text-[13px] leading-relaxed uv-text-secondary">{t('admin_users_unblock_warning')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onDesbloquear} disabled={ocupado} className={BOTON.secundario}>
                <Icons.Unlock size={16} aria-hidden="true" />
                {t('admin_users_unblock_action')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-[13px] leading-relaxed uv-text-secondary">{t('admin_users_block_section_hint')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onBloquear} disabled={ocupado} className={BOTON.peligro}>
                <Icons.Lock size={16} aria-hidden="true" />
                {t('admin_users_block_action')}
              </button>
              <button type="button" onClick={onVencimiento} disabled={ocupado} className={BOTON.secundario}>
                <Icons.Clock size={16} aria-hidden="true" />
                {user.expiresAt ? t('admin_users_expiry_change') : t('admin_users_expiry_schedule')}
              </button>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby={`historial-${user.id}`} className="border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
        <h3 id={`historial-${user.id}`} className={`${TITULO_SECCION} px-5 pt-4 pb-3`}>{t('admin_users_history')}</h3>
        <Historial historial={historial} locale={locale} t={t} onReintentar={onReintentarHistorial} />
      </section>
    </article>
  );
};

