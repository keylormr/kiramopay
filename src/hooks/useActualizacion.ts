import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { getApiLayer } from '@/api';
import type { PlataformaApp } from '@/api/repositories/appversion.repository';

// Deteccion de actualizaciones: la app instalada compara su propia version
// contra la ultima publicada (el backend la sirve desde el release de GitHub) y
// pide actualizar en un toque, sin tienda. Solo aplica en nativo; en web el
// deploy llega solo.
//
// Toda version nueva es obligatoria: no hay "Despues". La version anterior de
// este hook guardaba la pospuesta por 24 horas y la app vieja se seguia usando.
// Se revisa al abrir y cada vez que la app vuelve a primer plano, porque puede
// quedar abierta dias. Sin red, o con el servidor sin respuesta, no se bloquea:
// la proxima revision vuelve a intentar.
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
  /** Lo que trae la version; vacia si el release no lo dice. */
  notas: string[];
}

// Lo que se pospuso con la version anterior de este hook: ya no significa
// nada y se borra al revisar.
const CLAVE_POSPUESTA_VIEJA = 'kiramopay-update-pospuesta';

// Solo textos con contenido: la lista se pinta tal cual.
function notasLimpias(notas: unknown): string[] {
  if (!Array.isArray(notas)) return [];
  return notas
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim())
    .filter((n) => n !== '');
}

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
  actualizar: () => void;
} {
  const [actualizacion, setActualizacion] = useState<ActualizacionDisponible | null>(null);
  const [plataforma] = useState<PlataformaApp | null>(() => plataformaNativa());

  useEffect(() => {
    if (!plataforma) return;
    let viva = true;
    try {
      localStorage.removeItem(CLAVE_POSPUESTA_VIEJA);
    } catch { /* sin storage no hay nada que limpiar */ }

    const revisar = async () => {
      try {
        const [info, res] = await Promise.all([
          CapApp.getInfo(),
          getApiLayer().appVersion?.getLatest(plataforma) ??
            Promise.resolve({ success: false as const, data: undefined }),
        ]);
        if (!viva || !res.success || !res.data) return;
        const { version, url, notes } = res.data;
        // Sin URL no hay nada que abrir: el boton quedaria muerto.
        if (!url) return;
        if (!esVersionMasNueva(version, info.version)) return;
        setActualizacion({ version, url, notas: notasLimpias(notes) });
      } catch {
        // Sin red o backend caido: la proxima revision reintenta.
      }
    };

    void revisar();
    const escucha = CapApp.addListener('resume', () => void revisar());
    return () => {
      viva = false;
      void escucha.then((e) => e.remove()).catch(() => undefined);
    };
  }, [plataforma]);

  const actualizar = () => {
    if (!actualizacion) return;
    // _system deja la URL en manos del sistema operativo: en Android abre el
    // navegador y baja el APK; en iOS abre TestFlight, App Store o el
    // instalador OTA, segun el esquema que traiga la URL.
    window.open(actualizacion.url, '_system');
  };

  return { actualizacion, plataforma, actualizar };
}
