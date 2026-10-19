import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import {
  entraEnLaHuella,
  huellaNativa,
  decidirNativaMinima,
  armarManifiesto,
  firmar,
  verificar,
  llavePublicaDeConfig,
  elegirReleaseAnterior,
  leerManifiestoAnterior,
  adjuntosDe,
} from '../../../scripts/paquete-web.mjs';

// La actualizacion interna baja solo la capa web. Un paquete web armado para
// una parte nativa distinta (otro plugin, otra version de Capacitor, otro
// permiso) puede llamar a algo que el telefono no tiene. Por eso el CI calcula
// una huella de lo nativo y publica la version nativa minima que el paquete
// necesita: si el telefono tiene una mas vieja, se actualiza por APK.

const llaves = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const archivo = (ruta: string, contenido: string) => ({ ruta, contenido: Buffer.from(contenido) });

const GRADLE = [
  'android {',
  '    defaultConfig {',
  '        minSdkVersion rootProject.ext.minSdkVersion',
  '        versionCode 18',
  '        versionName "2.8.0"',
  '    }',
  '}',
].join('\n');

const base = () => ({
  plataforma: 'android',
  archivos: [
    archivo('android/app/build.gradle', GRADLE),
    archivo('android/app/src/main/AndroidManifest.xml', '<manifest><uses-permission android:name="android.permission.CAMERA" /></manifest>'),
    archivo('capacitor.config.ts', "export default { appId: 'com.kiramopay.app' };"),
  ],
  dependencias: { '@capacitor/android': '6.2.2', '@capawesome/capacitor-live-update': '6.9.2' } as Record<string, string>,
  extras: { firebase: 'si' },
});

describe('huellaNativa', () => {
  it('no cambia solo porque cambia el numero de version', () => {
    const otra = base();
    otra.archivos[0] = archivo(
      'android/app/build.gradle',
      GRADLE.replace('versionCode 18', 'versionCode 19').replace('"2.8.0"', '"2.9.0"'),
    );
    expect(huellaNativa(otra)).toBe(huellaNativa(base()));
  });

  it('en iOS tampoco cambia por MARKETING_VERSION ni CURRENT_PROJECT_VERSION', () => {
    const pbx = (v: string, b: number) =>
      `buildSettings = {\n\tCURRENT_PROJECT_VERSION = ${b};\n\tMARKETING_VERSION = ${v};\n\tSWIFT_VERSION = 5.0;\n};`;
    const ios = (v: string, b: number) => ({
      plataforma: 'ios',
      archivos: [archivo('ios/App/App.xcodeproj/project.pbxproj', pbx(v, b))],
      dependencias: {},
      extras: {},
    });
    expect(huellaNativa(ios('2.9.0', 19))).toBe(huellaNativa(ios('2.8.0', 18)));
  });

  it('un checkout de Windows (CRLF) da la misma huella que el del CI', () => {
    const crlf = base();
    crlf.archivos = crlf.archivos.map((a) => archivo(a.ruta, a.contenido.toString().replace(/\n/g, '\r\n')));
    expect(huellaNativa(crlf)).toBe(huellaNativa(base()));
  });

  it('cambia si cambia el manifiesto de Android', () => {
    const otra = base();
    otra.archivos[1] = archivo('android/app/src/main/AndroidManifest.xml', '<manifest><uses-permission android:name="android.permission.NFC" /></manifest>');
    expect(huellaNativa(otra)).not.toBe(huellaNativa(base()));
  });

  it('cambia si cambia la configuracion de Capacitor (donde va la llave publica)', () => {
    const otra = base();
    otra.archivos[2] = archivo('capacitor.config.ts', "export default { appId: 'com.kiramopay.app', plugins: {} };");
    expect(huellaNativa(otra)).not.toBe(huellaNativa(base()));
  });

  it('cambia si cambia la version de un plugin nativo', () => {
    const otra = base();
    otra.dependencias = { ...otra.dependencias, '@capacitor/android': '6.2.3' };
    expect(huellaNativa(otra)).not.toBe(huellaNativa(base()));
  });

  it('cambia si se agrega un plugin nativo', () => {
    const otra = base();
    otra.dependencias = { ...otra.dependencias, '@capacitor/camera': '6.0.0' };
    expect(huellaNativa(otra)).not.toBe(huellaNativa(base()));
  });

  // Sin google-services.json el APK no trae avisos nativos y la capa web lo
  // sabe por VITE_PUSH_NATIVO: un paquete con avisos no sirve a un APK sin ellos.
  it('cambia si cambia la configuracion de Firebase', () => {
    const otra = base();
    otra.extras = { firebase: 'no' };
    expect(huellaNativa(otra)).not.toBe(huellaNativa(base()));
  });

  it('el orden en que llegan los archivos no importa', () => {
    const otra = base();
    otra.archivos = [...otra.archivos].reverse();
    expect(huellaNativa(otra)).toBe(huellaNativa(base()));
  });

  it('ignora lo que no viaja en el binario: fastlane y documentacion', () => {
    const otra = base();
    otra.archivos.push(archivo('android/fastlane/metadata/android/es-419/changelogs/default.txt', 'Novedades'));
    otra.archivos.push(archivo('android/README.md', 'Como compilar'));
    expect(huellaNativa(otra)).toBe(huellaNativa(base()));
  });

  it('la huella de una plataforma no mira los archivos de la otra', () => {
    const otra = base();
    otra.archivos.push(archivo('ios/App/App/Info.plist', '<plist/>'));
    expect(huellaNativa(otra)).toBe(huellaNativa(base()));
  });
});

describe('entraEnLaHuella', () => {
  it('entra lo nativo de la plataforma y la configuracion de Capacitor', () => {
    expect(entraEnLaHuella('android/app/build.gradle', 'android')).toBe(true);
    expect(entraEnLaHuella('android/app/src/main/res/drawable/splash.png', 'android')).toBe(true);
    expect(entraEnLaHuella('ios/App/Podfile', 'ios')).toBe(true);
    expect(entraEnLaHuella('capacitor.config.ts', 'android')).toBe(true);
    expect(entraEnLaHuella('capacitor.config.ts', 'ios')).toBe(true);
  });

  it('no entra la otra plataforma, fastlane, Gemfile ni documentacion', () => {
    expect(entraEnLaHuella('ios/App/Podfile', 'android')).toBe(false);
    expect(entraEnLaHuella('android/app/build.gradle', 'ios')).toBe(false);
    expect(entraEnLaHuella('android/fastlane/Fastfile', 'android')).toBe(false);
    expect(entraEnLaHuella('ios/App/fastlane/Fastfile', 'ios')).toBe(false);
    expect(entraEnLaHuella('android/Gemfile.lock', 'android')).toBe(false);
    expect(entraEnLaHuella('ios/README.md', 'ios')).toBe(false);
    expect(entraEnLaHuella('src/App.tsx', 'android')).toBe(false);
  });
});

describe('decidirNativaMinima', () => {
  it('sin release anterior con manifiesto, exige el APK de esta version', () => {
    expect(decidirNativaMinima({ huella: 'h1', versionCode: 19, anterior: null })).toBe(19);
  });

  it('si lo nativo no cambio, sirve el mismo APK que servia antes', () => {
    expect(decidirNativaMinima({ huella: 'h1', versionCode: 21, anterior: { huellaNativa: 'h1', nativaMinima: 19 } })).toBe(19);
  });

  it('si lo nativo cambio, exige el APK de esta version', () => {
    expect(decidirNativaMinima({ huella: 'h2', versionCode: 21, anterior: { huellaNativa: 'h1', nativaMinima: 19 } })).toBe(21);
  });

  it('un manifiesto anterior con datos raros no se aprovecha', () => {
    expect(decidirNativaMinima({ huella: 'h1', versionCode: 21, anterior: { huellaNativa: 'h1', nativaMinima: 25 } })).toBe(21);
    expect(decidirNativaMinima({ huella: 'h1', versionCode: 21, anterior: { huellaNativa: 'h1', nativaMinima: 0 } })).toBe(21);
    expect(decidirNativaMinima({ huella: 'h1', versionCode: 21, anterior: { huellaNativa: 'h1', nativaMinima: '19' } })).toBe(21);
  });
});

describe('firma del paquete y del manifiesto', () => {
  it('lo que firma el CI se verifica con la llave publica', () => {
    const { publicKey, privateKey } = llaves();
    const datos = Buffer.from('paquete');
    const firma = firmar(datos, privateKey);
    expect(verificar(datos, firma, publicKey)).toBe(true);
    expect(verificar(Buffer.from('paquetE'), firma, publicKey)).toBe(false);
  });

  it('una firma de otra llave no pasa', () => {
    const una = llaves();
    const otra = llaves();
    const datos = Buffer.from('paquete');
    expect(verificar(datos, firmar(datos, una.privateKey), otra.publicKey)).toBe(false);
  });

  it('el manifiesto lleva todo lo que la app necesita para decidir', () => {
    const texto = armarManifiesto({
      plataforma: 'android',
      version: '2.9.0',
      versionCode: 19,
      nativaMinima: 19,
      huellaNativa: 'abc',
      paquete: 'kiramopay-web-android.zip',
      firmaPaquete: 'ZmlybWE=',
      bytes: 812345,
    });
    expect(JSON.parse(texto)).toEqual({
      formato: 1,
      plataforma: 'android',
      version: '2.9.0',
      versionCode: 19,
      nativaMinima: 19,
      huellaNativa: 'abc',
      paquete: 'kiramopay-web-android.zip',
      firmaPaquete: 'ZmlybWE=',
      bytes: 812345,
    });
  });
});

describe('llavePublicaDeConfig', () => {
  // El CI firma con el secreto y comprueba con esta llave: si no corresponden,
  // el release no sale, porque ningun telefono podria aceptar el paquete.
  it('saca la llave publica de capacitor.config.ts', () => {
    const texto = readFileSync(path.resolve(__dirname, '../../../capacitor.config.ts'), 'utf8');
    const pem = llavePublicaDeConfig(texto);
    expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----[A-Za-z0-9+/=]+-----END PUBLIC KEY-----$/);
  });

  it('sin llave devuelve null', () => {
    expect(llavePublicaDeConfig("export default { appId: 'x' };")).toBeNull();
  });
});

describe('elegirReleaseAnterior', () => {
  const rel = (tag_name: string, extra: Record<string, unknown> = {}) => ({ tag_name, draft: false, prerelease: false, ...extra });

  it('elige la version publicada mas alta por debajo de la actual', () => {
    const r = elegirReleaseAnterior([rel('v2.10.0'), rel('v2.8.0'), rel('v2.9.1'), rel('v2.7.0')], 'v2.10.0');
    expect(r?.tag_name).toBe('v2.9.1');
  });

  it('ignora borradores y pre-releases', () => {
    const r = elegirReleaseAnterior([rel('v2.9.2', { prerelease: true }), rel('v2.9.1', { draft: true }), rel('v2.9.0')], 'v2.10.0');
    expect(r?.tag_name).toBe('v2.9.0');
  });

  it('sin anteriores devuelve null', () => {
    expect(elegirReleaseAnterior([rel('v2.9.0')], 'v2.9.0')).toBeNull();
    expect(elegirReleaseAnterior([], 'v2.9.0')).toBeNull();
  });
});

describe('leerManifiestoAnterior', () => {
  const manifiesto = (plataforma = 'android') =>
    armarManifiesto({
      plataforma,
      version: '2.9.0',
      versionCode: 19,
      nativaMinima: 19,
      huellaNativa: 'h1',
      paquete: `kiramopay-web-${plataforma}.zip`,
      firmaPaquete: 'ZmlybWE=',
      bytes: 1,
    });

  it('acepta el manifiesto firmado con la llave vigente', () => {
    const { publicKey, privateKey } = llaves();
    const texto = manifiesto();
    const adjunto = { manifiesto: Buffer.from(texto).toString('base64'), firma: firmar(Buffer.from(texto), privateKey) };
    expect(leerManifiestoAnterior(adjunto, publicKey, 'android')).toMatchObject({ huellaNativa: 'h1', nativaMinima: 19 });
  });

  // Si la llave cambio, los telefonos viejos no pueden verificar los paquetes
  // nuevos: el anterior no cuenta y la version nueva se exige por APK.
  it('con la firma de otra llave no cuenta', () => {
    const una = llaves();
    const otra = llaves();
    const texto = manifiesto();
    const adjunto = { manifiesto: Buffer.from(texto).toString('base64'), firma: firmar(Buffer.from(texto), una.privateKey) };
    expect(leerManifiestoAnterior(adjunto, otra.publicKey, 'android')).toBeNull();
  });

  it('el de la otra plataforma no cuenta', () => {
    const { publicKey, privateKey } = llaves();
    const texto = manifiesto('ios');
    const adjunto = { manifiesto: Buffer.from(texto).toString('base64'), firma: firmar(Buffer.from(texto), privateKey) };
    expect(leerManifiestoAnterior(adjunto, publicKey, 'android')).toBeNull();
  });

  it('basura no cuenta', () => {
    const { publicKey } = llaves();
    expect(leerManifiestoAnterior(null, publicKey, 'android')).toBeNull();
    expect(leerManifiestoAnterior({ manifiesto: 1, firma: 2 }, publicKey, 'android')).toBeNull();
  });
});

describe('adjuntosDe', () => {
  // El backend los busca por estos nombres en el release.
  it('nombra los adjuntos por plataforma', () => {
    expect(adjuntosDe('android')).toEqual({ paquete: 'kiramopay-web-android.zip', manifiesto: 'actualizacion-android.json' });
    expect(adjuntosDe('ios')).toEqual({ paquete: 'kiramopay-web-ios.zip', manifiesto: 'actualizacion-ios.json' });
  });
});
