import type { CapacitorConfig } from '@capacitor/cli';

// El hostname del WebView NO puede ser el mismo en las dos plataformas.
//
// En Android el esquema es `https`, asi que `https://app.kiramopay.com` es un
// contexto seguro y `getUserMedia` (el escaner QR) funciona. En iOS el esquema
// es `capacitor` y NO se puede cambiar a https —WKWebView ya maneja ese esquema
// y Capacitor lo prohibe explicitamente—, de modo que el origen seria
// `capacitor://app.kiramopay.com`: un origen que el WebView NO considera
// seguro, y ahi `navigator.mediaDevices` ni siquiera existe. Con `localhost` si
// lo es (la especificacion de Secure Contexts trata localhost como confiable
// sea cual sea el esquema), y por eso la documentacion de Capacitor recomienda
// dejarlo asi justo para geolocalizacion y getUserMedia.
//
// Consecuencia operativa: el origen de la app iOS es `capacitor://localhost` y
// tiene que estar en CORS_ORIGINS del backend, igual que
// `https://app.kiramopay.com` lo esta para Android.
//
// Este archivo lo evalua el CLI de Capacitor en cada invocacion, asi que se
// resuelve por la plataforma que se esta sincronizando. Un `npx cap sync` SIN
// plataforma no puede distinguir y le daria a iOS el hostname de Android: usar
// siempre `npm run sync:ios` / `npm run sync:android`, que la pasan explicita.
const esIOS = process.env.CAP_PLATFORM === 'ios' || process.argv.includes('ios');

const config: CapacitorConfig = {
  appId: 'com.kiramopay.app',
  appName: 'KiramoPay',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: esIOS ? 'localhost' : 'app.kiramopay.com',
    // Solo Android (ver android.minWebViewVersion). En iOS errorPath se abre
    // ante cualquier carga fallida y la pagina hablaria de Android.
    ...(esIOS ? {} : { errorPath: 'webview-viejo/index.html' }),
  },
  // El WebView minimo con el que la capa web se ve y funciona: su JavaScript
  // pide Chrome 80 (el operador `??`) y sus estilos, de Tailwind 4, Chrome 111
  // (debajo de la 99 no entienden @layer y se pierde casi todo el CSS). Con un
  // WebView anterior Capacitor no carga la app: abre server.errorPath, una
  // pagina en ES5 que dice que actualizar (public/webview-viejo, con el mismo
  // numero). Sin errorPath solo lo anota en Logcat y la app queda en blanco.
  android: {
    minWebViewVersion: 111,
  },
  // Sin bloque `ios`: el default de `contentInset` es 'never', que es
  // justamente lo que esta app necesita —el HTML declara viewport-fit=cover y
  // se paga sus propios margenes con env(safe-area-inset-*) (.pt-safe/.pb-safe
  // en index.css). Cualquier otro valor haria que UIKit sume SU inset encima y
  // el contenido quedaria con doble margen bajo el notch.
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      // Mismo navy que el fondo plano de drawable*/splash.png: con CENTER_CROP
      // el recorte no se nota en ningun aspecto de pantalla.
      backgroundColor: '#1B294A',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#FFFFFF',
    },
    // Actualizacion interna de la capa web (@capawesome/capacitor-live-update),
    // autoalojada: el paquete y su manifiesto firmado son adjuntos del release
    // de GitHub (scripts/paquete-web.mjs) y la app decide cuando bajarlos
    // (src/hooks/useActualizacion.ts). Sin appId ni autoUpdateStrategy: el
    // plugin nunca habla con los servidores de Capawesome.
    //
    // publicKey: con ella el plugin rechaza en nativo, antes de descomprimir,
    // todo .zip sin una firma valida de la llave privada del CI (secreto
    // LIVE_UPDATE_PRIVATE_KEY), aunque lo pida JS ajeno. Viaja en el binario y
    // el JS no la puede cambiar: cambiarla obliga a publicar un APK. Tiene que
    // ser la misma que LLAVE_PUBLICA_PAQUETES (src/utils/paqueteFirmado.ts).
    //
    // readyTimeout: si el paquete nuevo no confirma que arranco (ready(), en
    // AppConGuardia) en ese plazo, el plugin vuelve al paquete del binario. El
    // plazo cuenta desde que arranca lo nativo; 20 s dejan margen a un telefono
    // lento sin dejar a nadie mucho tiempo frente a un paquete roto.
    //
    // autoDeleteBundles: despues de cada ready() borra los paquetes que ya no
    // se usan.
    LiveUpdate: {
      publicKey:
        '-----BEGIN PUBLIC KEY-----MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAinaoOAWrdZndWTRl6kg8sD/fWUjNVXtbApeJAUR6V1c0gRMLlfQUFzQ5WkdNA2nODA3Rqq7Jw4j71caG+EsafRDZ96Y2T9jH9mgl17pFGGZmAjzQICnC04X2r3iQQzlC0vuBsEAeNCEN2ZClSds9YZUim9UakI1SviU0qhVYPrfjDydb7/64JSh5EJUNoJsZfNwC6oXa0QPhQ7HktYhOVpiZFQGEDVCQ5SvfgXoAUjEXDWAmaYirTqBRQBc/5bSNYEbelBWMoYTJV8f+8A4CcxfWCCTsSMhmnN7sLKV7GSnyl67GXclvfL9qj1HOLiUgh8DdD+7Jjo2ywT55N4lnTQIDAQAB-----END PUBLIC KEY-----',
      readyTimeout: 20000,
      autoDeleteBundles: true,
    },
  },
};

export default config;
