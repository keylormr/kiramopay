
import React from 'react';
import { useApp } from '@/hooks/useApp';
import { Icons } from '../../components/Icons';
import { Notification } from '../../types';

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
  const notifications = state.notifications || [];
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAsRead = (id: string) => {
    dispatch({ type: 'MARK_NOTIFICATION_READ', payload: id });
  };

  const handleMarkAllAsRead = () => {
    dispatch({ type: 'MARK_ALL_NOTIFICATIONS_READ' });
  };

  const handleDelete = (id: string) => {
    dispatch({ type: 'DELETE_NOTIFICATION', payload: id });
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-surface-dark/95 backdrop-blur-lg border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            onClick={onClose}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]"
          >
            <Icons.ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold">Notificaciones</h1>
          <div className="w-10" />
        </div>

        {/* Actions bar */}
        {notifications.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
            <span className="text-sm text-gray-500">
              {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todas leidas'}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="text-sm text-[var(--color-primary)] font-medium"
              >
                Marcar todas como leidas
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 pb-24 overflow-y-auto h-[calc(100vh-120px)]">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full flex items-center justify-center mb-4">
              <Icons.Bell size={40} className="uv-text-muted" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Sin notificaciones</h3>
            <p className="text-gray-500 text-sm text-center">
              No tienes notificaciones por el momento.
              <br />Te avisaremos cuando haya novedades.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`relative rounded-xl p-4 transition-all ${getNotificationBg(notification.type, notification.read)}`}
              >
                {/* Delete button */}
                <button
                  onClick={() => handleDelete(notification.id)}
                  aria-label="Delete"
                  className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
                >
                  <Icons.X size={16} />
                </button>

                <div className="flex gap-3 pr-6" onClick={() => handleMarkAsRead(notification.id)}>
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white dark:bg-gray-700 flex items-center justify-center shadow-sm">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className={`font-semibold text-sm ${notification.read ? 'uv-text-secondary' : ''}`}>
                        {notification.title}
                      </h4>
                      {!notification.read && (
                        <span className="flex-shrink-0 w-2 h-2 bg-primary rounded-full mt-1.5" />
                      )}
                    </div>
                    <p className={`text-sm mt-0.5 ${notification.read ? 'text-gray-500' : 'uv-text-secondary'}`}>
                      {notification.message}
                    </p>
                    <span className="text-xs text-gray-400 mt-2 block">
                      {notification.date}
                    </span>
                  </div>
                </div>

                {notification.action && (
                  <button className="mt-3 w-full py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-sm font-medium">
                    {notification.action.label}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
