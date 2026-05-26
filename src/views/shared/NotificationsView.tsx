
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
      return <Icons.Banknote size={20} className="text-green-500" />;
    case 'security':
      return <Icons.Shield size={20} className="text-red-500" />;
    case 'promo':
      return <Icons.Gift size={20} className="text-purple-500" />;
    case 'warning':
      return <Icons.AlertCircle size={20} className="text-yellow-500" />;
    default:
      return <Icons.Info size={20} className="text-blue-500" />;
  }
};

const getNotificationBg = (type: Notification['type'], read: boolean) => {
  if (read) return 'bg-gray-50 dark:bg-gray-800/50';
  switch (type) {
    case 'transaction':
      return 'bg-green-50 dark:bg-green-900/20';
    case 'security':
      return 'bg-red-50 dark:bg-red-900/20';
    case 'promo':
      return 'bg-purple-50 dark:bg-purple-900/20';
    case 'warning':
      return 'bg-yellow-50 dark:bg-yellow-900/20';
    default:
      return 'bg-blue-50 dark:bg-blue-900/20';
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
    <div className="fixed inset-0 z-50 bg-background dark:bg-background-dark animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-surface-dark/95 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            onClick={onClose}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Icons.ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold">Notificaciones</h1>
          <div className="w-10" />
        </div>

        {/* Actions bar */}
        {notifications.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-sm text-gray-500">
              {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todas leidas'}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="text-sm text-primary font-medium"
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
            <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <Icons.Bell size={40} className="text-gray-400" />
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
                      <h4 className={`font-semibold text-sm ${notification.read ? 'text-gray-600 dark:text-gray-400' : ''}`}>
                        {notification.title}
                      </h4>
                      {!notification.read && (
                        <span className="flex-shrink-0 w-2 h-2 bg-primary rounded-full mt-1.5" />
                      )}
                    </div>
                    <p className={`text-sm mt-0.5 ${notification.read ? 'text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                      {notification.message}
                    </p>
                    <span className="text-xs text-gray-400 mt-2 block">
                      {notification.date}
                    </span>
                  </div>
                </div>

                {notification.action && (
                  <button className="mt-3 w-full py-2 bg-primary text-white rounded-lg text-sm font-medium">
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
