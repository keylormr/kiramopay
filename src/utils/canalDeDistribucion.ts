import { Capacitor } from '@capacitor/core';

// De donde vino la app instalada.
//
// KiramoPay en Android se distribuye por dos canales y cada uno se actualiza a
// su manera:
//
//   - 'apk': el APK de los releases de GitHub. La barrera de actualizacion baja
//     el .apk nuevo y el sistema lo instala encima.
//   - 'play': el AAB que se sube a Google Play. La politica de Play no deja que
//     una app publicada ahi se modifique, reemplace o actualice por otro medio
//     que el de Play (Device and Network Abuse), asi que esta version nunca
//     ofrece un .apk: manda a su ficha en Play.
//
// Cual es lo decide el binario, no el servidor ni la capa web: la capa web es la
// misma en los dos (en el APK se reemplaza por dentro; en Play, ver
// ACTUALIZACION_WEB_EN_PLAY). El CI marca el AAB agregando un
// texto al user agent del WebView (scripts/marcar-canal.mjs) y de ahi se lee.
// Todo lo que no trae la marca es 'apk': asi son todos los binarios que ya
// estan instalados, y asi se comporta cualquier build local.

export type CanalDeDistribucion = 'apk' | 'play';

/**
 * Si la app de Play puede reemplazar su capa web por dentro (@capawesome/
 * capacitor-live-update), como hace el APK.
 *
 * Apagado a proposito. La politica de Play (Device and Network Abuse,
 * https://support.google.com/googleplay/android-developer/answer/9888379) exime
 * del descargar-codigo-ajeno al "JavaScript en un webview", y por eso el paquete
 * web (HTML, JS y CSS, sin dex ni .so) cae en la excepcion por como esta
 * escrita. Pero la misma pagina dice que una app de Play "may not modify,
 * replace, or update itself using any method other than Google Play's update
 * mechanism", no acota esa frase a lo nativo, y Google no tiene una guia sobre
 * actualizaciones en vivo de apps hibridas que resuelva la duda. En una app
 * financiera, con una cuenta de organizacion que no se puede reponer, no se
 * apuesta a una lectura: la app de Play se actualiza solo por Play.
 *
 * Encenderlo es una decision del titular, despues de preguntarle a Google (el
 * soporte de politicas de Play Console), y es cambiar este valor y publicar. Es
 * una constante del binario y no una respuesta del servidor para que lo que
 * Google revisa sea lo que la app hace.
 */
export const ACTUALIZACION_WEB_EN_PLAY = false;

/** Tiene que ser igual a MARCA_CANAL_PLAY de scripts/marcar-canal.mjs (hay una prueba que lo exige). */
export const MARCA_CANAL_PLAY = 'KiramoPayCanal/play';

/** El identificador de la app en Play: el mismo applicationId del APK. */
export const ID_DE_LA_APP = 'com.kiramopay.app';

/** La ficha de la app en Google Play. */
export const FICHA_DE_PLAY = `https://play.google.com/store/apps/details?id=${ID_DE_LA_APP}`;

/**
 * El canal por el que se instalo esta app. Solo Android puede ser 'play'; en web
 * y en iOS no aplica y devuelve 'apk', que es lo que no cambia nada.
 */
export function canalDeDistribucion(): CanalDeDistribucion {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return 'apk';
  const agente = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return agente.split(/\s+/).includes(MARCA_CANAL_PLAY) ? 'play' : 'apk';
}

/**
 * La URL de la ficha de Play de ESTA app, o null si lo recibido es otra cosa.
 *
 * La barrera abre lo que le llega, y en el canal de Play eso solo puede ser la
 * ficha: un servidor viejo que no conoce el canal respondera con la URL del
 * .apk, y esa nunca debe abrirse desde una app de Play.
 */
export function fichaDePlayValida(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const esFicha =
    u.protocol === 'https:' &&
    u.hostname === 'play.google.com' &&
    u.pathname === '/store/apps/details' &&
    u.searchParams.get('id') === ID_DE_LA_APP;
  return esFicha ? url : null;
}
