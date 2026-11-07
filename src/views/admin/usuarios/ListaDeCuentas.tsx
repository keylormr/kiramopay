import React from 'react';
import { Icons } from '@/components/Icons';
import type { AdminUser } from '@/api/repositories/admin.repository';
import { CHIP_BY_STATUS, TARJETA, fechaCorta, fullName, iniciales, type ModoDeLista, type Translate } from './formato';

interface Props {
  cuentas: AdminUser[];
  elegida: string | null;
  onElegir: (id: string) => void;
  /** En Bloqueadas la tabla cuenta cuando y por que; en Buscar, el ultimo ingreso. */
  variante: 'buscar' | 'bloqueadas';
  modo: ModoDeLista;
  locale: string;
  t: Translate;
  etiqueta: string;
}

export const Estado: React.FC<{ user: AdminUser; t: Translate }> = ({ user, t }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-semibold ${CHIP_BY_STATUS[user.status]}`}>
    <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
    {t(`admin_users_status_${user.status}`)}
  </span>
);

export const Avatar: React.FC<{ user: AdminUser; grande?: boolean }> = ({ user, grande }) => (
  <span
    aria-hidden="true"
    className={`${grande ? 'w-12 h-12 rounded-[14px] text-[15px]' : 'w-8 h-8 rounded-[10px] text-xs'} shrink-0 flex items-center justify-center font-semibold uv-text-primary bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] ring-1 ring-inset ring-[var(--color-border-strong)] dark:ring-[var(--color-border-strong-dark)]`}
  >
    {iniciales(user)}
  </span>
);

/** La linea de identidad bajo el nombre: lo que haya, sin huecos. */
function identidad(u: AdminUser): string {
  return [u.username ? `@${u.username}` : '', u.cedulaMasked].filter(Boolean).join(' · ');
}

const CELDA = 'px-3 py-2.5 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] align-middle';

export const ListaDeCuentas: React.FC<Props> = ({ cuentas, elegida, onElegir, variante, modo, locale, t, etiqueta }) => {
  if (modo === 'filas') {
    return (
      <ul aria-label={etiqueta} className={`${TARJETA} p-1.5`}>
        {cuentas.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              data-cuenta={u.id}
              onClick={() => onElegir(u.id)}
              className="kp-fila w-full flex items-center gap-3 rounded-2xl px-2.5 py-3 text-left hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] kp-foco"
            >
              <Avatar user={u} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold uv-text-primary truncate">{fullName(u)}</span>
                {variante === 'bloqueadas' ? (
                  // En esta pestana todas estan bloqueadas: la etiqueta repetia la
                  // pestana y le quitaba el lugar a la fecha ("Bloqueada el 5 n...").
                  <>
                    <span className="block mt-0.5 text-xs uv-text-secondary kp-num truncate">
                      {u.blockedAt ? `${t('admin_users_blocked_at')} ${fechaCorta(u.blockedAt, locale, false)}` : identidad(u)}
                    </span>
                    {u.blockedReason && (
                      <span className="block mt-0.5 text-xs uv-text-muted truncate">{u.blockedReason}</span>
                    )}
                  </>
                ) : (
                  <span className="block mt-0.5 text-xs uv-text-muted kp-num truncate">{identidad(u)}</span>
                )}
              </span>
              {/* En Bloqueadas la etiqueta solo aparece si ya no lo esta (se
                  desbloqueo desde su ficha y la lista todavia no se recargo). */}
              {(variante === 'buscar' || u.status !== 'blocked') && <Estado user={u} t={t} />}
              <Icons.ChevronRight size={16} className="uv-text-muted shrink-0" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  // Tabla. Las columnas extra aparecen solo cuando la lista tiene el ancho de
  // la pantalla (tablet); al lado del detalle (escritorio) queda en dos.
  return (
    <div className={`${TARJETA} overflow-hidden @container`}>
      <table aria-label={etiqueta} className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left uv-text-muted">
            <th scope="col" className="px-3 pl-4 py-2.5 text-xs font-medium">{t('admin_users_col_user')}</th>
            <th scope="col" className="px-3 py-2.5 text-xs font-medium">{t('admin_users_col_status')}</th>
            <th scope="col" className="hidden @lg:table-cell px-3 py-2.5 text-xs font-medium">{t('admin_users_plan')}</th>
            {variante === 'buscar' ? (
              <th scope="col" className="hidden @lg:table-cell px-3 py-2.5 text-xs font-medium">{t('admin_users_last_login')}</th>
            ) : (
              <>
                <th scope="col" className="hidden @lg:table-cell px-3 py-2.5 text-xs font-medium">{t('admin_users_blocked_at')}</th>
                <th scope="col" className="hidden @2xl:table-cell px-3 pr-4 py-2.5 text-xs font-medium">{t('admin_users_blocked_reason_label')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {cuentas.map((u) => {
            const sel = u.id === elegida;
            return (
              <tr
                key={u.id}
                onClick={() => onElegir(u.id)}
                className={`kp-fila cursor-pointer ${sel ? 'bg-[var(--color-primary-soft)]' : 'hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]'}`}
              >
                <td className={`${CELDA} pl-4`}>
                  {/* El boton es lo que se alcanza con el teclado; la fila entera
                      responde al clic por comodidad. */}
                  <button
                    type="button"
                    data-cuenta={u.id}
                    onClick={(e) => { e.stopPropagation(); onElegir(u.id); }}
                    aria-current={sel ? 'true' : undefined}
                    className="flex items-center gap-2.5 min-w-0 text-left rounded-lg kp-foco"
                  >
                    <Avatar user={u} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold uv-text-primary truncate">{fullName(u)}</span>
                      <span className="block mt-px text-xs uv-text-muted kp-num truncate">{identidad(u)}</span>
                    </span>
                  </button>
                </td>
                <td className={CELDA}><Estado user={u} t={t} /></td>
                <td className={`${CELDA} hidden @lg:table-cell uv-text-secondary`}>{t(`plans_name_${u.plan}`)}</td>
                {variante === 'buscar' ? (
                  <td className={`${CELDA} hidden @lg:table-cell uv-text-secondary kp-num whitespace-nowrap`}>
                    {u.lastLoginAt ? fechaCorta(u.lastLoginAt, locale, true) : t('admin_users_never')}
                  </td>
                ) : (
                  <>
                    <td className={`${CELDA} hidden @lg:table-cell uv-text-secondary kp-num whitespace-nowrap`}>
                      {u.blockedAt ? fechaCorta(u.blockedAt, locale, true) : '—'}
                    </td>
                    {/* w-full + max-w-0: la columna toma lo que sobra y el texto
                        se corta con puntos suspensivos; con max-w en la celda la
                        tabla crecia y el motivo se salia de la tarjeta. */}
                    <td className={`${CELDA} hidden @2xl:table-cell pr-4 uv-text-muted w-full max-w-0`} title={u.blockedReason}>
                      <span className="block truncate">{u.blockedReason || '—'}</span>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
