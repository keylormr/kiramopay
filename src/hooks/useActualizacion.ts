import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { LiveUpdate } from '@capawesome/capacitor-live-update';
import { getApiLayer } from '@/api';
import type { PaqueteWeb, PlataformaApp } from '@/api/repositories/appversion.repository';
import { BUILD_VERSION } from '@/config/version';
import { verificarManifiesto, type ManifiestoPaquete } from '@/utils/paqueteFirmado';

// Deteccion de actualizaciones: la app instalada compara la version que corre
// contra la ultima publicada (el backend la sirve desde el release de GitHub) y
// no deja seguir hasta tenerla. Solo aplica en nativo; en web el deploy llega
// solo.
//
// Toda version nueva es obligatoria: no hay "Despues". Se revisa al abrir, cada
// vez que la app vuelve a primer plano (puede quedar abierta dias) y al volver
// la conexion. Sin red, o con el servidor sin respuesta, no se bloquea: la
// proxima revision vuelve a intentar.
//
// Hay dos vias, y la elige lo que publico el release:
//
//   - Interna: si la version nueva solo cambia la capa web, la barrera baja el
//     paquete (@capawesome/capacitor-live-update), lo deja listo y la app se
//     reinicia sola, ya actualizada, sin otro archivo ni instalador. Arranca
//     sola, como en los juegos, y muestra el avance. Antes de bajar nada la app
//     verifica la firma del manifiesto (utils/paqueteFirmado), y el plugin
//     verifica en nativo la del .zip antes de descomprimirlo.
//   - Externa: si cambio lo nativo (un plugin, Capacitor, un permiso), el
//     paquete no sirve en este binario: el manifiesto lo dice con nativaMinima.
//     Ahi es como siempre: en Android se baja el .apk y el sistema lo instala
//     encima; en iOS se abre el canal (TestFlight, App Store o un manifiesto
//     OTA). Tambien es la salida si la via interna fallo dos veces con la misma
//     version, para que nadie quede atrapado.
//
// La version que corre es la de la capa web (BUILD_VERSION), no la del binario:
// despues de una actualizacion interna el APK sigue diciendo la vieja.
//
// Que la via interna no deje a nadie colgado:
//   - Una falla de descarga se reintenta sola, con esperas crecientes.
//   - Sin conexion espera la red y sigue sola.
//   - Si el paquete nuevo no arranca, el plugin vuelve al del binario (ver
//     confirmarArranque) y eso se cuenta; a la segunda falla de la misma
//     version se ofrece el APK.
//   - Con la barrera del APK se pregunta de nuevo cada minuto: si el backend
//     respondio sin paquete por una falla pasajera, se pasa a la interna.
//
// El paquete solo se baja del release de su version en GitHub: lo que diga el
// servidor fuera de eso no llega al plugin (ni el identificador del telefono
// que el plugin manda con la descarga).

type Comun = {
  version: string;
  /** La que corre en el telefono: si algo falla, con esto se pide ayuda. */
  instalada: string;
  /** Lo que trae la version; vacia si el release no lo dice. */
  notas: string[];
};

export type FaseInterna = 'preparando' | 'descargando' | 'aplicando' | 'sin_red' | 'error';

export type ActualizacionDisponible =
  | (Comun & { via: 'externa'; url: string })
  | (Comun & { via: 'interna'; fase: FaseInterna; recibidos: number; total: number | null });

// Lo que se pospuso con una version vieja de este hook: ya no significa nada y
// se borra al revisar.
const CLAVE_POSPUESTA_VIEJA = 'kiramopay-update-pospuesta';
// { [version]: veces que fallo por dentro }. Se descartan las versiones que ya
// no son mas nuevas que la que corre.
const CLAVE_FALLOS = 'kiramopay-actualizacion-fallos';
// La version que se dejo lista antes de reiniciar, para saber al arrancar si
// quedo corriendo.
const CLAVE_PENDIENTE = 'kiramopay-actualizacion-pendiente';

/** Fallas por dentro con la misma version antes de ofrecer el APK. */
export const MAX_FALLOS = 2;

/** Los tiempos de la barrera. Un objeto para que las pruebas los acorten. */
export const reintentos = {
  /** Esperas entre reintentos automaticos de una descarga que fallo. */
  esperasMs: [3_000, 10_000, 30_000],
  /** Con la barrera del APK, cada cuanto se pregunta si ya hay paquete. */
  revisarExternaMs: 60_000,
  /** Si despues de reiniciar la pagina sigue aca, algo no anduvo. */
  esperaReinicioMs: 15_000,
};

/** El plugin avisa cada 8 KiB: la pantalla no necesita tanto. */
const INTERVALO_AVANCE_MS = 100;

// El plugin usa el id tal cual como nombre de carpeta: solo pasa uno armado y
// validado aca, nunca lo que diga el servidor.
const ID_VALIDO = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const idDePaquete = (version: string) => `v${version}`;
const versionDeId = (id: string | null | undefined) => (id && ID_VALIDO.test(id) ? id.slice(1) : null);

// Donde publica los paquetes el workflow del tag (backend/internal/appversion
// arma la misma URL).
const RELEASES = 'https://github.com/keylormr/kiramopay/releases/download/';
const urlDelPaquete = (version: string, plataforma: PlataformaApp) =>
  `${RELEASES}${idDePaquete(version)}/kiramopay-web-${plataforma}.zip`;

function leerFallos(): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLAVE_FALLOS) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function fallosDe(version: string): number {
  const n = leerFallos()[version];
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
}

function sumarFallo(version: string): void {
  try {
    const fallos: Record<string, number> = {};
    for (const [v, n] of Object.entries(leerFallos())) {
      if (typeof n === 'number' && Number.isInteger(n) && n > 0 && esVersionMasNueva(v, BUILD_VERSION)) fallos[v] = n;
    }
    fallos[version] = fallosDe(version) + 1;
    localStorage.setItem(CLAVE_FALLOS, JSON.stringify(fallos));
  } catch {
    /* sin storage no se cuenta: se reintenta por dentro */
  }
}

function guardarPendiente(version: string): void {
  try {
    localStorage.setItem(CLAVE_PENDIENTE, version);
  } catch {
    /* sin storage, el arranque no sabra que esperar */
  }
}

function tomarPendiente(): string | null {
  try {
    const v = localStorage.getItem(CLAVE_PENDIENTE);
    localStorage.removeItem(CLAVE_PENDIENTE);
    return v;
  } catch {
    return null;
  }
}

// Solo textos con contenido: la lista se pinta tal cual.
function notasLimpias(notas: unknown): string[] {
  if (!Array.isArray(notas)) return [];
  return notas
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim())
    .filter((n) => n !== '');
}

function esPaqueteWeb(web: unknown): web is PaqueteWeb {
  if (!web || typeof web !== 'object') return false;
  const w = web as Record<string, unknown>;
  return [w.manifest, w.signature, w.url].every((v) => typeof v === 'string' && v !== '');
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

// La confirmacion de esta carga de pagina. La revision del hook la espera antes
// de decidir: su efecto corre antes que el de AppConGuardia (React corre
// primero los efectos de los hijos), y sin esperar podia ofrecer otra vez por
// dentro una version que acababa de revertirse.
let arranque: Promise<void> | null = null;

/**
 * Le confirma al plugin que la capa web que corre arranco. Va en cada arranque,
 * en cuanto la app se pinto (AppConGuardia y la revision de este hook, por
 * asegurarArranque): sin esta llamada, pasado el
 * readyTimeout de capacitor.config.ts el plugin cree que el paquete no anda y
 * vuelve al del binario.
 *
 * Tambien cuenta como falla de la version que se intento aplicar: la que el
 * plugin tuvo que revertir, o la que se dejo lista y no quedo corriendo.
 */
export function confirmarArranque(): Promise<void> {
  arranque = confirmar();
  return arranque;
}

/** Confirma el arranque una sola vez por carga de pagina. */
export function asegurarArranque(): Promise<void> {
  return arranque ?? confirmarArranque();
}

async function confirmar(): Promise<void> {
  if (!plataformaNativa()) return;
  let resultado: { rollback: boolean; previousBundleId: string | null } | null = null;
  try {
    resultado = await LiveUpdate.ready();
  } catch {
    // Un binario sin el plugin: no hay nada que confirmar.
  }
  const pendiente = tomarPendiente();
  if (resultado?.rollback) {
    // Si el plugin no dice cual revirtio, fue la que se dejo lista.
    const v = versionDeId(resultado.previousBundleId) ?? versionDeId(pendiente && idDePaquete(pendiente));
    if (v) sumarFallo(v);
    return;
  }
  if (pendiente && pendiente !== BUILD_VERSION) sumarFallo(pendiente);
}

/** Lo que se esta bajando por dentro. */
type Destino = {
  comun: Comun;
  url: string;
  manifiesto: ManifiestoPaquete;
  /** El APK o el canal de iOS, si hay: la salida si la via interna no anda. */
  externa: string | null;
};

export function useActualizacion(): {
  actualizacion: ActualizacionDisponible | null;
  plataforma: PlataformaApp | null;
  actualizar: () => void;
  reintentar: () => void;
} {
  const [actualizacion, setActualizacion] = useState<ActualizacionDisponible | null>(null);
  const [plataforma] = useState<PlataformaApp | null>(() => plataformaNativa());
  const destino = useRef<Destino | null>(null);
  // Una descarga a la vez: volver a la app o recuperar la red mientras baja no
  // arranca otra.
  const bajando = useRef(false);
  const viva = useRef(true);
  const temporizador = useRef<number | undefined>(undefined);

  const descargar = useCallback(async (intento: number): Promise<void> => {
    const d = destino.current;
    if (!d || !viva.current) return;
    bajando.current = true;
    window.clearTimeout(temporizador.current);
    const id = idDePaquete(d.comun.version);
    const totalManifiesto = d.manifiesto.bytes > 0 ? d.manifiesto.bytes : null;
    const fase = (f: FaseInterna, recibidos = 0, total = totalManifiesto) =>
      setActualizacion({ ...d.comun, via: 'interna', fase: f, recibidos, total });

    fase('preparando');
    let escucha: PluginListenerHandle | undefined;
    let ultimoAvance = 0;
    try {
      escucha = await LiveUpdate.addListener('downloadBundleProgress', (e) => {
        if (!viva.current || e.bundleId !== id) return;
        const ahora = Date.now();
        if (ahora - ultimoAvance < INTERVALO_AVANCE_MS) return;
        ultimoAvance = ahora;
        // Sin Content-Length el plugin no sabe el total: el del manifiesto.
        fase('descargando', e.downloadedBytes, e.totalBytes > 0 ? e.totalBytes : totalManifiesto);
      });
      const { bundleIds } = await LiveUpdate.getBundles();
      if (!bundleIds.includes(id)) {
        // El plugin rechaza un .zip cuya firma no sea de la llave del binario.
        await LiveUpdate.downloadBundle({ url: d.url, bundleId: id, signature: d.manifiesto.firmaPaquete });
      }
      if (!viva.current) return;
      fase('aplicando', totalManifiesto ?? 0);
      await LiveUpdate.setNextBundle({ bundleId: id });
      guardarPendiente(d.comun.version);
      await LiveUpdate.reload();
      // reload() recarga el WebView: si esta pagina sigue viva un rato despues,
      // no se reinicio y se ofrece reintentar.
      temporizador.current = window.setTimeout(() => {
        if (!viva.current) return;
        bajando.current = false;
        fase('error');
      }, reintentos.esperaReinicioMs);
    } catch {
      if (!viva.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        // Sigue sola cuando vuelva la red (el evento online revisa de nuevo).
        bajando.current = false;
        fase('sin_red');
        return;
      }
      const espera = reintentos.esperasMs[intento];
      if (espera !== undefined) {
        temporizador.current = window.setTimeout(() => void descargar(intento + 1), espera);
        return;
      }
      bajando.current = false;
      sumarFallo(d.comun.version);
      if (fallosDe(d.comun.version) >= MAX_FALLOS && d.externa) {
        setActualizacion({ ...d.comun, via: 'externa', url: d.externa });
      } else {
        fase('error');
      }
    } finally {
      try {
        await escucha?.remove();
      } catch {
        /* el aviso de avance ya no importa */
      }
    }
  }, []);

  const revisar = useCallback(async () => {
    if (!plataforma) return;
    try {
      await asegurarArranque();
      const [info, res] = await Promise.all([
        CapApp.getInfo(),
        getApiLayer().appVersion?.getLatest(plataforma) ??
          Promise.resolve({ success: false as const, data: undefined }),
      ]);
      if (!viva.current || !res.success || !res.data) return;
      const { version, url, notes, web } = res.data;
      if (!esVersionMasNueva(version, BUILD_VERSION)) return;
      const comun: Comun = { version, instalada: BUILD_VERSION, notas: notasLimpias(notes) };
      const externa = typeof url === 'string' && url !== '' ? url : null;

      if (esPaqueteWeb(web)) {
        const manifiesto = await verificarManifiesto({ manifest: web.manifest, signature: web.signature });
        if (!viva.current) return;
        // El build nativo: versionCode en Android, CFBundleVersion en iOS. Sin
        // saberlo no se arriesga un paquete.
        const build = /^\d+$/.test(String(info.build ?? '')) ? Number(info.build) : NaN;
        const sirve =
          manifiesto !== null &&
          manifiesto.version === version &&
          manifiesto.plataforma === plataforma &&
          manifiesto.nativaMinima <= build &&
          ID_VALIDO.test(idDePaquete(version)) &&
          web.url === urlDelPaquete(version, plataforma);
        const agotada = fallosDe(version) >= MAX_FALLOS;
        if (sirve && (!agotada || !externa)) {
          destino.current = { comun, url: web.url, manifiesto, externa };
          if (bajando.current) return;
          if (agotada) {
            // Sin otra salida (iOS sin canal): se ofrece reintentar a mano, sin
            // ciclos solos.
            setActualizacion({
              ...comun,
              via: 'interna',
              fase: 'error',
              recibidos: 0,
              total: manifiesto.bytes > 0 ? manifiesto.bytes : null,
            });
            return;
          }
          void descargar(0);
          return;
        }
      }
      // Sin URL no hay nada que abrir: el boton quedaria muerto.
      if (!externa) return;
      destino.current = null;
      setActualizacion({ ...comun, via: 'externa', url: externa });
    } catch {
      // Sin red o backend caido: la proxima revision reintenta.
    }
  }, [plataforma, descargar]);

  useEffect(() => {
    if (!plataforma) return;
    viva.current = true;
    try {
      localStorage.removeItem(CLAVE_POSPUESTA_VIEJA);
    } catch {
      /* sin storage no hay nada que limpiar */
    }

    void revisar();
    const escucha = CapApp.addListener('resume', () => void revisar());
    const alVolverLaRed = () => void revisar();
    window.addEventListener('online', alVolverLaRed);
    return () => {
      viva.current = false;
      window.clearTimeout(temporizador.current);
      window.removeEventListener('online', alVolverLaRed);
      void escucha.then((e) => e.remove()).catch(() => undefined);
    };
  }, [plataforma, revisar]);

  // Con la barrera del APK se sigue preguntando: si el backend no trajo el
  // paquete por una falla pasajera, la proxima respuesta lo trae y se pasa a la
  // via interna sin esperar a que la app vuelva a primer plano.
  const viaExterna = actualizacion?.via === 'externa';
  useEffect(() => {
    if (!viaExterna) return;
    const id = window.setInterval(() => void revisar(), reintentos.revisarExternaMs);
    return () => window.clearInterval(id);
  }, [viaExterna, revisar]);

  const actualizar = () => {
    if (actualizacion?.via !== 'externa') return;
    // _system deja la URL en manos del sistema operativo: en Android abre el
    // navegador y baja el APK; en iOS abre TestFlight, App Store o el
    // instalador OTA, segun el esquema que traiga la URL.
    window.open(actualizacion.url, '_system');
  };

  const reintentar = () => {
    if (!destino.current || bajando.current) return;
    void descargar(0);
  };

  return { actualizacion, plataforma, actualizar, reintentar };
}
