import React, { useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { BottomSheet } from '@/components/BottomSheet';
import { Icons } from '../../components/Icons';
import { EstadoVacio } from '@/components/EstadoVacio';
import { Notification } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { fechaYHora } from '@/utils/fechaPlazo';
import { destinoDeAviso, type DestinoDeAviso } from '@/utils/destinoDeAviso';

interface NotificationsViewProps {
  onClose: () => void;
  /**
   * Abre la pantalla de un aviso. Sin esta (modo negocio), tocar un aviso solo
   * lo marca leido.
   */
  onAbrirDestino?: (destino: DestinoDeAviso) => boolean;
}

// A donde lleva el aviso, dicho en la tarjeta: sin esto no se sabe que tocarla
// abre algo, ni que.
const etiquetaDeDestino = (destino: DestinoDeAviso, t: (clave: string) => string): string => {
  switch (destino.pantalla) {
    case 'cripto':
      return destino.simbolo ? t('notif_go_asset').replace('{asset}', destino.simbolo) : t('notif_go_crypto');
    case 'movimiento':
      return t('notif_go_movement');
    case 'actividad':
      return t('notif_go_activity');
    case 'seguridad':
      return t('notif_go_security');
  }
};

const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case 'transaction':
      return <Icons.Banknote size={20} className="text-[var(--color-success)]" />;
    case 'security':
      return <Icons.Shield size={20} className="text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]" />;
    case 'promo':
      return <Icons.Gift size={20} className="text-[var(--color-accent)]" />;
    case 'warning':
      return <Icons.AlertCircle size={20} className="text-[var(--color-warning)]" />;
    case 'price_alert':
      return <Icons.BellRing size={20} className="text-[var(--color-primary)] dark:text-[var(--color-primary-light)]" />;
    default:
      return <Icons.Info size={20} className="text-[var(--color-primary)] dark:text-[var(--color-primary-light)]" />;
  }
};

const getNotificationBg = (type: Notification['type'], read: boolean) => {
  if (read) return 'uv-surface-1';
  switch (type) {
    case 'transaction':
      return 'bg-[var(--color-success-soft)]';
    case 'security':
      return 'bg-[var(--color-danger-soft)]';
    case 'promo':
      return 'bg-[var(--color-accent-soft)]';
    case 'warning':
      return 'bg-[var(--color-warning-soft)]';
    default:
      return 'bg-[var(--color-primary-soft)]';
  }
};

export const NotificationsView: React.FC<NotificationsViewProps> = ({ onClose, onAbrirDestino }) => {
  const { state, dispatch } = useApp();
  const { t, language } = useLanguage();
  const notifications = state.notifications || [];
  const unreadCount = notifications.filter((n) => !n.read).length;
  const [open, setOpen] = useState(true);

  // Animate the sheet out before the parent unmounts it.
  const handleClose = () => {
    setOpen(false);
    setTimeout(onClose, 300);
  };

  const handleMarkAsRead = (id: string) =>
    dispatch({ type: 'MARK_NOTIFICATION_READ', payload: id });
  const handleMarkAllAsRead = () =>
    dispatch({ type: 'MARK_ALL_NOTIFICATIONS_READ' });
  const handleDelete = (id: string) =>
    dispatch({ type: 'DELETE_NOTIFICATION', payload: id });

  // Tocar un aviso lo marca leido, como siempre. Si lleva a una pantalla, ademas
  // cierra el panel (con su animacion, por el mismo camino que la X) y la abre.
  // Uno sin pantalla, o uno de antes sin datos de un tipo sin pantalla, se
  // queda en marcarlo leido.
  const destinoDe = (notification: Notification) =>
    onAbrirDestino ? destinoDeAviso(notification.type, notification.data) : null;
  const tocarAviso = (notification: Notification) => {
    // Un segundo toque mientras el panel se cierra no navega otra vez.
    if (!open) return;
    handleMarkAsRead(notification.id);
    const destino = destinoDe(notification);
    if (!destino || !onAbrirDestino) return;
    setOpen(false);
    setTimeout(() => {
      onClose();
      onAbrirDestino(destino);
    }, 300);
  };

  return (
    <BottomSheet isOpen={open} onClose={handleClose} title={t('notif_title')}>
      {/* Actions bar */}
      {notifications.length > 0 && (
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm uv-text-secondary" aria-live="polite">
            {unreadCount > 0 ? `${unreadCount} ${t('notif_unread')}` : t('notif_all_read')}
          </span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              className="text-sm text-[var(--color-primary)] dark:text-[var(--color-primary-light)] font-medium rounded-lg px-2 py-1 hover:bg-[var(--color-primary-soft)] transition-colors"
            >
              {t('notif_mark_all_read')}
            </button>
          )}
        </div>
      )}

      {notifications.length === 0 ? (
        <EstadoVacio
          ilustracion="sinAvisos"
          titulo={t('notif_empty_title')}
          descripcion={t('notif_empty_desc')}
          className="py-6"
        />
      ) : (
        <ul role="list" className="space-y-3">
          {notifications.map((notification) => {
            const destino = destinoDe(notification);
            const aDonde = destino ? etiquetaDeDestino(destino, t) : null;
            return (
            <li key={notification.id} className="relative">
              <button
                type="button"
                onClick={() => tocarAviso(notification)}
                aria-label={`${notification.read ? t('notif_read_label') : t('notif_unread_label')}: ${notification.title}${aDonde ? `. ${aDonde}` : ''}`}
                className={`w-full text-left rounded-xl p-4 pr-10 transition-all ${getNotificationBg(
                  notification.type,
                  notification.read,
                )}`}
              >
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white dark:bg-gray-700 flex items-center justify-center shadow-sm">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4
                        className={`font-semibold text-sm ${notification.read ? 'uv-text-secondary' : ''}`}
                      >
                        {notification.title}
                      </h4>
                      {!notification.read && (
                        <span
                          className="flex-shrink-0 w-2 h-2 bg-primary rounded-full mt-1.5"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <p
                      className={`text-sm mt-0.5 ${notification.read ? 'text-gray-500' : 'uv-text-secondary'}`}
                    >
                      {notification.message}
                    </p>
                    {/* Si la fecha y el destino no caben en una linea, el
                        destino baja entero: la fecha no se parte ("a." / "m."). */}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {notification.dateISO ? fechaYHora(notification.dateISO, language) : notification.date}
                      </span>
                      {aDonde && (
                        <span className="ml-auto flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-medium text-[var(--color-primary)] dark:text-[var(--color-primary-light)]">
                          {aDonde}
                          <Icons.ChevronRight size={14} aria-hidden="true" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* Delete — sibling of the main button (no nested buttons). */}
              <button
                type="button"
                onClick={() => handleDelete(notification.id)}
                aria-label={`${t('notif_delete')}: ${notification.title}`}
                className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
              >
                <Icons.X size={16} />
              </button>

            </li>
            );
          })}
        </ul>
      )}
    </BottomSheet>
  );
};
