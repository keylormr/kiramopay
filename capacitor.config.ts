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
      backgroundColor: '#0A84FF',
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
