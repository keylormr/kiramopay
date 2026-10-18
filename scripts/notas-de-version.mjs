// Arma las notas de un release a partir del changelog de src/config/version.ts.
//
// Hasta la 2.7.0 el release de GitHub salia con la descripcion vacia y el aviso
// de actualizacion de la app no decia que traia la version nueva: la app
// instalada no conoce el changelog de una version que todavia no tiene. Este
// script escribe dos archivos que publica android-apk.yml:
//
//   notas-de-version.md -> la descripcion del release en GitHub
//   notas.json          -> adjunto del release; el backend lo lee y se lo pasa
//                          al aviso de actualizacion (internal/appversion)
//
// Uso en CI: node scripts/notas-de-version.mjs v2.8.0
// Falla si el tag no es la version del changelog: un release con las notas de
// otra version es peor que uno sin notas.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Lee la entrada `current` de APP_VERSION con el mismo criterio que
// check-version-sync.mjs: se ancla en la declaracion (los comentarios y la
// interfaz de arriba tambien nombran `current` y `changes`) y se corta en
// `history`.
export function notasDeVersion(texto) {
  const ancla = texto.indexOf('export const APP_VERSION');
  if (ancla < 0) throw new Error('no se encontro export const APP_VERSION');
  const objeto = texto.slice(ancla);
  const actual = objeto.slice(objeto.indexOf('current:'), objeto.indexOf('history:'));
  const version = actual.match(/version:\s*'([^']+)'/)?.[1];
  if (!version) throw new Error('no se pudo leer APP_VERSION.current.version');

  const inicio = actual.indexOf('changes:');
  const apertura = actual.indexOf('[', inicio);
  if (inicio < 0 || apertura < 0) throw new Error(`la version ${version} no tiene cambios`);
  const cambios = [];
  // Cada cambio es un literal entre comillas simples; dentro puede haber una
  // comilla escapada.
  const literal = /'((?:[^'\\]|\\.)*)'|\]/g;
  literal.lastIndex = apertura + 1;
  for (let m = literal.exec(actual); m && m[0] !== ']'; m = literal.exec(actual)) {
    cambios.push(m[1].replace(/\\(.)/g, '$1'));
  }
  if (cambios.length === 0) throw new Error(`la version ${version} no tiene cambios`);
  return { version, cambios };
}

export function cuerpoDelRelease({ version, cambios }) {
  return (
    `## Novedades de la versión ${version}\n\n` +
    cambios.map((c) => `- ${c}`).join('\n') +
    '\n\n' +
    'Para instalar en Android, descarga `kiramopay.apk` desde tu teléfono y ábrelo: ' +
    'se instala encima de la versión anterior sin perder tus datos ni tu sesión.\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2] ?? '';
  const notas = notasDeVersion(readFileSync(new URL('../src/config/version.ts', import.meta.url), 'utf8'));
  if (tag.replace(/^v/, '') !== notas.version) {
    console.error(`El tag ${tag || '(vacio)'} no es la version del changelog (${notas.version}).`);
    process.exit(1);
  }
  writeFileSync('notas.json', JSON.stringify(notas, null, 2) + '\n');
  writeFileSync('notas-de-version.md', cuerpoDelRelease(notas));
  console.log(`Notas de la ${notas.version}: ${notas.cambios.length} cambios.`);
}
