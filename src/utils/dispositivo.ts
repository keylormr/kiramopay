/**
 * Lo que se puede saber de un aparato a partir del user agent que el servidor
 * guardo al abrir la sesion. Lo usan "Dispositivos conectados" (la persona) y
 * el panel de administracion (las sesiones de otra cuenta).
 *
 * El texto crudo no sirve de titulo ("Mozilla/5.0 (Windows NT 10.0; Win64;
 * x64) Chrome/141" ocupa tres renglones y no dice cual aparato es), asi que se
 * reduce a plataforma y navegador. Lo que no se reconoce se muestra tal cual:
 * inventar un nombre seria peor que ensenar el texto del servidor.
 */

export type Plataforma = 'android' | 'iphone' | 'ipad' | 'windows' | 'mac' | 'chromeos' | 'linux' | 'desconocida';

export interface Dispositivo {
  plataforma: Plataforma;
  /** Nombre del sistema para mostrar ("Android", "iPhone"...); null si no se sabe. */
  sistema: string | null;
  /** Navegador reconocido; null si no se sabe o si es la app. */
  navegador: string | null;
  /**
   * La app instalada (el WebView de Capacitor) y no un navegador. Es una
   * deduccion: el WebView de Android marca "; wv)" y el de iOS no dice
   * "Safari/". Los navegadores internos de otras apps que dejan su marca
   * (Facebook, Instagram, WhatsApp, Google, TikTok, Line...) se excluyen; uno
   * que no deja marca se confunde con la app. El user agent lo manda el
   * cliente: esto describe el aparato, no prueba nada sobre el.
   */
  esApp: boolean;
}

// El orden importa: Edge y Opera tambien dicen Chrome, Chrome tambien dice
// Safari, y Android tambien dice Linux.
const NAVEGADORES: Array<[RegExp, string]> = [
  [/\bEdg(?:e|iOS|A)?\//, 'Edge'],
  [/\bOPR\/|\bOPiOS\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SISTEMAS: Array<[RegExp, Plataforma, string]> = [
  [/\bAndroid\b/, 'android', 'Android'],
  [/\biPhone\b/, 'iphone', 'iPhone'],
  [/\biPad\b/, 'ipad', 'iPad'],
  [/\bWindows\b/, 'windows', 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'mac', 'Mac'],
  [/\bCrOS\b/, 'chromeos', 'ChromeOS'],
  [/\bLinux\b/, 'linux', 'Linux'],
];

// Navegadores internos de otras apps que dejan su marca en el user agent.
const NAVEGADOR_INTERNO_AJENO =
  /\bFBAN\/|\bFBAV\/|\bFB_IAB\b|\bInstagram\b|\bWhatsApp\b|\bGSA\/|\bLine\/|\bTwitter\b|\bTikTok\b|\bmusical_ly\b|\bBytedanceWebview\b|\bTelegram\b|\bSnapchat\b|\bPinterest\b|\bLinkedInApp\b|\bMicroMessenger\b|\bDuckDuckGo\b|\bDdg\/|\bSlack\b|\bDiscord\b/;

export function leerDispositivo(userAgent: string): Dispositivo {
  const ua = userAgent || '';
  const so = SISTEMAS.find(([re]) => re.test(ua));
  const plataforma: Plataforma = so?.[1] ?? 'desconocida';
  const ajeno = NAVEGADOR_INTERNO_AJENO.test(ua);
  const webViewAndroid = plataforma === 'android' && /;\s*wv\)/.test(ua);
  const webViewIOS =
    (plataforma === 'iphone' || plataforma === 'ipad') &&
    /AppleWebKit\//.test(ua) &&
    !/\bSafari\//.test(ua) &&
    !/\b(?:CriOS|FxiOS|EdgiOS|OPiOS)\//.test(ua);
  const esApp = !ajeno && (webViewAndroid || webViewIOS);
  return {
    plataforma,
    sistema: so?.[2] ?? null,
    navegador: esApp ? null : NAVEGADORES.find(([re]) => re.test(ua))?.[1] ?? null,
    esApp,
  };
}

export interface PlantillasDeNombre {
  /** "{browser} en {os}" */
  navegadorEn: string;
  /** "App KiramoPay en {os}" */
  appEn: string;
  /** "Dispositivo desconocido", en el idioma de la pantalla. */
  desconocido: string;
}

/**
 * Sin user agent el servidor manda su propio texto, en espanol (auth/sessions.go
 * lo rellena con COALESCE): se traduce en vez de mostrarlo tal cual.
 */
const SIN_AGENTE_DEL_SERVIDOR = 'Dispositivo desconocido';

/** El nombre legible del aparato; el texto del servidor si no se reconoce nada. */
export function nombreDelDispositivo(userAgent: string, plantillas: PlantillasDeNombre): string {
  const crudo = (userAgent || '').trim();
  if (!crudo || crudo === SIN_AGENTE_DEL_SERVIDOR) return plantillas.desconocido;
  const d = leerDispositivo(userAgent);
  if (d.esApp && d.sistema) return plantillas.appEn.replace('{os}', d.sistema);
  if (d.navegador && d.sistema) return plantillas.navegadorEn.replace('{browser}', d.navegador).replace('{os}', d.sistema);
  return d.navegador || d.sistema || userAgent;
}
