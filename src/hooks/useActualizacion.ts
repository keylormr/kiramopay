import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { getApiLayer } from '@/api';

// Deteccion de actualizaciones del APK: la app instalada compara su propia
// version contra la ultima publicada (el backend la sirve desde el release de
// GitHub) y ofrece bajarla en un toque. Sin tienda: el usuario descarga el
// APK nuevo y Android lo instala ENCIMA (misma firma, versionCode creciente),
// conservando datos y sesion. Solo aplica en nativo; en web el deploy llega
// solo.

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

export function useActualizacion(): {
  actualizacion: ActualizacionDisponible | null;
  posponer: () => void;
  descargar: () => void;
} {
  const [actualizacion, setActualizacion] = useState<ActualizacionDisponible | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let viva = true;
    (async () => {
      try {
        const [info, res] = await Promise.all([
          CapApp.getInfo(),
          getApiLayer().appVersion?.getLatest() ??
            Promise.resolve({ success: false as const, data: undefined }),
        ]);
        if (!viva || !res.success || !res.data) return;
        const { version, url } = res.data;
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
  }, []);

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

  const descargar = () => {
    if (!actualizacion) return;
    // _system abre el navegador del telefono: descarga el APK y Android
    // ofrece instalarlo (actualizacion en sitio por la misma firma).
    window.open(actualizacion.url, '_system');
  };

  return { actualizacion, posponer, descargar };
}
