// Arma el paquete de la actualizacion interna de una plataforma y su manifiesto
// firmado. Lo corren android-apk.yml e ios-ipa.yml despues de `npm run build`.
//
// La app instalada puede reemplazar su capa web (lo que hay en dist/) bajandola
// por dentro, sin otro APK. Lo nativo no: un plugin nuevo, otra version de
// Capacitor, un permiso o la configuracion de Firebase solo llegan instalando el
// binario. Un paquete web armado para una parte nativa distinta puede llamar a
// algo que el telefono no tiene, asi que cada release dice cual es la version
// nativa minima (versionCode en Android, CFBundleVersion en iOS) que necesita
// su paquete:
//
//   - Se calcula una huella de lo nativo: los archivos versionados de la
//     plataforma (sin las lineas del numero de version, que cambian siempre),
//     capacitor.config.ts, las versiones exactas de los plugins nativos y si el
//     build lleva Firebase.
//   - Si la huella es la misma que la del release publicado anterior, sirve el
//     mismo binario que servia antes: se hereda su version nativa minima.
//   - Si cambio, o no hay anterior que comparar, la minima es este binario.
//
// Nadie tiene que acordarse de marcar nada: con una duda, se exige el APK.
//
// Escribe dos archivos que se adjuntan al release:
//
//   kiramopay-web-<plataforma>.zip  -> dist/ comprimido, firmado
//   actualizacion-<plataforma>.json -> { manifiesto, firma }: el manifiesto en
//                                      base64 y su firma
//
// Las dos firmas son RSA PKCS#1 v1.5 con SHA-256, con la llave privada del
// secreto LIVE_UPDATE_PRIVATE_KEY. La del .zip la verifica el plugin en nativo
// antes de descomprimir, con la llave publica de capacitor.config.ts (viaja en
// el binario y el JS no la puede cambiar). La del manifiesto la verifica la app
// con WebCrypto antes de bajar nada: ata la firma del .zip a la version y a la
// version nativa minima, que la firma del .zip sola no cubre.
//
// Antes de escribir, comprueba las dos firmas con la llave de
// capacitor.config.ts: si el secreto no corresponde, el release no sale, porque
// ningun telefono podria aceptar el paquete.
//
// Uso en CI: node scripts/paquete-web.mjs android v2.9.0

import { createHash, createPrivateKey, createPublicKey, sign, verify, constants } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FORMATO = 1;

export function adjuntosDe(plataforma) {
  return { paquete: `kiramopay-web-${plataforma}.zip`, manifiesto: `actualizacion-${plataforma}.json` };
}

// Lo que no viaja en el binario: metadatos de las tiendas (fastlane), las
// herramientas de fastlane y la documentacion. Si entraran, cada changelog de
// Play cambiaria la huella y toda version iria por APK.
const FUERA_DE_LA_HUELLA = [/(^|\/)fastlane\//, /(^|\/)Gemfile(\.lock)?$/, /\.md$/i, /^android\/assetlinks\.template\.json$/];

export function entraEnLaHuella(ruta, plataforma) {
  if (ruta === 'capacitor.config.ts') return true;
  if (!ruta.startsWith(`${plataforma}/`)) return false;
  return !FUERA_DE_LA_HUELLA.some((re) => re.test(ruta));
}

// Las lineas del numero de version cambian en cada release y no cambian lo que
// el binario puede hacer.
const LINEAS_DE_VERSION = [
  /^\s*version(Code|Name)\s.*$/gm, // android/app/build.gradle
  /^.*\b(MARKETING_VERSION|CURRENT_PROJECT_VERSION)\s*=.*$/gm, // project.pbxproj
];

function contenidoNormalizado(ruta, contenido) {
  const bytes = Buffer.isBuffer(contenido) ? contenido : Buffer.from(String(contenido));
  // Binario (imagenes): tal cual.
  if (bytes.includes(0)) return bytes;
  let texto = bytes.toString('utf8').replace(/\r\n/g, '\n');
  if (ruta === 'android/app/build.gradle' || ruta.endsWith('project.pbxproj')) {
    for (const re of LINEAS_DE_VERSION) texto = texto.replace(re, '');
  }
  return Buffer.from(texto);
}

const sha256 = (datos) => createHash('sha256').update(datos).digest('hex');

export function huellaNativa({ plataforma, archivos, dependencias = {}, extras = {} }) {
  const lineas = [];
  for (const { ruta, contenido } of archivos) {
    if (!entraEnLaHuella(ruta, plataforma)) continue;
    lineas.push(`archivo ${ruta} ${sha256(contenidoNormalizado(ruta, contenido))}`);
  }
  for (const [nombre, version] of Object.entries(dependencias)) lineas.push(`dependencia ${nombre}@${version}`);
  for (const [clave, valor] of Object.entries(extras)) lineas.push(`extra ${clave}=${valor}`);
  lineas.sort();
  return sha256(`plataforma ${plataforma}\n${lineas.join('\n')}\n`);
}

const esEnteroPositivo = (n) => Number.isInteger(n) && n > 0;

export function decidirNativaMinima({ huella, versionCode, anterior }) {
  if (
    anterior &&
    anterior.huellaNativa === huella &&
    esEnteroPositivo(anterior.nativaMinima) &&
    anterior.nativaMinima <= versionCode
  ) {
    return anterior.nativaMinima;
  }
  return versionCode;
}

// Orden fijo de los campos: es lo que se firma.
export function armarManifiesto({ plataforma, version, versionCode, nativaMinima, huellaNativa, paquete, firmaPaquete, bytes }) {
  return JSON.stringify({
    formato: FORMATO,
    plataforma,
    version,
    versionCode,
    nativaMinima,
    huellaNativa,
    paquete,
    firmaPaquete,
    bytes,
  });
}

export function firmar(datos, llavePrivadaPem) {
  return sign('sha256', datos, { key: createPrivateKey(llavePrivadaPem), padding: constants.RSA_PKCS1_PADDING }).toString(
    'base64',
  );
}

export function verificar(datos, firmaBase64, llavePublicaPem) {
  try {
    return verify(
      'sha256',
      datos,
      { key: createPublicKey(pemConSaltos(llavePublicaPem)), padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(firmaBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

// La llave va en una sola linea en capacitor.config.ts (asi la espera el
// plugin). Se devuelve igual, sin espacios.
export function llavePublicaDeConfig(texto) {
  const m = texto.match(/publicKey:\s*['"`]-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----['"`]/);
  return m ? `-----BEGIN PUBLIC KEY-----${m[1].replace(/\s+/g, '')}-----END PUBLIC KEY-----` : null;
}

// PEM de una sola linea a uno que OpenSSL lee. Uno que ya trae saltos queda igual.
function pemConSaltos(pem) {
  const cuerpo = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  return `-----BEGIN PUBLIC KEY-----\n${(cuerpo.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----\n`;
}

function partesDeVersion(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag ?? '');
  return m ? m.slice(1).map(Number) : null;
}

function compararVersiones(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// El release publicado inmediatamente anterior: el de version mas alta por
// debajo de la actual, sin borradores ni pre-releases (los telefonos nunca
// reciben esos por releases/latest).
export function elegirReleaseAnterior(releases, tagActual) {
  const actual = partesDeVersion(tagActual);
  if (!actual) return null;
  let mejor = null;
  for (const r of releases ?? []) {
    if (!r || r.draft || r.prerelease) continue;
    const v = partesDeVersion(r.tag_name);
    if (!v || compararVersiones(v, actual) >= 0) continue;
    if (!mejor || compararVersiones(v, mejor.v) > 0) mejor = { v, r };
  }
  return mejor ? mejor.r : null;
}

// El manifiesto del release anterior cuenta solo si lo firmo la llave vigente:
// si la llave cambio, los binarios viejos no pueden verificar los paquetes
// nuevos y la version tiene que ir por APK.
export function leerManifiestoAnterior(adjunto, llavePublicaPem, plataforma) {
  if (!adjunto || typeof adjunto.manifiesto !== 'string' || typeof adjunto.firma !== 'string') return null;
  const datos = Buffer.from(adjunto.manifiesto, 'base64');
  if (!verificar(datos, adjunto.firma, llavePublicaPem)) return null;
  try {
    const m = JSON.parse(datos.toString('utf8'));
    if (m?.plataforma !== plataforma || typeof m.huellaNativa !== 'string') return null;
    return m;
  } catch {
    return null;
  }
}

// ── Lo que solo corre en CI ──────────────────────────────────────────────────

// Se resuelve al usarse: bajo vitest import.meta.url no es un file:// y las
// pruebas solo usan las funciones puras de arriba.
let raizCache;
const raizDelRepo = () => (raizCache ??= fileURLToPath(new URL('..', import.meta.url)));
const leer = (ruta) => readFileSync(path.join(raizDelRepo(), ruta));

function versionCodeDe(plataforma) {
  if (plataforma === 'android') {
    return Number(leer('android/app/build.gradle').toString().match(/versionCode\s+(\d+)/)?.[1]);
  }
  return Number(leer('ios/App/App.xcodeproj/project.pbxproj').toString().match(/CURRENT_PROJECT_VERSION = (\d+);/)?.[1]);
}

// Los plugins nativos, con la version exacta instalada: los @capacitor/* y toda
// dependencia que se declare plugin de Capacitor en su package.json.
function dependenciasNativas() {
  const paquete = JSON.parse(leer('package.json'));
  const lock = JSON.parse(leer('package-lock.json'));
  const nativas = {};
  for (const nombre of Object.keys(paquete.dependencies ?? {})) {
    const manifiestoDep = path.join(raizDelRepo(), 'node_modules', nombre, 'package.json');
    const esPlugin = existsSync(manifiestoDep) && JSON.parse(readFileSync(manifiestoDep)).capacitor;
    if (!nombre.startsWith('@capacitor/') && !esPlugin) continue;
    const version = lock.packages?.[`node_modules/${nombre}`]?.version;
    if (!version) throw new Error(`${nombre} no esta en package-lock.json`);
    nativas[nombre] = version;
  }
  return nativas;
}

function archivosVersionados(plataforma) {
  const salida = execFileSync('git', ['ls-files', '-z', '--', plataforma, 'capacitor.config.ts'], { cwd: raizDelRepo() });
  return salida
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((ruta) => ({ ruta, contenido: leer(ruta) }));
}

async function manifiestoAnterior(tag, plataforma, llavePublica) {
  const repo = process.env.GITHUB_REPOSITORY || 'keylormr/kiramopay';
  const cabeceras = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) cabeceras.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers: cabeceras });
  if (!res.ok) throw new Error(`la API de releases respondio ${res.status}`);
  const anterior = elegirReleaseAnterior(await res.json(), tag);
  if (!anterior) return { tag: null, manifiesto: null };
  const nombre = adjuntosDe(plataforma).manifiesto;
  const adjunto = (anterior.assets ?? []).find((a) => a.name === nombre);
  if (!adjunto) return { tag: anterior.tag_name, manifiesto: null };
  const bajada = await fetch(adjunto.browser_download_url);
  if (!bajada.ok) throw new Error(`el manifiesto de ${anterior.tag_name} respondio ${bajada.status}`);
  return { tag: anterior.tag_name, manifiesto: leerManifiestoAnterior(await bajada.json(), llavePublica, plataforma) };
}

async function principal() {
  const [plataforma, tagArg] = process.argv.slice(2);
  if (plataforma !== 'android' && plataforma !== 'ios') throw new Error('uso: node scripts/paquete-web.mjs <android|ios> [tag]');

  const version = JSON.parse(leer('package.json')).version;
  const tag = tagArg && tagArg.startsWith('v') ? tagArg : `v${version}`;
  if (tag !== `v${version}`) throw new Error(`el tag ${tag} no es la version de package.json (${version})`);
  const versionCode = versionCodeDe(plataforma);
  if (!esEnteroPositivo(versionCode)) throw new Error(`no se pudo leer el numero de build de ${plataforma}`);

  const llavePrivada = process.env.LIVE_UPDATE_PRIVATE_KEY;
  if (!llavePrivada) throw new Error('falta el secreto LIVE_UPDATE_PRIVATE_KEY');
  const llaveConfig = llavePublicaDeConfig(leer('capacitor.config.ts').toString());
  if (!llaveConfig) throw new Error('capacitor.config.ts no trae plugins.LiveUpdate.publicKey');
  const llavePublica = llaveConfig;

  if (!existsSync(path.join(raizDelRepo(), 'dist', 'index.html'))) throw new Error('no hay dist/index.html: correr npm run build antes');

  const google = path.join(raizDelRepo(), 'android/app/google-services.json');
  const huella = huellaNativa({
    plataforma,
    archivos: archivosVersionados(plataforma),
    dependencias: dependenciasNativas(),
    extras: { firebase: plataforma === 'android' && existsSync(google) ? sha256(readFileSync(google)) : 'no' },
  });

  // Sin poder leer el anterior no se frena el release: se exige el APK, que es
  // lo seguro.
  const anterior = await manifiestoAnterior(tag, plataforma, llavePublica).catch((e) => {
    console.log(`::warning::No se pudo leer el release anterior (${e.message}); esta version se exige por APK.`);
    return { tag: null, manifiesto: null };
  });
  const nativaMinima = decidirNativaMinima({ huella, versionCode, anterior: anterior.manifiesto });

  const { paquete, manifiesto: archivoManifiesto } = adjuntosDe(plataforma);
  const zip = path.join(raizDelRepo(), paquete);
  if (existsSync(zip)) unlinkSync(zip);
  // index.html en la raiz del .zip: el plugin toma como raiz la carpeta que lo contiene.
  execFileSync('zip', ['-q', '-r', '-X', zip, '.'], { cwd: path.join(raizDelRepo(), 'dist') });
  const bytesZip = readFileSync(zip);
  const firmaPaquete = firmar(bytesZip, llavePrivada);

  const manifiesto = armarManifiesto({
    plataforma,
    version,
    versionCode,
    nativaMinima,
    huellaNativa: huella,
    paquete,
    firmaPaquete,
    bytes: statSync(zip).size,
  });
  const firma = firmar(Buffer.from(manifiesto), llavePrivada);

  if (!verificar(bytesZip, firmaPaquete, llavePublica) || !verificar(Buffer.from(manifiesto), firma, llavePublica)) {
    throw new Error('LIVE_UPDATE_PRIVATE_KEY no corresponde a la publicKey de capacitor.config.ts: ningun telefono aceptaria el paquete');
  }

  writeFileSync(
    path.join(raizDelRepo(), archivoManifiesto),
    JSON.stringify({ manifiesto: Buffer.from(manifiesto).toString('base64'), firma }, null, 2) + '\n',
  );

  console.log(`Paquete ${plataforma} ${version}: ${statSync(zip).size} bytes, huella ${huella.slice(0, 12)}.`);
  console.log(
    `Release anterior: ${anterior.tag ?? 'ninguno'}${anterior.tag && !anterior.manifiesto ? ' (sin manifiesto valido)' : ''}.`,
  );
  console.log(
    nativaMinima === versionCode
      ? `Version nativa minima ${nativaMinima}: lo nativo cambio (o no hay con que comparar); esta version se instala por APK.`
      : `Version nativa minima ${nativaMinima}: los builds desde el ${nativaMinima} se actualizan por dentro; los anteriores, por APK.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
