// Marca el binario que se sube a Google Play para que la app sepa de donde vino.
//
// La app instalada se actualiza distinto segun el canal: el APK de GitHub baja
// el .apk nuevo, y la que vino de Play tiene que mandar a su ficha en Play
// (src/utils/canalDeDistribucion.ts). La politica de Play no deja que una app
// publicada ahi se actualice por otro medio que el de Play, asi que el binario
// de Play no puede traer encendido el camino del APK.
//
// La marca es un texto que Capacitor agrega al user agent del WebView
// (android.appendUserAgent). Se escribe en el capacitor.config.json que
// `npx cap sync android` genera dentro de android/app/src/main/assets, DESPUES
// del sync y ANTES de compilar el AAB. No se escribe en capacitor.config.ts a
// proposito: ese archivo, y todo lo versionado de android/, entra en la huella
// de lo nativo (scripts/paquete-web.mjs), y un cambio ahi obligaria a todos los
// telefonos con el APK a instalar otro APK en vez de actualizarse por dentro.
// El capacitor.config.json generado no esta versionado (android/.gitignore), asi
// que no mueve la huella: el APK queda exactamente como estaba.
//
// Uso en CI: node scripts/marcar-canal.mjs play

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Tiene que ser igual a MARCA_CANAL_PLAY de src/utils/canalDeDistribucion.ts (hay una prueba que lo exige). */
export const MARCA_CANAL_PLAY = 'KiramoPayCanal/play';

export const RUTA_CONFIG_ANDROID = 'android/app/src/main/assets/capacitor.config.json';

const MARCAS = { play: MARCA_CANAL_PLAY };

/**
 * Devuelve la configuracion de Capacitor con la marca del canal agregada al
 * user agent. Idempotente: si ya la trae, la deja igual. Respeta lo que ya
 * hubiera en appendUserAgent.
 */
export function marcarConfig(config, canal) {
  const marca = MARCAS[canal];
  if (!marca) throw new Error(`Canal desconocido: ${canal}. Los canales marcados son: ${Object.keys(MARCAS).join(', ')}.`);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('El capacitor.config.json no es un objeto JSON.');
  }
  const android = config.android && typeof config.android === 'object' ? config.android : {};
  const actual = typeof android.appendUserAgent === 'string' ? android.appendUserAgent.trim() : '';
  const yaMarcada = actual.split(/\s+/).includes(marca);
  return {
    ...config,
    android: { ...android, appendUserAgent: yaMarcada ? actual : `${actual} ${marca}`.trim() },
  };
}

/** Marca el archivo generado por `cap sync`. Falla si no existe: sin el sync no hay nada que marcar. */
export function marcarArchivo(ruta, canal) {
  if (!existsSync(ruta)) {
    throw new Error(`No existe ${ruta}: corre \`npx cap sync android\` antes de marcar el canal.`);
  }
  const config = JSON.parse(readFileSync(ruta, 'utf8'));
  const marcada = marcarConfig(config, canal);
  writeFileSync(ruta, `${JSON.stringify(marcada, null, 2)}\n`);
  return marcada;
}

function raizDelRepo() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const canal = process.argv[2];
  const ruta = process.argv[3] ?? path.join(raizDelRepo(), RUTA_CONFIG_ANDROID);
  if (!canal) {
    console.error('Uso: node scripts/marcar-canal.mjs <canal> [ruta-del-capacitor.config.json]');
    process.exit(2);
  }
  try {
    const marcada = marcarArchivo(ruta, canal);
    console.log(`Canal ${canal} marcado en ${path.relative(raizDelRepo(), ruta)}: appendUserAgent = "${marcada.android.appendUserAgent}".`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
