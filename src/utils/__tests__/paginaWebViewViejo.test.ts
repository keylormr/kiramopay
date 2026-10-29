import fs from 'fs';
import path from 'path';
import { Linter } from 'eslint';

// La pagina que Capacitor abre en Android en lugar de la app cuando el WebView
// del telefono es anterior a android.minWebViewVersion (server.errorPath). Con
// un WebView viejo la capa web no corre (el `??` pide Chrome 80) y los estilos
// de Tailwind 4 no aplican (las capas @layer piden Chrome 99; Tailwind 4 se
// apoya en Chrome 111): la persona veia la app en blanco, sin explicacion.
//
// La pagina corre en ese WebView viejo (en el emulador, el 69 de Android 7):
// ES5 puro, sin modulos. Se prueba el HTML y el script de verdad.

const raiz = process.cwd();
// Si falta un archivo, cada prueba falla por su cuenta (no el archivo entero).
const leer = (relativa: string) => {
  const ruta = path.join(raiz, relativa);
  return fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf-8') : '';
};
const html = leer('public/webview-viejo/index.html');
const script = leer('public/webview-viejo/app.js');

const MINIMO = 111;

const UA_ANDROID_7_WEBVIEW_69 =
  'Mozilla/5.0 (Linux; Android 7.0; Android SDK built for x86_64 Build/NYC; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/69.0.3497.100 Mobile Safari/537.36';
const UA_ANDROID_10_WEBVIEW_105 =
  'Mozilla/5.0 (Linux; Android 10; Pixel 3 Build/QQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/105.0.5195.136 Mobile Safari/537.36';
const UA_ANDROID_14_WEBVIEW_113 =
  'Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64 Build/UE1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.5672.136 Mobile Safari/537.36';

const original = {
  userAgent: Object.getOwnPropertyDescriptor(window.navigator, 'userAgent'),
  language: Object.getOwnPropertyDescriptor(window.navigator, 'language'),
  languages: Object.getOwnPropertyDescriptor(window.navigator, 'languages'),
};

function telefono(userAgent: string, idioma: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: idioma, configurable: true });
  Object.defineProperty(window.navigator, 'languages', { value: [idioma], configurable: true });
}

function montar() {
  const cuerpo = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = cuerpo.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.documentElement.lang = 'es';
  document.documentElement.removeAttribute('data-motivo');
  // El script es un IIFE que busca sus elementos por id.
  new Function(script)();
}

const porId = (id: string) => document.getElementById(id) as HTMLElement;
const texto = (id: string) => (porId(id).textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => {
  for (const [clave, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(window.navigator, clave, descriptor);
    else delete (window.navigator as unknown as Record<string, unknown>)[clave];
  }
  document.body.innerHTML = '';
});

describe('pagina del WebView viejo: corre en un WebView de 2018', () => {
  it('el script es ES5: lo acepta un analizador limitado a ECMAScript 5', () => {
    const fatales = (codigo: string) =>
      new Linter()
        .verify(codigo, [{ languageOptions: { ecmaVersion: 5, sourceType: 'script' } }])
        .filter((e) => e.fatal);
    // El analizador rechaza lo que rompio la app en el WebView 69.
    expect(fatales('var a = b ?? c;')).not.toEqual([]);
    expect(fatales('const a = () => 1;')).not.toEqual([]);

    expect(script).not.toBe('');
    expect(fatales(script)).toEqual([]);
  });

  it('el HTML carga el script como script clasico, sin modulos ni codigo en linea', () => {
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatch(/src="app\.js"/);
    expect(scripts[0]).not.toMatch(/type="module"|nomodule/);
    expect(scripts[0]).toMatch(/><\/script>$/);
  });

  it('sin JavaScript ya dice que hacer, en espanol', () => {
    const cuerpo = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
    expect(cuerpo).toMatch(/Google Play/);
    expect(cuerpo).toMatch(/Android System WebView/);
    expect(cuerpo).toMatch(/vuelve a abrirla/);
  });

  it('el estilo no usa CSS que ese WebView ignora (capas, oklch, color-mix, gap en flex)', () => {
    const estilos = /<style>([\s\S]*?)<\/style>/i.exec(html)?.[1] ?? '';
    expect(estilos).not.toBe('');
    expect(estilos).not.toMatch(/@layer|oklch\(|color-mix\(|\bgap\s*:|clamp\(|:is\(|:where\(|\binset\s*:/);
  });
});

describe('pagina del WebView viejo: que hacer, segun el telefono', () => {
  it('Android 7 con WebView 69 en espanol: actualizar Chrome desde Google Play y volver a abrir', () => {
    telefono(UA_ANDROID_7_WEBVIEW_69, 'es-CR');
    montar();

    expect(document.documentElement.getAttribute('data-motivo')).toBe('webview-viejo');
    expect(document.documentElement.lang).toBe('es');
    expect(texto('titulo')).toBe('Hace falta una actualización');
    expect(texto('pasos')).toMatch(/Abre Google Play/);
    // En Android 7 a 9 el WebView lo da Chrome.
    expect(texto('pasos')).toMatch(/«Google Chrome»/);
    expect(texto('pasos')).toMatch(/vuelve a abrirla/);
    expect(porId('boton').getAttribute('href')).toBe('https://play.google.com/store/apps/details?id=com.android.chrome');
    expect(texto('boton')).toBe('Abrir Google Play');
    expect(texto('version')).toContain('69');
    expect(texto('version')).toContain(String(MINIMO));
  });

  it('Android 10 o mas nuevo en ingles: actualizar Android System WebView', () => {
    telefono(UA_ANDROID_10_WEBVIEW_105, 'en-US');
    montar();

    expect(document.documentElement.getAttribute('data-motivo')).toBe('webview-viejo');
    expect(document.documentElement.lang).toBe('en');
    expect(texto('titulo')).toBe('An update is needed');
    expect(texto('pasos')).toMatch(/Open Google Play/);
    expect(texto('pasos')).toMatch(/“Android System WebView”/);
    expect(texto('pasos')).toMatch(/open it again/);
    expect(porId('boton').getAttribute('href')).toBe(
      'https://play.google.com/store/apps/details?id=com.google.android.webview',
    );
    expect(texto('boton')).toBe('Open Google Play');
  });

  it('un idioma que no es espanol ni ingles cae en ingles', () => {
    telefono(UA_ANDROID_7_WEBVIEW_69, 'pt-BR');
    montar();
    expect(document.documentElement.lang).toBe('en');
    expect(texto('titulo')).toBe('An update is needed');
  });

  it('con un WebView al dia no pide actualizar: la app no abrio por otra cosa y se puede reintentar', () => {
    // Capacitor tambien abre esta pagina si falla la carga del marco principal.
    telefono(UA_ANDROID_14_WEBVIEW_113, 'es-CR');
    montar();

    expect(document.documentElement.getAttribute('data-motivo')).toBe('otro');
    expect(texto('titulo')).toBe('No pudimos abrir KiramoPay');
    expect(texto('explicacion')).toMatch(/soporte@kiramopay\.com/);
    expect(porId('pasos').hidden).toBe(true);
    expect(porId('version').hidden).toBe(true);
    expect(porId('boton').getAttribute('href')).toBe('/');
    expect(texto('boton')).toBe('Volver a intentar');
  });
});

describe('Capacitor abre la pagina en Android cuando el WebView es viejo', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('en Android: minWebViewVersion y errorPath apuntan a la pagina, con el mismo minimo que ella', async () => {
    vi.stubEnv('CAP_PLATFORM', 'android');
    vi.resetModules();
    const { default: config } = await import('../../../capacitor.config');

    expect(config.android?.minWebViewVersion).toBe(MINIMO);
    expect(config.server?.errorPath).toBe('webview-viejo/index.html');
    expect(/var MINIMO = (\d+);/.exec(script)?.[1]).toBe(String(MINIMO));
  });

  it('en iOS no: alli errorPath se abre ante cualquier carga fallida y hablaria de Android', async () => {
    vi.stubEnv('CAP_PLATFORM', 'ios');
    vi.resetModules();
    const { default: config } = await import('../../../capacitor.config');

    expect(config.server?.errorPath).toBeUndefined();
  });
});
