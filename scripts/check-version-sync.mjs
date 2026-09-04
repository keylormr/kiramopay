// La version de KiramoPay vive en tres archivos, y los tres tienen que decir lo
// mismo. Esta prueba existe porque no lo decian: package.json paso ocho
// versiones marcando 2.0.0 mientras el APK publicado iba en 2.3.3, asi que el
// perfil de la aplicacion mostraba una version que no existia y el changelog se
// habia quedado meses atras. Nadie lo noto porque nada lo revisaba.
//
//   package.json .version          -> lo que muestra la aplicacion web
//   build.gradle versionName       -> lo que muestra Android y publica el tag
//   version.ts APP_VERSION.current -> el changelog que lee la persona
//   buildinfo/version.txt          -> lo que responde /health del backend
//
// Y ademas el buildNumber de esa entrada tiene que ser el versionCode de
// Android, que es el numero por el que Play Store ordena las versiones.
//
// Correr con: npm run check:version

import { readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

const fallos = [];

const paquete = JSON.parse(leer('package.json')).version;

const gradle = leer('android/app/build.gradle');
const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
const versionCode = gradle.match(/versionCode\s+(\d+)/)?.[1];

const versionTs = leer('src/config/version.ts');
// Se ancla en APP_VERSION antes de buscar `current`, porque la interfaz de mas
// arriba tambien declara un campo con ese nombre; y se corta en `history` para
// no leer por error la version de una entrada vieja.
const objeto = versionTs.slice(versionTs.indexOf('export const APP_VERSION'));
const bloqueActual = objeto.slice(objeto.indexOf('current:'), objeto.indexOf('history:'));
const changelog = bloqueActual.match(/version:\s*'([^']+)'/)?.[1];
const buildNumber = bloqueActual.match(/buildNumber:\s*(\d+)/)?.[1];

// El backend embebe esta version y la responde en /health: es la unica forma de
// saber desde afuera que build esta sirviendo un despliegue.
const backend = leer('backend/internal/buildinfo/version.txt').trim();

if (!versionName) fallos.push('no se pudo leer versionName de android/app/build.gradle');
if (!versionCode) fallos.push('no se pudo leer versionCode de android/app/build.gradle');
if (!changelog) fallos.push('no se pudo leer APP_VERSION.current.version de src/config/version.ts');
if (!buildNumber) fallos.push('no se pudo leer APP_VERSION.current.buildNumber de src/config/version.ts');

if (versionName && paquete !== versionName) {
  fallos.push(`package.json dice ${paquete} y build.gradle dice ${versionName}`);
}
if (changelog && paquete !== changelog) {
  fallos.push(`package.json dice ${paquete} y el changelog de version.ts dice ${changelog}`);
}
if (versionCode && buildNumber && versionCode !== buildNumber) {
  fallos.push(`versionCode de Android es ${versionCode} y el buildNumber del changelog es ${buildNumber}`);
}
if (paquete !== backend) {
  fallos.push(`package.json dice ${paquete} y backend/internal/buildinfo/version.txt dice ${backend}`);
}

if (fallos.length > 0) {
  console.error('La version no esta sincronizada:\n');
  for (const f of fallos) console.error(`  - ${f}`);
  console.error(
    '\nAl cortar una version hay que mover las cuatro a la vez:' +
      '\n  1. "version" en package.json' +
      '\n  2. versionName y versionCode en android/app/build.gradle' +
      '\n  3. APP_VERSION.current en src/config/version.ts, con su entrada de changelog' +
      '\n     (y bajar la anterior a history)' +
      '\n  4. backend/internal/buildinfo/version.txt, que es lo que responde /health\n',
  );
  process.exit(1);
}

console.log(`Version sincronizada: ${paquete} (versionCode ${versionCode})`);
