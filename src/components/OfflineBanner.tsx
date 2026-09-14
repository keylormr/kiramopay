import React, { useEffect, useState } from 'react';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';

// Cuanto se muestra "Conexion restablecida" antes de retirarse.
const AVISO_RECONEXION_MS = 3000;

/**
 * Aviso de conexion, visible sobre cualquier pantalla y hoja.
 *
 * El componente existia pero nadie lo montaba: sin senal, la persona tocaba
 * "Pagar" y lo unico que veia era un error. Ahora el aviso aparece apenas el
 * dispositivo pierde la red.
 *
 * No promete reintentos. La cola de `useOfflineQueue` no la usa ningun flujo,
 * asi que decir "pendiente, se enviara al reconectar" seria mentir sobre una
 * operacion de dinero: el texto dice que nada sale mientras tanto y que hay que
 * repetir la operacion. Tampoco registra el service worker (lo hacia a traves
 * de `useServiceWorker`); de eso se ocupa la guardia de version.
 */
export function OfflineBanner() {
  const { t } = useLanguage();
  const [sinConexion, setSinConexion] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  const [reconectado, setReconectado] = useState(false);

  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const alPerder = () => {
      clearTimeout(temporizador);
      setReconectado(false);
      setSinConexion(true);
    };
    const alRecuperar = () => {
      clearTimeout(temporizador);
      setSinConexion(false);
      setReconectado(true);
      temporizador = setTimeout(() => setReconectado(false), AVISO_RECONEXION_MS);
    };
    window.addEventListener('offline', alPerder);
    window.addEventListener('online', alRecuperar);
    return () => {
      clearTimeout(temporizador);
      window.removeEventListener('offline', alPerder);
      window.removeEventListener('online', alRecuperar);
    };
  }, []);

  return (
    // La region viva existe siempre, vacia o no: un lector de pantalla solo
    // anuncia cambios en una region que ya estaba en el documento.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[10000] flex justify-center px-4"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
    >
      {sinConexion && (
        <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl bg-[var(--color-navy-900)] px-4 py-3 text-white uv-shadow-floating animate-fade-in-scale">
          <Icons.Offline size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-300" />
          <div className="min-w-0">
            <p className="text-sm font-bold">{t('offline_title')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-white/80">{t('offline_desc')}</p>
          </div>
        </div>
      )}
      {!sinConexion && reconectado && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[var(--color-navy-900)] px-4 py-2 text-sm font-bold text-white uv-shadow-floating animate-fade-in-scale">
          <Icons.Wifi size={16} aria-hidden="true" className="shrink-0 text-emerald-300" />
          {t('online_again')}
        </div>
      )}
    </div>
  );
}
