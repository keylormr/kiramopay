import { useState, useCallback } from 'react';

interface PushNotificationState {
  isSupported: boolean;
  permission: NotificationPermission | 'default';
  subscription: PushSubscription | null;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushNotificationState>({
    isSupported: 'Notification' in window && 'PushManager' in window,
    permission: 'Notification' in window ? Notification.permission : 'default',
    subscription: null,
  });

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) return false;

    const permission = await Notification.requestPermission();
    setState((prev) => ({ ...prev, permission }));
    return permission === 'granted';
  }, [state.isSupported]);

  const subscribe = useCallback(async (): Promise<PushSubscription | null> => {
    if (!state.isSupported) return null;

    const registration = await navigator.serviceWorker.ready;

    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      setState((prev) => ({ ...prev, subscription }));
      return subscription;
    }

    // In production, get VAPID public key from server
    // For now, use a placeholder
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      return null;
    }

    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      setState((prev) => ({ ...prev, subscription }));

      // Send subscription to server
      const apiUrl = import.meta.env.VITE_API_URL;
      if (apiUrl) {
        await fetch(`${apiUrl}/api/v1/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription),
        });
      }

      return subscription;
    } catch {
      return null;
    }
  }, [state.isSupported]);

  const sendLocalNotification = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (state.permission === 'granted') {
        new Notification(title, {
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          ...options,
        });
      }
    },
    [state.permission]
  );

  return {
    ...state,
    requestPermission,
    subscribe,
    sendLocalNotification,
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
