import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { getApiLayer } from '@/api';
import type { PlataformaApp } from '@/api/repositories/appversion.repository';

// Deteccion de actualizaciones: la app instalada compara su propia version
// contra la ultima publicada (el backend la sirve desde el release de GitHub) y
// ofrece actualizar en un toque, sin tienda. Solo aplica en nativo; en web el
// deploy llega solo.
//
// Las dos plataformas comparten la deteccion pero NO el desenlace:
//
//   - Android: se baja el .apk y el sistema lo instala ENCIMA (misma firma,
//     versionCode creciente), conservando datos y sesion.
//   - iOS: no se puede instalar un binario bajado de un link. La URL que manda
//     el backend apunta al canal que corresponda —TestFlight, App Store o un
//     manifiesto OTA itms-services:// si la distribucion es Ad Hoc— y el
//     sistema la abre en la app que la maneje. Sin canal el backend responde
//     503 y aca no se ofrece nada.
//
// El mecanismo de apertura es el mismo en las dos: window.open con destino de
// ventana nueva. En iOS, Capacitor lo resuelve en createWebViewWith llamando a
// UIApplication.shared.open(url), que es justamente quien sabe abrir
// itms-apps://, itms-beta:// e itms-services://.

export interface ActualizacionDisponible {
  version: string;
  url: string;
}

const CLAVE_POSPUESTA = 'kiramopay-update-pospuesta';
const REPOSO_MS = 24 * 60 * 60 * 1000; // recordar de nuevo tras un dia

// Comparacion semver simple (mayor.menor.parche numericos).
export function esVersionMasNueva(remota: string, local: string): boolean {
  const r = remota.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const a = r[i] ?? 0;
    const b = l[i] ?? 0;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (a !== b) return a > b;
  }
  return false;
}

/**
 * Plataforma nativa en la que corre la app, o null en web.
 *
 * Se separa de Capacitor.getPlatform() porque ese devuelve tambien 'web' y
 * cualquier plataforma futura: aca solo interesan las dos que tienen canal de
 * actualizacion, y todo lo demas se trata como "no ofrecer nada".
 */
export function plataformaNativa(): PlataformaApp | null {
  if (!Capacitor.isNativePlatform()) return null;
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' ? p : null;
}

export function useActualizacion(): {
  actualizacion: ActualizacionDisponible | null;
  plataforma: PlataformaApp | null;
  posponer: () => void;
  actualizar: () => void;
} {
  const [actualizacion, setActualizacion] = useState<ActualizacionDisponible | null>(null);
  const [plataforma] = useState<PlataformaApp | null>(() => plataformaNativa());

  useEffect(() => {
    if (!plataforma) return;
    let viva = true;
    (async () => {
      try {
        const [info, res] = await Promise.all([
          CapApp.getInfo(),
          getApiLayer().appVersion?.getLatest(plataforma) ??
            Promise.resolve({ success: false as const, data: undefined }),
        ]);
        if (!viva || !res.success || !res.data) return;
        const { version, url } = res.data;
        // Sin URL no hay nada que abrir: el boton quedaria muerto.
        if (!url) return;
        if (!esVersionMasNueva(version, info.version)) return;
        // Pospuesta hace menos de un dia para ESTA version: no insistir aun.
        try {
          const guardado = localStorage.getItem(CLAVE_POSPUESTA);
          if (guardado) {
            const { v, t } = JSON.parse(guardado) as { v: string; t: number };
            if (v === version && Date.now() - t < REPOSO_MS) return;
          }
        } catch { /* storage roto: se ofrece igual */ }
        setActualizacion({ version, url });
      } catch {
        // Sin red o backend caido: la proxima apertura reintenta.
      }
    })();
    return () => { viva = false; };
  }, [plataforma]);

  const posponer = () => {
    if (actualizacion) {
      try {
        localStorage.setItem(
          CLAVE_POSPUESTA,
          JSON.stringify({ v: actualizacion.version, t: Date.now() }),
        );
      } catch { /* sin storage no se persiste la pospuesta */ }
    }
    setActualizacion(null);
  };

  const actualizar = () => {
    if (!actualizacion) return;
    // _system deja la URL en manos del sistema operativo: en Android abre el
    // navegador y baja el APK; en iOS abre TestFlight, App Store o el
    // instalador OTA, segun el esquema que traiga la URL.
    window.open(actualizacion.url, '_system');
  };

  return { actualizacion, plataforma, posponer, actualizar };
}
