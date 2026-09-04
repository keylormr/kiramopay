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
  },
};

export default config;
