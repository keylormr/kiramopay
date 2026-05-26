import { useNotificationStore } from '../notification.store';
import { initialNotifications } from '@/api/adapters/mock/mock-data';
import type { Notification } from '@/types';

describe('useNotificationStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useNotificationStore.setState({
      notifications: initialNotifications.map((n) => ({ ...n })),
    });
  });

  it('should have initial notifications', () => {
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(initialNotifications.length);
    expect(notifications[0].title).toBe('Bienvenido a KiramoPay');
  });

  it('should have a mix of read and unread notifications', () => {
    const { notifications } = useNotificationStore.getState();
    const unread = notifications.filter((n) => !n.read);
    const read = notifications.filter((n) => n.read);
    expect(unread.length).toBeGreaterThan(0);
    expect(read.length).toBeGreaterThan(0);
  });

  it('should add a notification to the beginning', () => {
    const newNotification: Notification = {
      id: 'new-1',
      title: 'New Alert',
      message: 'Something happened',
      type: 'warning',
      date: 'Hoy, 11:00 AM',
      read: false,
    };

    useNotificationStore.getState().addNotification(newNotification);
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(initialNotifications.length + 1);
    expect(notifications[0].id).toBe('new-1');
    expect(notifications[0].title).toBe('New Alert');
  });

  it('should mark a single notification as read', () => {
    const unreadId = initialNotifications.find((n) => !n.read)!.id;
    expect(useNotificationStore.getState().notifications.find((n) => n.id === unreadId)!.read).toBe(false);

    useNotificationStore.getState().markRead(unreadId);
    const updated = useNotificationStore.getState().notifications.find((n) => n.id === unreadId)!;
    expect(updated.read).toBe(true);
  });

  it('should not change other notifications when marking one as read', () => {
    useNotificationStore.getState().markRead('1');
    const { notifications } = useNotificationStore.getState();
    // Notification '2' was unread and should remain unread
    const notif2 = notifications.find((n) => n.id === '2')!;
    expect(notif2.read).toBe(false);
  });

  it('should mark all notifications as read', () => {
    useNotificationStore.getState().markAllRead();
    const { notifications } = useNotificationStore.getState();
    const unread = notifications.filter((n) => !n.read);
    expect(unread).toHaveLength(0);
    expect(notifications).toHaveLength(initialNotifications.length);
  });

  it('should delete a notification', () => {
    useNotificationStore.getState().deleteNotification('1');
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(initialNotifications.length - 1);
    expect(notifications.find((n) => n.id === '1')).toBeUndefined();
  });

  it('should not affect other notifications when deleting one', () => {
    useNotificationStore.getState().deleteNotification('1');
    const { notifications } = useNotificationStore.getState();
    expect(notifications.find((n) => n.id === '2')).toBeDefined();
    expect(notifications.find((n) => n.id === '3')).toBeDefined();
  });

  it('should handle deleting a non-existent notification gracefully', () => {
    useNotificationStore.getState().deleteNotification('non-existent');
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(initialNotifications.length);
  });

  it('should handle adding multiple notifications in order', () => {
    const first: Notification = {
      id: 'add-1',
      title: 'First',
      message: 'First message',
      type: 'info',
      date: 'Hoy',
      read: false,
    };
    const second: Notification = {
      id: 'add-2',
      title: 'Second',
      message: 'Second message',
      type: 'transaction',
      date: 'Hoy',
      read: false,
    };

    useNotificationStore.getState().addNotification(first);
    useNotificationStore.getState().addNotification(second);

    const { notifications } = useNotificationStore.getState();
    expect(notifications[0].id).toBe('add-2');
    expect(notifications[1].id).toBe('add-1');
  });
});
