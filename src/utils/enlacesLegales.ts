import { Capacitor } from '@capacitor/core';

// Las paginas publicas de la politica de privacidad y de la solicitud de
// eliminacion de cuenta son HTML estatico (public/privacidad, public/eliminar-
// cuenta), no pantallas de la app: Google Play exige una URL que cargue sin la
// aplicacion, y quien desinstalo la app tiene que poder usarlas.
//
// En la web son del mismo origen. En el APK y en iOS la app corre desde su
// propio origen (https://app.kiramopay.com en Android, capacitor://localhost en
// iOS), asi que la direccion tiene que ser absoluta y se abre en el navegador
// del sistema.

/**
 * Sitio donde viven las paginas publicas. Se puede cambiar al construir con
 * VITE_PUBLIC_SITE_URL cuando el dominio definitivo sea otro.
 */
export const SITIO_PUBLICO = (import.meta.env.VITE_PUBLIC_SITE_URL || 'https://kiramopay.vercel.app').replace(/\/+$/, '');

export const RUTA_PRIVACIDAD = '/privacidad';
export const RUTA_ELIMINAR_CUENTA = '/eliminar-cuenta';

/** La direccion que se abre desde esta plataforma. */
export function urlPublica(ruta: string): string {
  return Capacitor.isNativePlatform() ? `${SITIO_PUBLICO}${ruta}` : ruta;
}

/**
 * Abre una pagina publica. `_system` deja la URL en manos del sistema operativo
 * (el navegador); en la web se abre en otra pestana sin darle acceso a esta.
 */
export function abrirPublico(ruta: string): void {
  if (Capacitor.isNativePlatform()) {
    window.open(urlPublica(ruta), '_system');
  } else {
    window.open(urlPublica(ruta), '_blank', 'noopener,noreferrer');
  }
}
