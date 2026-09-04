import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';

// Guardia de version del cliente web.
//
// Una pestana abierta sigue corriendo el bundle con el que se cargo. Cuando se
// despliega una version nueva, Vercel cambia los hashes de los chunks y borra
// los viejos, asi que esa pestana pide archivos que ya no existen en cuanto
// navega a una vista diferida. `lazyConRecarga` cubre el caso recargando una
// vez, pero solo cuando el fallo ya ocurrio y solo si la recarga trae de verdad
// la version nueva.
//
// Esto lo detecta ANTES de que reviente: pregunta cual es la version desplegada
// y, si no coincide con la que se esta ejecutando, la aplicacion se recarga
// sola. La consulta esquiva cualquier cache (no-store mas un parametro
// irrepetible) porque de nada sirve preguntar y que respondan con lo mismo que
// ya tenemos.
//
// Limite conocido, y es inherente: esto solo protege desde la version que lo
// incluye en adelante. Un bundle anterior no sabe que /version.json existe.

/** Cada cuanto se vuelve a preguntar mientras la pestana esta abierta. */
const INTERVALO_MS = 15 * 60 * 1000;

export interface EstadoVersion {
  /** La version desplegada no es la que corre aqui. */
  desactualizada: boolean;
  /** Version desplegada, si se pudo leer. Solo para mostrar. */
  versionDesplegada: string | null;
}

interface VersionServida {
  version?: unknown;
  sha?: unknown;
}

/**
 * Recarga saltandose las caches: quita el service worker y sus caches (que
 * guardan el index.html) y vuelve a pedir la pagina con un parametro nuevo,
 * para que ni el navegador ni el CDN puedan devolver la copia vieja.
 */
export async function recargarSaltandoCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const nombres = await caches.keys();
      await Promise.all(nombres.map((n) => caches.delete(n)));
    }
  } catch {
    // Si no se pueden limpiar, la recarga con parametro nuevo sigue siendo
    // mejor que quedarse en la version vieja.
  }
  const url = new URL(window.location.href);
  url.searchParams.set('v', Date.now().toString(36));
  window.location.replace(url.toString());
}

export function useGuardiaDeVersion(): EstadoVersion {
  const [estado, setEstado] = useState<EstadoVersion>({
    desactualizada: false,
    versionDesplegada: null,
  });
  // Una vez desactualizada, no se vuelve atras: la pantalla ya esta pidiendo
  // recargar y una respuesta rara despues no debe devolverle el control.
  const yaVencida = useRef(false);

  const comprobar = useCallback(async () => {
    if (yaVencida.current) return;
    try {
      // El parametro irrepetible es para el CDN; el no-store, para el
      // navegador. Hacen falta los dos.
      const r = await fetch(`/version.json?t=${Date.now().toString(36)}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!r.ok) return;
      const datos: VersionServida = await r.json();
      const sha = typeof datos.sha === 'string' ? datos.sha : '';
      const version = typeof datos.version === 'string' ? datos.version : '';
      if (!sha && !version) return;

      // El commit manda: dos despliegues pueden compartir numero de version.
      const distinta = sha ? sha !== __BUILD_SHA__ : version !== __APP_VERSION__;
      if (!distinta) return;

      yaVencida.current = true;
      setEstado({ desactualizada: true, versionDesplegada: version || sha });
    } catch {
      // Sin red no se sabe nada, y no saber no es estar desactualizado: la
      // aplicacion sigue como esta.
    }
  }, []);

  useEffect(() => {
    // En nativo el bundle viaja dentro del APK: no hay nada que recargar, y la
    // actualizacion tiene su propio camino (useActualizacion).
    if (Capacitor.isNativePlatform()) return;
    // 'local' es el sha de un build sin git (Dockerfile.frontend): no hay con
    // que comparar. En el servidor de desarrollo no hace falta apagar nada:
    // /version.json no existe ahi, la lectura falla y la comprobacion se queda
    // callada, que es justo lo que tiene que pasar cuando no se sabe.
    if (__BUILD_SHA__ === 'local') return;

    // Diferida al proximo tick, mismo patron que el resto de la aplicacion:
    // asi el setState nunca ocurre de forma sincrona dentro del efecto.
    const primera = window.setTimeout(() => void comprobar(), 0);
    const id = window.setInterval(() => void comprobar(), INTERVALO_MS);
    // Volver a la pestana despues de un rato es el momento mas probable de
    // haberse quedado atras.
    const alVolver = () => {
      if (document.visibilityState === 'visible') void comprobar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearTimeout(primera);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [comprobar]);

  return estado;
}

/**
 * Reconoce el fallo de un import dinamico, que en produccion significa una
 * sola cosa: el bundle que corre pide un archivo que el despliegue actual ya
 * no tiene. El texto lo pone el navegador y cambia entre motores, asi que se
 * mira por partes en vez de por una frase exacta.
 */
export function esErrorDeChunkViejo(error: unknown): boolean {
  const mensaje = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  const m = mensaje.toLowerCase();
  return (
    m.includes('dynamically imported module') || // Chrome, Edge
    m.includes('error loading dynamically imported module') ||
    m.includes('importing a module script failed') || // Safari
    m.includes('failed to fetch dynamically') ||
    (m.includes('chunkloaderror') && m.includes('loading chunk'))
  );
}
