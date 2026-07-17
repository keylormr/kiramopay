import React, { useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { BottomSheet } from '@/components/BottomSheet';
import { Icons } from '../../components/Icons';
import { Notification } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';

interface NotificationsViewProps {
  onClose: () => void;
}

const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case 'transaction':
      return <Icons.Banknote size={20} className="text-[var(--color-success)]" />;
    case 'security':
      return <Icons.Shield size={20} className="text-[var(--color-danger)]" />;
    case 'promo':
      return <Icons.Gift size={20} className="text-[var(--color-accent)]" />;
    case 'warning':
      return <Icons.AlertCircle size={20} className="text-[var(--color-warning)]" />;
    default:
      return <Icons.Info size={20} className="text-[var(--color-primary)]" />;
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

export const NotificationsView: React.FC<NotificationsViewProps> = ({ onClose }) => {
  const { state, dispatch } = useApp();
  const { t } = useLanguage();
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
              className="text-sm text-[var(--color-primary)] font-medium rounded-lg px-2 py-1 hover:bg-[var(--color-primary-soft)] transition-colors"
            >
              {t('notif_mark_all_read')}
            </button>
          )}
        </div>
      )}

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full flex items-center justify-center mb-4">
            <Icons.Bell size={32} className="uv-text-muted" />
          </div>
          <h3 className="text-base font-semibold mb-1">{t('notif_empty_title')}</h3>
          <p className="uv-text-muted text-sm text-center">
            {t('notif_empty_desc')}
          </p>
        </div>
      ) : (
        <ul role="list" className="space-y-3">
          {notifications.map((notification) => (
            <li key={notification.id} className="relative">
              <button
                type="button"
                onClick={() => handleMarkAsRead(notification.id)}
                aria-label={`${notification.read ? t('notif_read_label') : t('notif_unread_label')}: ${notification.title}`}
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
                    <span className="text-xs text-gray-400 mt-2 block">
                      {notification.date}
                    </span>
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

              {notification.action && (
                <button
                  type="button"
                  className="mt-2 w-full py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-sm font-medium"
                >
                  {notification.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
};
