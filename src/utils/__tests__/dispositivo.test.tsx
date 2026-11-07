import { describe, it, expect } from 'vitest';
import { leerDispositivo, nombreDelDispositivo } from '../dispositivo';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { IconoDeDispositivo } from '@/components/IconoDeDispositivo';

// User agents reales, copiados de los navegadores y WebViews de cada plataforma.
const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  appAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.51 Mobile Safari/537.36',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
  safariIPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  appIPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  chromeIPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  safariIPad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  whatsappIPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.20.79',
  googleIPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/340.0.682296034 Mobile/15E148 Safari/604.1',
  tiktokAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36 trill_370504 BytedanceWebview/d8a21c6',
  operaIPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/16.0.15 Mobile/15E148 Safari/9537.53',
};

const plantillas = { navegadorEn: '{browser} en {os}', appEn: 'App KiramoPay en {os}', desconocido: 'Unknown device' };

describe('leerDispositivo', () => {
  it.each([
    ['chromeWindows', 'windows', 'Chrome en Windows'],
    ['edgeWindows', 'windows', 'Edge en Windows'],
    ['chromeAndroid', 'android', 'Chrome en Android'],
    ['appAndroid', 'android', 'App KiramoPay en Android'],
    ['safariIPhone', 'iphone', 'Safari en iPhone'],
    ['appIPhone', 'iphone', 'App KiramoPay en iPhone'],
    ['chromeIPhone', 'iphone', 'Chrome en iPhone'],
    ['safariIPad', 'ipad', 'Safari en iPad'],
    ['safariMac', 'mac', 'Safari en Mac'],
    ['firefoxLinux', 'linux', 'Firefox en Linux'],
    ['chromebook', 'chromeos', 'Chrome en ChromeOS'],
    ['operaIPhone', 'iphone', 'Opera en iPhone'],
  ] as const)('%s es %s y se llama "%s"', (clave, plataforma, nombre) => {
    expect(leerDispositivo(UA[clave]).plataforma).toBe(plataforma);
    expect(nombreDelDispositivo(UA[clave], plantillas)).toBe(nombre);
  });

  it('el navegador interno de Facebook no pasa por la app de KiramoPay', () => {
    const d = leerDispositivo(UA.facebookAndroid);
    expect(d.esApp).toBe(false);
    expect(d.plataforma).toBe('android');
  });

  // Un WebView ajeno sin marca propia se confundiria con la app: los que si la
  // dejan (WhatsApp, Google, TikTok...) no pasan por "App KiramoPay".
  it.each(['whatsappIPhone', 'googleIPhone', 'tiktokAndroid'] as const)('%s no es la app de KiramoPay', (clave) => {
    expect(leerDispositivo(UA[clave]).esApp).toBe(false);
    expect(nombreDelDispositivo(UA[clave], plantillas)).not.toMatch(/KiramoPay/);
  });

  it('sin agente de usuario dice "dispositivo desconocido" en el idioma de la pantalla', () => {
    // El servidor rellena el vacio con su propio texto en espanol.
    expect(nombreDelDispositivo('Dispositivo desconocido', plantillas)).toBe('Unknown device');
    expect(nombreDelDispositivo('', plantillas)).toBe('Unknown device');
    expect(leerDispositivo('Dispositivo desconocido').plataforma).toBe('desconocida');
  });

  it('lo que no se reconoce se muestra tal cual, sin inventar un nombre', () => {
    expect(nombreDelDispositivo('okhttp/4.12.0', plantillas)).toBe('okhttp/4.12.0');
  });

  it('cada plataforma tiene su propio icono: Windows ya no sale como un telefono', () => {
    const icono = (ua: string) =>
      render(createElement(IconoDeDispositivo, { userAgent: ua })).container.querySelector('svg')?.getAttribute('data-icono');
    expect(icono(UA.chromeWindows)).toBe('Computadora');
    expect(icono(UA.chromeAndroid)).toBe('TelefonoAndroid');
    expect(icono(UA.appAndroid)).toBe('TelefonoAndroid');
    expect(icono(UA.safariIPhone)).toBe('TelefonoIPhone');
    expect(icono(UA.safariIPad)).toBe('Tableta');
    expect(icono(UA.safariMac)).toBe('Dispositivos');
    // Sin plataforma: navegador solo si se reconoce uno; si no, el generico.
    expect(icono('Mozilla/5.0 (X11; FreeBSD amd64) Gecko/20100101 Firefox/133.0')).toBe('Navegador');
    expect(icono('Dispositivo desconocido')).toBe('Dispositivos');
  });
});
