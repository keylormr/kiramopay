import React from 'react';
import { useServiceWorker } from '../hooks/useServiceWorker';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

export function OfflineBanner() {
  const { isOffline, updateAvailable, update } = useServiceWorker();
  const { queueLength } = useOfflineQueue();

  if (!isOffline && !updateAvailable) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      {isOffline && (
        <div className="bg-amber-500 text-white text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-2">
          <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
          Sin conexión
          {queueLength > 0 && (
            <span className="bg-white/20 rounded-full px-2 py-0.5 text-xs">
              {queueLength} pendiente{queueLength > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
      {updateAvailable && (
        <div className="bg-primary text-white text-center py-2 px-4 text-sm font-medium">
          Nueva versión disponible
          <button
            onClick={update}
            className="ml-2 underline font-bold"
          >
            Actualizar
          </button>
        </div>
      )}
    </div>
  );
}
