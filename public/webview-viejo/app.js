/*
 * Pagina del WebView viejo (public/webview-viejo/index.html).
 *
 * ES5 puro: corre en el WebView que no puede con la app (en el emulador de
 * Android 7, el 69). Nada de let/const, funciones flecha, plantillas ni `??`.
 *
 * Capacitor la abre en dos casos (server.errorPath): cuando el WebView es
 * anterior a android.minWebViewVersion, y cuando falla la carga del marco
 * principal. Por eso mira la version que dice el propio WebView: si es vieja,
 * explica como actualizarlo; si no, la app no abrio por otra cosa y ofrece
 * volver a intentar.
 */
(function () {
  'use strict';

  // El mismo numero que android.minWebViewVersion en capacitor.config.ts.
  var MINIMO = 111;

  var TEXTOS = {
    es: {
      titulo: 'Hace falta una actualización',
      explicacion:
        'KiramoPay usa un componente de tu teléfono para mostrarse, y la versión que tienes es muy vieja para abrir la app.',
      paso1: 'Abre Google Play.',
      pasoChrome:
        'Busca «Google Chrome» y toca Actualizar. En tu versión de Android, Chrome es el que muestra las apps.',
      pasoWebView: 'Busca «Android System WebView» y toca Actualizar.',
      paso3: 'Cierra KiramoPay y vuelve a abrirla.',
      boton: 'Abrir Google Play',
      version: 'Versión del componente: {v}. KiramoPay necesita la {m} o una más nueva.',
      otroTitulo: 'No pudimos abrir KiramoPay',
      otroExplicacion: 'Cierra la app y vuelve a abrirla. Si sigue pasando, escríbenos a soporte@kiramopay.com.',
      otroBoton: 'Volver a intentar'
    },
    en: {
      titulo: 'An update is needed',
      explicacion: 'KiramoPay uses a component of your phone to display itself, and your version is too old to open the app.',
      paso1: 'Open Google Play.',
      pasoChrome:
        'Search for “Google Chrome” and tap Update. On your Android version, Chrome displays the apps.',
      pasoWebView: 'Search for “Android System WebView” and tap Update.',
      paso3: 'Close KiramoPay and open it again.',
      boton: 'Open Google Play',
      version: 'Component version: {v}. KiramoPay needs {m} or newer.',
      otroTitulo: 'We couldn’t open KiramoPay',
      otroExplicacion: 'Close the app and open it again. If it keeps happening, write to us at soporte@kiramopay.com.',
      otroBoton: 'Try again'
    }
  };

  function numero(patron, texto) {
    var encontrado = patron.exec(texto);
    return encontrado ? parseInt(encontrado[1], 10) : 0;
  }

  function poner(id, texto) {
    var elemento = document.getElementById(id);
    if (elemento) elemento.textContent = texto;
    return elemento;
  }

  var agente = navigator.userAgent || '';
  var version = numero(/Chrome\/(\d+)/, agente);
  var android = numero(/Android (\d+)/, agente);
  var idioma = String((navigator.languages && navigator.languages[0]) || navigator.language || 'es').toLowerCase();
  var lengua = idioma.indexOf('es') === 0 ? 'es' : 'en';
  var t = TEXTOS[lengua];
  var viejo = version > 0 && version < MINIMO;

  document.documentElement.setAttribute('lang', lengua);
  document.documentElement.setAttribute('data-motivo', viejo ? 'webview-viejo' : 'otro');

  var boton = document.getElementById('boton');
  var pasos = document.getElementById('pasos');
  var linea = document.getElementById('version');

  if (viejo) {
    // En Android 7, 8 y 9 el WebView lo da Chrome; desde Android 10, Android
    // System WebView. Si no se sabe, lo segundo.
    var conChrome = android > 0 && android < 10;
    poner('titulo', t.titulo);
    poner('explicacion', t.explicacion);
    poner('paso-1', t.paso1);
    poner('paso-2', conChrome ? t.pasoChrome : t.pasoWebView);
    poner('paso-3', t.paso3);
    poner('boton', t.boton);
    if (boton) {
      boton.setAttribute(
        'href',
        'https://play.google.com/store/apps/details?id=' + (conChrome ? 'com.android.chrome' : 'com.google.android.webview')
      );
    }
    poner('version', t.version.replace('{v}', String(version)).replace('{m}', String(MINIMO)));
    if (linea) linea.hidden = false;
  } else {
    poner('titulo', t.otroTitulo);
    poner('explicacion', t.otroExplicacion);
    if (pasos) pasos.hidden = true;
    if (linea) linea.hidden = true;
    poner('boton', t.otroBoton);
    if (boton) boton.setAttribute('href', '/');
  }
})();
