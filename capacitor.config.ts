import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kiramopay.app',
  appName: 'KiramoPay',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'app.kiramopay.com',
  },
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
