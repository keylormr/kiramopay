import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MARCA_CANAL_PLAY as MARCA_DEL_SCRIPT,
  RUTA_CONFIG_ANDROID,
  marcarConfig,
  marcarArchivo,
} from '../../../scripts/marcar-canal.mjs';
import { entraEnLaHuella } from '../../../scripts/paquete-web.mjs';
import { MARCA_CANAL_PLAY } from '../../utils/canalDeDistribucion';

const raiz = path.resolve(__dirname, '../../..');
const leer = (ruta: string) => readFileSync(path.join(raiz, ruta), 'utf8');

// El binario de Play se marca; el APK no. La marca la escribe el CI en el
// capacitor.config.json generado y la app la lee del user agent.

describe('marcarConfig', () => {
  it('agrega la marca de Play al user agent y deja lo demas como estaba', () => {
    const marcada = marcarConfig({ appId: 'com.kiramopay.app', android: { minWebViewVersion: 111 } }, 'play');
    expect(marcada).toEqual({
      appId: 'com.kiramopay.app',
      android: { minWebViewVersion: 111, appendUserAgent: MARCA_CANAL_PLAY },
    });
  });

  it('funciona aunque la configuracion no traiga bloque android', () => {
    expect(marcarConfig({ appId: 'x' }, 'play').android).toEqual({ appendUserAgent: MARCA_CANAL_PLAY });
  });

  it('no pisa un user agent que ya estuviera agregado', () => {
    const marcada = marcarConfig({ android: { appendUserAgent: 'Otro/1' } }, 'play');
    expect(marcada.android.appendUserAgent).toBe(`Otro/1 ${MARCA_CANAL_PLAY}`);
  });

  it('es idempotente: marcar dos veces no duplica la marca', () => {
    const una = marcarConfig({ android: {} }, 'play');
    expect(marcarConfig(una, 'play')).toEqual(una);
  });

  it('no modifica el objeto que recibe', () => {
    const original = { android: { minWebViewVersion: 111 } };
    marcarConfig(original, 'play');
    expect(original).toEqual({ android: { minWebViewVersion: 111 } });
  });

  it('rechaza un canal que no conoce y una configuracion que no es un objeto', () => {
    expect(() => marcarConfig({}, 'huawei')).toThrow(/Canal desconocido/);
    expect(() => marcarConfig([], 'play')).toThrow(/no es un objeto/);
    expect(() => marcarConfig(null, 'play')).toThrow(/no es un objeto/);
  });
});

describe('marcarArchivo', () => {
  it('marca el archivo que genera el sync', () => {
    const carpeta = mkdtempSync(path.join(tmpdir(), 'canal-'));
    try {
      const ruta = path.join(carpeta, 'capacitor.config.json');
      writeFileSync(ruta, JSON.stringify({ appId: 'com.kiramopay.app', android: { minWebViewVersion: 111 } }));
      marcarArchivo(ruta, 'play');
      const escrito = JSON.parse(readFileSync(ruta, 'utf8'));
      expect(escrito.android.appendUserAgent).toBe(MARCA_CANAL_PLAY);
      expect(escrito.android.minWebViewVersion).toBe(111);
      expect(escrito.appId).toBe('com.kiramopay.app');
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });

  it('falla si el sync no corrio: sin archivo no hay nada que marcar', () => {
    expect(() => marcarArchivo(path.join(tmpdir(), 'no-existe-canal', 'capacitor.config.json'), 'play')).toThrow(
      /cap sync/,
    );
  });
});

describe('la marca de Play', () => {
  it('es la misma en el script del CI y en la app que la lee', () => {
    expect(MARCA_DEL_SCRIPT).toBe(MARCA_CANAL_PLAY);
  });

  // Si el archivo marcado entrara en la huella, el release que traiga la marca
  // mandaria a todos los telefonos con el APK a instalar otro APK. El archivo
  // generado esta en android/.gitignore y la huella solo mira lo versionado.
  it('se escribe en un archivo que no esta versionado, asi no mueve la huella de lo nativo', () => {
    expect(leer('android/.gitignore')).toMatch(/app\/src\/main\/assets\/capacitor\.config\.json/);
    expect(RUTA_CONFIG_ANDROID).toBe('android/app/src/main/assets/capacitor.config.json');
  });

  it('tampoco esta en lo versionado que entra en la huella: capacitor.config.ts y android/ no la traen', () => {
    expect(entraEnLaHuella('capacitor.config.ts', 'android')).toBe(true);
    expect(leer('capacitor.config.ts')).not.toContain(MARCA_CANAL_PLAY);
    expect(leer('capacitor.config.ts')).not.toContain('appendUserAgent');
    expect(leer('android/app/build.gradle')).not.toContain(MARCA_CANAL_PLAY);
  });
});

describe('android-apk.yml', () => {
  const flujo = leer('.github/workflows/android-apk.yml');
  const en = (texto: string) => flujo.indexOf(texto);

  it('compila el APK antes de marcar y el AAB despues: el APK sale sin marca', () => {
    const apk = en('./gradlew assembleRelease');
    const marca = en('node scripts/marcar-canal.mjs play');
    const aab = en('./gradlew bundleRelease');
    expect(apk).toBeGreaterThan(-1);
    expect(marca).toBeGreaterThan(apk);
    expect(aab).toBeGreaterThan(marca);
  });

  it('sigue produciendo el APK y el AAB firmados, con las mismas variables de firma', () => {
    for (const variable of [
      'KIRAMOPAY_KEYSTORE_FILE',
      'KIRAMOPAY_KEYSTORE_PASSWORD',
      'KIRAMOPAY_KEY_ALIAS',
      'KIRAMOPAY_KEY_PASSWORD',
    ]) {
      expect(flujo.split(variable).length - 1).toBe(2);
    }
    expect(flujo).toContain('cp android/app/build/outputs/apk/release/app-release.apk kiramopay.apk');
    expect(flujo).toContain('cp android/app/build/outputs/bundle/release/app-release.aab kiramopay.aab');
  });

  it('el APK es lo unico que se publica en el release; el AAB queda como artefacto', () => {
    expect(flujo).toMatch(/files: kiramopay\.apk\b/);
    expect(flujo).not.toMatch(/files:[^\n]*kiramopay\.aab/);
  });

  it('verifica que cada binario lleve el canal que le toca', () => {
    expect(flujo).toContain('base/assets/capacitor.config.json');
    expect(flujo).toContain(' assets/capacitor.config.json');
    expect(flujo).toContain(MARCA_CANAL_PLAY);
  });
});
